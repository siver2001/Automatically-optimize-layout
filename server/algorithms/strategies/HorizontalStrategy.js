import BaseStrategy from './BaseStrategy.js';
import WorkerPool from '../workers/WorkerPool.js';

class HorizontalStrategy extends BaseStrategy {
    constructor(container) {
        super(container);
    }

    // --- HEURISTIC ANALYSIS ---
    _analyzeInput(rectangles) {
        if (!rectangles || rectangles.length === 0) return { uniqueRatio: 0, avgAspectRatio: 1, totalCount: 0 };

        const totalCount = rectangles.length;
        const uniqueKeys = new Set(rectangles.map(r => `${r.width}x${r.length}`));
        const uniqueRatio = uniqueKeys.size / totalCount;

        let totalAR = 0;
        rectangles.forEach(r => {
            const dim1 = r.width;
            const dim2 = r.length;
            const ar = Math.max(dim1, dim2) / Math.min(dim1, dim2);
            totalAR += ar;
        });
        const avgAspectRatio = totalAR / totalCount;

        return { uniqueRatio, avgAspectRatio, totalCount };
    }

    _selectStrategies(allTasks, analytics) {
        // Rule 0: If small dataset, run ALL for safety/quality
        if (analytics.totalCount < 100) return allTasks;

        const { uniqueRatio, avgAspectRatio } = analytics;
        let selected = [...allTasks];

        // Rule 1: High Uniformity (Many duplicates)
        if (uniqueRatio < 0.1) {
            // Uniform inputs usually work well with Grouped and Shelf.
            const prioritized = ['Grouped_BSSF', 'Shelf_Smart_Horizontal', 'Pack_Bottom_ByWidth', 'Pack_Bottom_ByHeight'];
            selected = allTasks.filter(t => prioritized.includes(t.name));
            if (!selected.find(t => t.name === 'Area_BSSF')) {
                const fallback = allTasks.find(t => t.name === 'Area_BSSF');
                if (fallback) selected.push(fallback);
            }
        }

        // Rule 2: High Aspect Ratio (Long strips)
        if (avgAspectRatio > 4.0) {
            // For Horizontal Strategy (Bottom-Up), filling rows with long items is natural.
            const prioritized = ['Pack_Bottom_ByWidth', 'Pack_Bottom_ByHeight', 'Shelf_Smart_Horizontal'];
            selected = allTasks.filter(t => prioritized.includes(t.name));
        }

        // Ensure we always have at least 2 strategies to race
        if (selected.length < 2) return allTasks;

        return selected;
    }

    async execute(rectanglesToPack) {
        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // 0. HEURISTIC SELECTION
        const analytics = this._analyzeInput(rawRects);

        // 1. PREPARE DATA (Main Thread)
        const areaData = this.sortRectanglesByArea(rawRects);
        const groupedData = this.sortRectanglesByExactDimension(rawRects);
        const widthSortData = this.sortRectanglesByWidth(rawRects);
        const heightSortData = rawRects.slice().sort((a, b) => b.length - a.length);

        const smartSortData = rawRects.slice().sort((a, b) => {
            if (Math.abs(b.length - a.length) > 1) return b.length - a.length;
            return b.width - a.width;
        });

        // 2. DEFINE TASKS
        const allTasks = [
            { name: 'Shelf_Smart_Horizontal', method: '_shelfNextFitSmart', params: [rawRects.slice().sort((a, b) => b.length - a.length).map(r => ({ ...r })), false] },
            { name: 'Grouped_BSSF', method: '_maxRectsBSSF', params: [groupedData.map(r => ({ ...r })), true] },
            { name: 'Area_BSSF', method: '_maxRectsBSSF', params: [areaData.map(r => ({ ...r })), false] },
            { name: 'Area_BAF', method: '_maxRectsBAF', params: [areaData.map(r => ({ ...r })), false] },

            // SPECIFIC HORIZONTAL STRATEGIES (Using BL - Bottom Left)
            { name: 'Pack_Bottom_ByWidth', method: '_maxRectsBL', params: [widthSortData.map(r => ({ ...r })), false] },
            { name: 'Pack_Bottom_ByHeight', method: '_maxRectsBL', params: [heightSortData.map(r => ({ ...r })), false] },
            { name: 'Pack_Bottom_Smart', method: '_maxRectsBL', params: [smartSortData.map(r => ({ ...r })), false] },
            { name: 'Pack_Bottom_ByArea', method: '_maxRectsBL', params: [areaData.map(r => ({ ...r })), false] }
        ];

        // FILTER TASKS
        const tasks = this._selectStrategies(allTasks, analytics);

        let validResults = [];

        // 3. EXECUTE (Adaptive)
        if (rawRects.length < 1500) {
            // Single Thread
            for (const task of tasks) {
                if (typeof this[task.method] === 'function') {
                    const { placed, remaining } = this[task.method](...task.params);
                    validResults.push({
                        strategyName: task.name,
                        result: { placed, remaining }
                    });
                }
            }
        } else {
            // Multi Thread
            const isGoodEnough = (res) => {
                if (!res || !res.result) return false;
                const { remaining, placed } = res.result;
                if (remaining.length === 0) {
                    const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
                    const totalContainerArea = this.container.width * this.container.length;
                    const efficiency = totalContainerArea > 0 ? (usedArea / totalContainerArea) : 0;
                    return efficiency > 0.96;
                }
                return false;
            };

            const promises = tasks.map(task => {
                return WorkerPool.executeTask({
                    strategyName: task.name,
                    container: this.container,
                    rectangles: task.params[0],
                    method: task.method,
                    params: task.params
                }).then(res => {
                    if (res && !res.strategyName) res.strategyName = task.name;
                    return res;
                }).catch(err => {
                    console.error(`Strategy ${task.name} failed:`, err);
                    return null;
                });
            });

            const raceToSuccess = (promises) => {
                return new Promise((resolve) => {
                    let completedCount = 0;
                    const results = [];
                    let resolved = false;

                    promises.forEach(p => {
                        p.then(res => {
                            if (resolved) return;

                            results.push(res);
                            completedCount++;

                            if (isGoodEnough(res)) {
                                resolved = true;
                                resolve([res]);
                            } else if (completedCount === promises.length) {
                                resolved = true;
                                resolve(results);
                            }
                        });
                    });
                });
            };

            const resultsRaw = await raceToSuccess(promises);
            validResults = resultsRaw.filter(r => r && r.result);
        }

        let bestResult = null;

        // 4. PICK BEST RESULT
        for (const res of validResults) {
            const { placed, remaining } = res.result;
            const strategyName = res.strategyName;

            const count = placed.length;
            const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
            const alignmentScore = this._calculateAlignmentScore(placed);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            if (placed.length > 0) {
                placed.forEach(r => {
                    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
                    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.length);
                });
            } else { minX = 0; minY = 0; maxX = 0; maxY = 0; }

            const boundingArea = (placed.length > 0) ? (maxX - minX) * (maxY - minY) : 0;
            const compactness = (boundingArea > 0) ? (usedArea / boundingArea) : 0;
            const totalContainerArea = this.container.width * this.container.length;
            const efficiency = totalContainerArea > 0 ? (usedArea / totalContainerArea) : 0;

            const currentResult = {
                placed: placed.map(r => ({ ...r, layer: 0 })),
                remaining: remaining.map(r => ({ ...r })),
                count, usedArea, alignmentScore, compactness,
                maxX, maxY,
                strategyName: strategyName
            };

            if (remaining.length === 0 && efficiency > 0.96) {
                return currentResult;
            }

            if (!bestResult) {
                bestResult = currentResult;
                continue;
            }

            if (currentResult.count > bestResult.count) {
                bestResult = currentResult;
            } else if (currentResult.count === bestResult.count) {
                if (currentResult.maxY < bestResult.maxY - 30) {
                    bestResult = currentResult;
                } else if (currentResult.maxY > bestResult.maxY + 30) {
                    continue;
                } else {
                    if (currentResult.alignmentScore > bestResult.alignmentScore) {
                        bestResult = currentResult;
                    } else if (currentResult.alignmentScore === bestResult.alignmentScore) {
                        if (currentResult.compactness > bestResult.compactness) {
                            bestResult = currentResult;
                        }
                    }
                }
            }
        }

        return bestResult;
    }

    async executeFinalSheet(rectanglesToPack) {
        const itemCount = rectanglesToPack.length;
        let TOTAL_ITERATIONS = 200;
        if (itemCount < 20) TOTAL_ITERATIONS = 500;
        if (itemCount > 100) TOTAL_ITERATIONS = 50;

        const PARALLEL_TASKS = 4;
        const iterationsPerTask = Math.ceil(TOTAL_ITERATIONS / PARALLEL_TASKS);
        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        const initialCandidates = [
            rawRects.slice().sort((a, b) => b.length - a.length),
            this.sortRectanglesByWidth(rawRects),
            this.sortRectanglesByArea(rawRects),
            rawRects.slice().sort((a, b) => {
                if (Math.abs(b.length - a.length) > 1) return b.length - a.length;
                return b.width - a.width;
            })
        ];

        let bestResult = null;

        const updateBest = (res) => {
            if (!res || !res.placed || res.remaining.length > 0) return;

            let maxX = 0;
            let maxY = 0;
            res.placed.forEach(r => {
                maxX = Math.max(maxX, r.x + r.width);
                maxY = Math.max(maxY, r.y + r.length);
            });
            const current = { ...res, count: res.placed.length, maxX, maxY };

            if (!bestResult) {
                bestResult = current;
                return;
            }

            if (current.count > bestResult.count) {
                bestResult = current;
            } else if (current.count === bestResult.count) {
                if (current.maxY < bestResult.maxY - 0.5) {
                    bestResult = current;
                } else if (Math.abs(current.maxY - bestResult.maxY) <= 0.5 && current.maxX < bestResult.maxX) {
                    bestResult = current;
                }
            }
        };

        for (let i = 0; i < initialCandidates.length; i++) {
            const sortedRects = initialCandidates[i];
            const res = this._maxRectsBL(sortedRects.map(r => ({ ...r })), false);
            updateBest({ placed: res.placed, remaining: res.remaining, strategyName: `Final_Horizontal_Heuristic_${i}` });
        }

        if (bestResult && bestResult.remaining.length === 0 && bestResult.maxY < this.container.length * 0.5) {
            return bestResult;
        }

        const promises = [];
        for (let i = 0; i < PARALLEL_TASKS; i++) {
            promises.push(
                WorkerPool.executeTask({
                    strategyName: `Final_Horizontal_DeepSearch_Task_${i}`,
                    container: this.container,
                    rectangles: rawRects,
                    method: 'executeFinalSheet_Worker',
                    params: [rawRects, iterationsPerTask]
                }).catch(err => {
                    console.error("Deep search task failed:", err);
                    return null;
                })
            );
        }

        // Wait a bit or logic for parallel (omitted to avoid conflict with missing worker support for deep search)
        // Returning best heuristic result for now
        return bestResult;
    }
}

export default HorizontalStrategy;
