import BaseStrategy from './BaseStrategy.js';
import WorkerPool from '../workers/WorkerPool.js';

class HybridStrategy extends BaseStrategy {
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

        // Rule 1: High Uniformity (Many duplicates) -> Prioritize Grouping & Simple patterns
        // uniqueRatio < 0.1 means e.g. 1000 items but only <100 sizes.
        if (uniqueRatio < 0.1) {
            // Keep: Grouped_BSSF, Shelf_Smart
            // Drop: Complex "Chaos" strategies like Area_BAF or Smart sorts that might be overkill
            // We want to KEEP standard vertical sorting
            const prioritized = ['Grouped_BSSF', 'Shelf_Smart_Horizontal', 'Pack_Left_ByHeight', 'Pack_Left_ByWidth'];
            selected = allTasks.filter(t => prioritized.includes(t.name));
            // Add at least one Area fallback just in case
            if (!selected.find(t => t.name === 'Area_BSSF')) {
                const fallback = allTasks.find(t => t.name === 'Area_BSSF');
                if (fallback) selected.push(fallback);
            }
        }

        // Rule 2: High Aspect Ratio (Long strips) -> Prioritize orientation-specific packs
        if (avgAspectRatio > 4.0) {
            // Very long items. BL (Pack Bottom) or Pack Left (Vertical) is best.
            // BSSF/BAF might create weird gaps.
            const prioritized = ['Pack_Left_ByHeight', 'Pack_Left_ByWidth', 'Shelf_Smart_Horizontal'];
            // If we are in Hybrid (Vertical preference usually), Pack_Left is king.
            selected = allTasks.filter(t => prioritized.includes(t.name));
        }

        // Ensure we always have at least 2 strategies to race
        if (selected.length < 2) return allTasks;

        return selected;
    }

    async execute(rectanglesToPack, strategyConfig = {}) {
        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // Config defaults
        const alignmentMode = strategyConfig.alignmentMode || 'default';

        // 0. HEURISTIC SELECTION
        const analytics = this._analyzeInput(rawRects);

        // 1. CHUẨN BỊ DỮ LIỆU (Main Thread)
        // Việc sort rất nhanh, nên làm ở main thread để tránh gửi dữ liệu qua lại quá nhiều lần cho việc sort
        const stripHorizontalData = this.preAlignRectangles(rawRects, 'horizontal');
        const sortedByHeight = this.sortRectanglesByHeight(stripHorizontalData);

        const areaData = this.sortRectanglesByArea(rawRects);
        const groupedData = this.sortRectanglesByExactDimension(rawRects);
        const widthSortData = this.sortRectanglesByWidth(rawRects);

        const smartSortData = rawRects.slice().sort((a, b) => {
            if (Math.abs(b.length - a.length) > 1) return b.length - a.length;
            return b.width - a.width;
        });

        // 2. ĐỊNH NGHĨA CÁC TASKS
        const allTasks = [
            { name: 'Shelf_Smart_Horizontal', method: '_shelfNextFitSmart', params: [sortedByHeight.map(r => ({ ...r })), false] },
            { name: 'Grouped_BSSF', method: '_maxRectsBSSF', params: [groupedData.map(r => ({ ...r })), true] },
            { name: 'Area_BSSF', method: '_maxRectsBSSF', params: [areaData.map(r => ({ ...r })), false] },
            { name: 'Area_BAF', method: '_maxRectsBAF', params: [areaData.map(r => ({ ...r })), false] },
            { name: 'Pack_Left_ByWidth', method: '_maxRectsPackLeft', params: [widthSortData.map(r => ({ ...r })), false] },
            { name: 'Pack_Left_ByHeight', method: '_maxRectsPackLeft', params: [(rawRects.slice().sort((a, b) => b.length - a.length)).map(r => ({ ...r })), false] },
            { name: 'Pack_Left_Smart', method: '_maxRectsPackLeft', params: [smartSortData.map(r => ({ ...r })), false] },
            { name: 'Pack_Left_ByArea', method: '_maxRectsPackLeft', params: [areaData.map(r => ({ ...r })), false] }
        ];

        // FILTER TASKS
        const tasks = this._selectStrategies(allTasks, analytics);


        let validResults = [];

        // [ADAPTIVE EXECUTION]
        // Nếu ít hơn 1500 items -> Chạy đơn luồng (Single Thread) để tránh overhead tạo worker
        // Nếu nhiều hơn -> Chạy đa luồng (Multi Thread) để tận dụng CPU
        if (rawRects.length < 1500 || !WorkerPool) {
            // --- SINGLE THREAD MODE ---
            for (const task of tasks) {
                // Gọi trực tiếp method của class cha (BaseStrategy)
                // Lưu ý: task.method là string tên hàm, ta truy cập qua this[task.method]
                if (typeof this[task.method] === 'function') {
                    const { placed, remaining } = this[task.method](...task.params);
                    validResults.push({
                        strategyName: task.name,
                        result: { placed, remaining }
                    });
                }
            }
        } else {
            // --- MULTI THREAD MODE WITH RACING ---
            // Helper to determine if a result is "Good Enough" to exit early
            const isGoodEnough = (res) => {
                if (!res || !res.result) return false;
                const { remaining, placed } = res.result;
                // Criteria: All items placed AND Efficiency > 96%
                // Calculate efficiency locally to check
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
                    // Attach strategy name if missing
                    if (res && !res.strategyName) res.strategyName = task.name;
                    return res;
                }).catch(err => {
                    console.error(`Strategy ${task.name} failed:`, err);
                    return null;
                });
            });

            // Custom Race Logic
            // We want to resolve as soon as ONE promise returns a "Good Enough" result.
            // If all finish and none are good enough, we resolve with ALL results.

            const raceToSuccess = (promises) => {
                return new Promise((resolve) => {
                    let completedCount = 0;
                    const results = [];
                    let resolved = false;

                    promises.forEach(p => {
                        p.then(res => {
                            if (resolved) return; // Already finished

                            results.push(res);
                            completedCount++;

                            if (isGoodEnough(res)) {
                                resolved = true;
                                resolve([res]); // Return just this winner (as an array to match format)
                            } else if (completedCount === promises.length) {
                                resolved = true;
                                resolve(results); // Return all results to pick best
                            }
                        });
                    });
                });
            };

            const resultsRaw = await raceToSuccess(promises);
            validResults = resultsRaw.filter(r => r && r.result);
        }

        let bestResult = null;

        // 4. CHỌN KẾT QUẢ TỐT NHẤT (Main Thread Logic)
        for (const res of validResults) {
            const { placed, remaining } = res.result;
            const strategyName = res.strategyName;

            const count = placed.length;
            const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);

            // [CUSTOM ALIGNMENT SCORE]
            // Pass the alignmentMode to the BaseStrategy helper
            const alignmentScore = this._calculateAlignmentScore(placed, alignmentMode);

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

            const rightMostEdge = maxX;

            const currentResult = {
                placed: placed.map(r => ({ ...r, layer: 0 })),
                remaining: remaining.map(r => ({ ...r })),
                count, usedArea, alignmentScore, compactness, rightMostEdge,
                strategyName: strategyName
            };

            // [EARLY EXIT]
            if (remaining.length === 0 && efficiency > 0.96) {
                return currentResult;
            }

            if (!bestResult) {
                bestResult = currentResult;
                continue;
            }

            if (currentResult.count > bestResult.count) {
                bestResult = currentResult;
            }
            else if (currentResult.count === bestResult.count) {
                if (currentResult.rightMostEdge < bestResult.rightMostEdge - 30) {
                    bestResult = currentResult;
                }
                else if (currentResult.rightMostEdge > bestResult.rightMostEdge + 30) {
                    continue;
                }
                else {
                    if (currentResult.alignmentScore > bestResult.alignmentScore) {
                        bestResult = currentResult;
                    }
                    else if (currentResult.alignmentScore === bestResult.alignmentScore) {
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

        // Dynamic parallelism based on pool size
        // We can access the pool size via WorkerPool.poolSize if we export it or just guess.
        // Better to just spawn a reasonable number of tasks, e.g., 4 or 8.
        // Let's assume 4 parallel tasks for now to be safe, or we can try to get it from WorkerPool if we import it.
        const PARALLEL_TASKS = 4;
        const iterationsPerTask = Math.ceil(TOTAL_ITERATIONS / PARALLEL_TASKS);

        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // 1. Initial Candidates (Fast Heuristics) - Run on Main Thread (or can be parallelized too, but they are fast)
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

        // Helper to update best result
        const updateBest = (res) => {
            if (!res || !res.placed || res.remaining.length > 0) return; // Only consider full packs for now? Or partials?
            // The original logic allowed partials but preferred full packs.
            // Let's stick to the original comparison logic.

            // Re-construct the comparison object
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

            // Comparison logic from original
            if (current.count > bestResult.count) {
                bestResult = current;
            }
            else if (current.count === bestResult.count) {
                if (current.maxX < bestResult.maxX - 0.5) {
                    bestResult = current;
                }
                else if (Math.abs(current.maxX - bestResult.maxX) <= 0.5 && current.maxY < bestResult.maxY) {
                    bestResult = current;
                }
            }
        };

        // Run heuristics locally first
        for (let i = 0; i < initialCandidates.length; i++) {
            const sortedRects = initialCandidates[i];
            const res = this._maxRectsPackLeft(sortedRects.map(r => ({ ...r })), false);
            updateBest({ placed: res.placed, remaining: res.remaining, strategyName: `Final_Heuristic_${i}` });
        }

        // [EARLY EXIT]
        if (bestResult && bestResult.remaining.length === 0 && bestResult.maxX < this.container.width * 0.5) {
            return bestResult;
        }

        // 2. Deep Search
        if (WorkerPool) {
            // Parallelized with Racing (Main Thread)
            const promises = [];
            for (let i = 0; i < PARALLEL_TASKS; i++) {
                promises.push(
                    WorkerPool.executeTask({
                        strategyName: `Final_DeepSearch_Task_${i}`,
                        container: this.container,
                        rectangles: rawRects, // Send raw rects
                        method: 'executeFinalSheet_Worker', // Special method we added to worker
                        params: [rawRects, iterationsPerTask]
                    }).catch(err => {
                        console.error("Deep search task failed:", err);
                        return null;
                    })
                );
            }

            // Custom Race Logic for Final Sheet
            // Exit if we find a result that packs ALL items with very high density (e.g. maxX < 50% of container)
            // Note: The worker returns { placed, remaining, ... }
            const isGoodEnoughFinal = (res) => {
                if (!res || !res.placed) return false;
                // Check if all items placed
                if (res.remaining && res.remaining.length > 0) return false;

                // Check compactness
                let maxX = 0;
                res.placed.forEach(r => maxX = Math.max(maxX, r.x + r.width));

                // If we packed everything into less than 40% of the container width (arbitrary "good" threshold for last sheet)
                // Let's stick to: Packed everything AND very compact.
                return maxX < this.container.width * 0.45;
            };

            const raceToSuccessFinal = (promises) => {
                return new Promise((resolve) => {
                    let completedCount = 0;
                    const results = [];
                    let resolved = false;

                    promises.forEach(p => {
                        p.then(res => {
                            if (resolved) return;

                            results.push(res);
                            completedCount++;

                            if (res && res.result && isGoodEnoughFinal(res.result)) {
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

            const results = await raceToSuccessFinal(promises);
            results.forEach(taskRes => {
                if (taskRes && taskRes.result) {
                    updateBest(taskRes.result);
                }
            });

        } else {
            // Synchronous Deep Search (Worker Thread)
            // Since we are already in a worker, we can just run the batch logic locally.
            // We run ONE batch with the full iteration count (or slightly reduced if needed)
            const batchResult = this._runDeepSearchBatch(rawRects, TOTAL_ITERATIONS);
            if (batchResult) {
                updateBest({ ...batchResult, strategyName: 'Final_DeepSearch_Sync' });
            }
        }

        return bestResult;
    }

    // New helper method for the worker to call
    _runDeepSearchBatch(rectanglesToPack, iterations) {
        const rawRects = rectanglesToPack.map(r => ({ ...r }));
        let bestLocal = null;
        const MAX_TIME_MS = 5000; // Safety timeout per batch
        const startTime = Date.now();

        const evaluateAndSave = (placed, remaining, strategyName) => {
            let maxX = 0;
            let maxY = 0;
            placed.forEach(r => {
                maxX = Math.max(maxX, r.x + r.width);
                maxY = Math.max(maxY, r.y + r.length);
            });
            const current = { placed, remaining, count: placed.length, maxX, maxY, strategyName };

            if (!bestLocal) {
                bestLocal = current;
                return;
            }

            if (current.count > bestLocal.count) {
                bestLocal = current;
            }
            else if (current.count === bestLocal.count) {
                if (current.maxX < bestLocal.maxX - 0.5) {
                    bestLocal = current;
                }
                else if (Math.abs(current.maxX - bestLocal.maxX) <= 0.5 && current.maxY < bestLocal.maxY) {
                    bestLocal = current;
                }
            }
        };

        for (let i = 0; i < iterations; i++) {
            if (Date.now() - startTime > MAX_TIME_MS) break;

            const shuffled = this.shuffleArray(rawRects.map(r => ({ ...r })));
            const res = this._maxRectsPackLeft(shuffled, false);

            // Only save if it's a "good" result (e.g. packs everything or packs more than before)
            // To save memory transfer, we might only want to return the VERY best of this batch.
            evaluateAndSave(res.placed, res.remaining, `DeepSearch_Iter_${i}`);
        }

        return bestLocal; // This will be sent back to main thread
    }

    run2DPacking(rectanglesToPack) {
        return this.execute(rectanglesToPack);
    }
}

export default HybridStrategy;