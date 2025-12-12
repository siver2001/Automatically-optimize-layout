import PackingAlgorithm from '../algorithms/packingAlgorithm.js';
import WorkerPool from '../algorithms/workers/WorkerPool.js';

class PackingOrchestrator {
    constructor() {
        this.packingAlgorithm = new PackingAlgorithm();
    }

    // ============================================================
    // HELPERS (Replicated from PackingContext.js)
    // ============================================================

    _getNewRectId(counterRef) {
        return counterRef.current++;
    }

    // --- SPLIT LOGIC ---
    _splitRectangles(rectangles, quantities, strategy, unsplitableRectIds = []) {
        let pool = [];
        let poolCounter = 0;
        const MIN_SPLIT_WIDTH = 10;

        const selectedTypes = rectangles.filter(r => (quantities[r.id] || 0) > 0);

        if (strategy === 'FULL_SIZE') {
            for (const rectType of selectedTypes) {
                const quantity = quantities[rectType.id] || 0;
                for (let i = 0; i < quantity; i++) {
                    pool.push({
                        ...rectType,
                        id: `full_size_${poolCounter++}`,
                        typeId: rectType.id,
                        originalTypeId: rectType.id,
                        pairId: null,
                        pieceIndex: 0,
                        splitDirection: 'none',
                        originalWidth: rectType.width,
                        originalLength: rectType.length,
                        transform: { originalWidth: rectType.width, originalLength: rectType.length, splitAxis: 'none' },
                        name: rectType.name,
                        color: rectType.color
                    });
                }
            }
        } else {
            for (const rectType of selectedTypes) {
                const quantity = quantities[rectType.id] || 0;
                const isRestricted = unsplitableRectIds.includes(rectType.id);
                const halfWidth = rectType.width / 2;
                const canSplit = !isRestricted && (halfWidth >= MIN_SPLIT_WIDTH);

                for (let i = 0; i < quantity; i++) {
                    if (canSplit) {
                        const pairId = `pair_${rectType.id}_${i}`;
                        const meta = {
                            originalWidth: rectType.width,
                            originalLength: rectType.length,
                            splitAxis: 'width',
                            pieceWidth: halfWidth,
                            pieceLength: rectType.length,
                            expectedOrientation: 'horizontal'
                        };
                        pool.push({
                            ...rectType,
                            id: `half_${poolCounter++}`,
                            typeId: rectType.id,
                            originalTypeId: rectType.id,
                            pairId: pairId,
                            pieceIndex: 1,
                            splitDirection: 'width',
                            width: halfWidth,
                            length: rectType.length,
                            originalWidth: rectType.width,
                            originalLength: rectType.length,
                            transform: { ...meta },
                            transform: { ...meta },
                            name: `1/2 ${rectType.name}`,
                            originalName: rectType.name,
                            color: rectType.color
                        });
                        pool.push({
                            ...rectType,
                            id: `half_${poolCounter++}`,
                            typeId: rectType.id,
                            originalTypeId: rectType.id,
                            pairId: pairId,
                            pieceIndex: 2,
                            splitDirection: 'width',
                            width: halfWidth,
                            length: rectType.length,
                            originalWidth: rectType.width,
                            originalLength: rectType.length,
                            transform: { ...meta },
                            transform: { ...meta },
                            name: `1/2 ${rectType.name}`,
                            originalName: rectType.name,
                            color: rectType.color
                        });
                    } else {
                        pool.push({
                            ...rectType,
                            id: `full_${poolCounter++}`,
                            typeId: rectType.id,
                            originalTypeId: rectType.id,
                            pairId: null,
                            pieceIndex: 0,
                            splitDirection: 'none',
                            originalWidth: rectType.width,
                            originalLength: rectType.length,
                            transform: { originalWidth: rectType.width, originalLength: rectType.length, splitAxis: 'none' },
                            name: rectType.name,
                            color: rectType.color
                        });
                    }
                }
            }
        }
        return pool;
    }

    // --- MERGE LOGIC ---
    _runMergePhase(allPlacedPieces) {
        const mergedRects = [];
        const tolerance = 1.0;

        // Full pieces
        const fullPieces = allPlacedPieces.filter(r => r.pairId == null || r.splitDirection === 'none');
        mergedRects.push(...fullPieces);

        // Half pieces
        let halfPieces = allPlacedPieces.filter(r => r.pairId != null && r.splitDirection !== 'none');
        const processedPieces = new Set();

        halfPieces.sort((a, b) => a.plateIndex - b.plateIndex || a.layer - b.layer || a.y - b.y || a.x - b.x);

        for (let i = 0; i < halfPieces.length; i++) {
            const p1 = halfPieces[i];
            if (processedPieces.has(p1.id)) continue;

            let foundPair = false;
            const originalW = p1.originalWidth;
            const originalL = p1.originalLength;

            for (let j = i + 1; j < halfPieces.length; j++) {
                const p2 = halfPieces[j];
                if (processedPieces.has(p2.id)) continue;
                if (p1.plateIndex !== p2.plateIndex || p1.layer !== p2.layer) continue;
                if (p1.originalTypeId !== p2.originalTypeId) continue;

                let adjacent = false;
                let boundingW = 0, boundingL = 0, minX = 0, minY = 0;

                // Check adjacency (simplified for brevity, assume same logic as context)
                // 1. p2 right of p1
                if (Math.abs(p1.y - p2.y) < tolerance && Math.abs((p1.x + p1.width) - p2.x) < tolerance && Math.abs(p1.length - p2.length) < tolerance) {
                    adjacent = true; minX = p1.x; minY = p1.y; boundingW = p1.width + p2.width; boundingL = p1.length;
                }
                // 2. p1 right of p2
                else if (Math.abs(p1.y - p2.y) < tolerance && Math.abs((p2.x + p2.width) - p1.x) < tolerance && Math.abs(p1.length - p2.length) < tolerance) {
                    adjacent = true; minX = p2.x; minY = p1.y; boundingW = p1.width + p2.width; boundingL = p1.length;
                }
                // 3. p2 below p1
                else if (Math.abs(p1.x - p2.x) < tolerance && Math.abs((p1.y + p1.length) - p2.y) < tolerance && Math.abs(p1.width - p2.width) < tolerance) {
                    adjacent = true; minX = p1.x; minY = p1.y; boundingW = p1.width; boundingL = p1.length + p2.length;
                }
                // 4. p1 below p2
                else if (Math.abs(p1.x - p2.x) < tolerance && Math.abs((p2.y + p2.length) - p1.y) < tolerance && Math.abs(p1.width - p2.width) < tolerance) {
                    adjacent = true; minX = p2.x; minY = p2.y; boundingW = p1.width; boundingL = p1.length + p2.length;
                }

                if (!adjacent) continue;

                // Check merge size
                let mergedRect = null;
                if (Math.abs(boundingW - originalW) < tolerance && Math.abs(boundingL - originalL) < tolerance) {
                    mergedRect = { width: originalW, length: originalL, rotated: false };
                } else if (Math.abs(boundingW - originalL) < tolerance && Math.abs(boundingL - originalW) < tolerance) {
                    mergedRect = { width: originalL, length: originalW, rotated: true };
                }

                if (mergedRect) {
                    mergedRects.push({
                        ...mergedRect,
                        id: `merged_${p1.id}_${p2.id}`,
                        plateIndex: p1.plateIndex,
                        layer: p1.layer,
                        x: minX,
                        y: minY,
                        color: p1.color,
                        name: p1.originalName || p1.name, // Restore original name if available
                        typeId: p1.originalTypeId,
                        originalTypeId: p1.originalTypeId,
                        pairId: null,
                        mergedFrom: [p1.id, p2.id]
                    });
                    processedPieces.add(p1.id);
                    processedPieces.add(p2.id);
                    foundPair = true;
                    break;
                }
            }
            if (!foundPair && !processedPieces.has(p1.id)) {
                mergedRects.push(p1);
                processedPieces.add(p1.id);
            }
        }
        return mergedRects;
    }

    _checkOverlap(rect, existingRects, tolerance = 0.1) {
        for (const e of existingRects) {
            const overlapX = !(rect.x + rect.width <= e.x + tolerance || rect.x >= e.x + e.width - tolerance);
            const overlapY = !(rect.y + rect.length <= e.y + tolerance || rect.y >= e.y + e.length - tolerance);
            if (overlapX && overlapY) return true;
        }
        return false;
    }

    _findBestPositionSmart(rect, existingRects, containerWidth, containerLength) {
        let bestPos = null;
        let bestScore = Infinity;

        const orientations = [
            { w: rect.width, l: rect.length, r: rect.rotated || false },
            { w: rect.length, l: rect.width, r: !(rect.rotated || false) }
        ];

        const candidates = [{ x: 0, y: 0 }];
        existingRects.forEach(e => {
            candidates.push({ x: e.x + e.width, y: e.y });
            candidates.push({ x: e.x, y: e.y + e.length });
        });

        for (const ori of orientations) {
            const { w, l, r } = ori;
            if (w > containerWidth || l > containerLength) continue;

            for (const p of candidates) {
                if (p.x + w > containerWidth || p.y + l > containerLength) continue;

                const testRect = { x: p.x, y: p.y, width: w, length: l };
                if (this._checkOverlap(testRect, existingRects)) continue;

                let score = p.y * containerWidth + p.x;
                let aligns = false;

                for (const e of existingRects) {
                    if (Math.abs(e.x + e.width - p.x) < 0.1 && Math.abs(e.length - l) < 0.1 && Math.abs(e.y - p.y) < 0.1) {
                        score -= 500000; aligns = true;
                    }
                    if (Math.abs(e.y + e.length - p.y) < 0.1 && Math.abs(e.width - w) < 0.1 && Math.abs(e.x - p.x) < 0.1) {
                        score -= 500000; aligns = true;
                    }
                }

                if (!aligns && r !== (rect.rotated || false)) score += 1000;

                if (score < bestScore) {
                    bestScore = score;
                    bestPos = { x: p.x, y: p.y, width: w, length: l, rotated: r };
                }
            }
        }
        return bestPos;
    }

    _repackPlateToCompletePairs(rectsInPlateLayer, container, tolerance = 0.5) {
        // 1) tách half chưa merge
        const halfs = rectsInPlateLayer.filter(r => r.pairId && r.originalTypeId && r.originalWidth && r.originalLength);

        // group theo type
        const byType = new Map();
        for (const r of halfs) {
            const key = r.originalTypeId;
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key).push(r);
        }

        // 2) tạo full candidates từ các half pairs
        const usedHalfIds = new Set();
        const fullCandidates = [];

        const typeEntries = Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length);
        for (const [, arr] of typeEntries) {
            // ghép theo cặp: 2 half => 1 full
            // (nếu bạn có rule left/right thì ghép đúng left+right ở đây)
            for (let i = 0; i + 1 < arr.length; i += 2) {
                const a = arr[i], b = arr[i + 1];
                if (usedHalfIds.has(a.id) || usedHalfIds.has(b.id)) continue;

                usedHalfIds.add(a.id); usedHalfIds.add(b.id);

                fullCandidates.push({
                    id: `full_from_${a.id}_${b.id}`,
                    width: a.originalWidth,
                    length: a.originalLength,
                    typeId: a.originalTypeId,
                    originalTypeId: a.originalTypeId,
                    originalName: a.originalName || a.name,
                    mergedFrom: [a.id, b.id],
                    // giữ plateIndex/layer để rebuild
                    plateIndex: a.plateIndex,
                    layer: a.layer,
                    pairId: null,
                });
            }
        }

        if (fullCandidates.length === 0) return null;

        // 3) items để repack: bỏ các half đã dùng, thêm fullCandidates
        const keep = rectsInPlateLayer.filter(r => !usedHalfIds.has(r.id));
        const items = [...fullCandidates, ...keep].map(r => ({
            ...r,
            x: 0, y: 0, rotated: false
        }));

        // 4) repack lại tấm bằng findBestPositionSmart (giống consolidation)
        const placed = [];
        for (const item of items) {
            const bestPos = this._findBestPositionSmart(item, placed, container.width, container.length);
            if (!bestPos) return null; // fail => không thay đổi
            placed.push({ ...item, ...bestPos });
        }

        return placed; // success => layout mới của tấm
    }

    // --- REBUILD LOGIC ---
    _runRebuildPhase(mergedRects) {
        const newFinalPlates = [];
        const plateMap = new Map();
        let displayIdCounter = 1;

        mergedRects.sort((a, b) => a.plateIndex - b.plateIndex || a.layer - b.layer);

        for (const rect of mergedRects) {
            // Re-assign polite IDs for display
            if (rect.id.startsWith('merged_') || rect.id.startsWith('full_')) {
                rect.id = `rect_${displayIdCounter++}`;
            } else if (rect.pairId && !rect.id.startsWith('rect_half_')) {
                rect.id = `rect_half_${displayIdCounter++}`;
            }

            if (!plateMap.has(rect.plateIndex)) {
                plateMap.set(rect.plateIndex, {
                    plateIndex: rect.plateIndex,
                    description: `Tấm ${rect.plateIndex + 1}`,
                    layers: new Map()
                });
            }
            const plateData = plateMap.get(rect.plateIndex);
            if (!plateData.layers.has(rect.layer)) {
                plateData.layers.set(rect.layer, { layerIndexInPlate: rect.layer, rectangles: [] });
            }
            plateData.layers.get(rect.layer).rectangles.push(rect);
        }

        for (const [, plateData] of plateMap.entries()) {
            newFinalPlates.push({
                ...plateData,
                layers: Array.from(plateData.layers.values()).sort((a, b) => a.layerIndexInPlate - b.layerIndexInPlate)
            });
        }
        return newFinalPlates.sort((a, b) => a.plateIndex - b.plateIndex);
    }

    // --- CONSOLIDATION LOGIC (Smart Shelf FFD) ---
    _runConsolidationPhase(finalPlates, container) {
        // 1. Gather Single-Layer Plates
        const singleLayerPlates = finalPlates.filter(p => p.layers.length === 1);

        // Only trigger if we have multiple single-layer plates to merge
        if (singleLayerPlates.length <= 1) return finalPlates;

        const platesToRemove = new Set(singleLayerPlates.map(p => p.plateIndex));

        // 2. Gather Items & Sort (Height Priority)
        let allItems = singleLayerPlates.flatMap(p => p.layers[0].rectangles.map(r => ({ ...r })));
        allItems.sort((a, b) => {
            const hA = Math.min(a.width, a.length);
            const hB = Math.min(b.width, b.length);
            // 1. Prioritize Height (Main Axis - Descending)
            if (Math.abs(hB - hA) > 1.0) return hB - hA;

            const wA = Math.max(a.width, a.length);
            const wB = Math.max(b.width, b.length);
            // 2. Prioritize Width (Secondary Axis - Descending)
            if (Math.abs(wB - wA) > 1.0) return wB - wA;

            // 3. Prioritize Pair (Keep halves together)
            const pairA = a.pairId || '';
            const pairB = b.pairId || '';
            if (pairA !== pairB) return pairA.localeCompare(pairB);

            // 4. Prioritize Type (Keep same products together)
            const typeA = a.typeId || 0;
            const typeB = b.typeId || 0;
            return typeA - typeB;
        });

        // 3. Pack into Consolidated Plates
        const multiLayerPlates = finalPlates.filter(p => !platesToRemove.has(p.plateIndex));
        const newConsolidatedPlates = [];
        let newPlateCounter = multiLayerPlates.length; // Approximate index base

        const { width: cW, length: cL } = container;

        for (const item of allItems) {
            let placed = false;
            // Try existing consolidated bins
            for (const bin of newConsolidatedPlates) {
                const targetRects = bin.layers[0].rectangles;
                const bestPos = this._findBestPositionSmart(item, targetRects, cW, cL);
                if (bestPos) {
                    targetRects.push({
                        ...item,
                        x: bestPos.x, y: bestPos.y, width: bestPos.width, length: bestPos.length, rotated: bestPos.rotated,
                        layer: 0, plateIndex: bin.plateIndex
                    });
                    placed = true;
                    break;
                }
            }

            // New bin
            if (!placed) {
                const newPlateIndex = newPlateCounter++; // Temp ID
                const bestPos = this._findBestPositionSmart(item, [], cW, cL); // Should always succeed for first item
                if (bestPos) {
                    const newBin = {
                        plateIndex: newPlateIndex,
                        type: 'mixed',
                        description: `Tấm Gộp (Temp)`,
                        layers: [{
                            layerIndexInPlate: 0,
                            rectangles: [{
                                ...item,
                                ...bestPos,
                                layer: 0, plateIndex: newPlateIndex
                            }]
                        }]
                    };
                    newConsolidatedPlates.push(newBin);
                } else {
                    // Critical failure (item too big?), should not happen if came from single plate.
                    // Fallback: keep original plate logic? No, just push as new plate.
                }
            }
        }

        // Return merged list
        const combined = [...multiLayerPlates, ...newConsolidatedPlates];
        // Re-index
        combined.forEach((p, idx) => {
            p.plateIndex = idx;
            p.layers.forEach(l => l.rectangles.forEach(r => r.plateIndex = idx));
            if (newConsolidatedPlates.includes(p)) p.description = `Tấm Gộp #${idx + 1}`;
        });

        return combined;
    }



    // ============================================================
    // CORE ORCHESTRATION
    // ============================================================
    async optimizeBatch(container, rectangles, quantities, strategy, unsplitableRectIds, layersPerPlate, onProgress) {
        // 1. Split
        let pool = this._splitRectangles(rectangles, quantities, strategy, unsplitableRectIds);

        let allPlacedRectangles = [];
        let plateIndexCounter = 0;
        const mixedPatterns = new Map(); // signature -> { plateIndex, currentLayerCount }
        const MAX_ITERATIONS = 10000;
        let iterationCount = 0;
        const initialPoolSize = pool.length; // Save for progress calc

        const createPatternSignature = (placed) => {
            const layer0Rects = placed.filter(r => r.layer === 0);
            const sorted = [...layer0Rects].sort((a, b) => {
                if (a.typeId !== b.typeId) return a.typeId - b.typeId;
                if (a.x !== b.x) return a.x - b.x;
                return a.y - b.y;
            });
            return sorted.map(r => `${r.typeId}:${r.x}:${r.y}:${r.width}:${r.length}:${r.rotated ? 1 : 0}`).join('|');
        };

        while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
            iterationCount++;

            // Report Progress
            if (onProgress && initialPoolSize > 0) {
                const progress = Math.round(((initialPoolSize - pool.length) / initialPoolSize) * 90); // Cap at 90% during loop
                onProgress(progress);
            }

            // --- PARALLEL STRATEGY EXECUTION ---
            const strategies = [
                {
                    name: 'Area Descending', sort: (a, b) => {
                        const areaDiff = (b.width * b.length) - (a.width * a.length);
                        if (Math.abs(areaDiff) > 0.1) return areaDiff;
                        return (a.pairId || '').localeCompare(b.pairId || '');
                    }
                },
                {
                    name: 'Max Dimension', sort: (a, b) => {
                        const dimDiff = Math.max(b.width, b.length) - Math.max(a.width, a.length);
                        if (Math.abs(dimDiff) > 0.1) return dimDiff;
                        return (a.pairId || '').localeCompare(b.pairId || '');
                    }
                },
                {
                    name: 'Perimeter', sort: (a, b) => {
                        const perimDiff = (2 * (b.width + b.length)) - (2 * (a.width + a.length));
                        if (Math.abs(perimDiff) > 0.1) return perimDiff;
                        return (a.pairId || '').localeCompare(b.pairId || '');
                    }
                },
                {
                    name: 'Aspect Ratio', sort: (a, b) => {
                        const ra = Math.max(a.width, a.length) / Math.min(a.width, a.length);
                        const rb = Math.max(b.width, b.length) / Math.min(b.width, b.length);
                        return (ra - rb) || (a.pairId || '').localeCompare(b.pairId || '');
                    }
                }
            ];

            let bestBatchResult = null;
            let bestBatchArea = 0;

            // Helper to run workers with Early Exit
            const runStrategiesParallel = () => {
                return new Promise((resolve) => {
                    let pending = strategies.length;
                    const results = [];
                    let finished = false;

                    strategies.forEach(strat => {
                        // Cloning pool for sorting to avoid mutation issues implies we need fresh copies or just sort a new array of references
                        // Since objects are same, sort order changes. 
                        // Spread operator [...pool] creates shallow copy of array, which is enough for sorting references.
                        const sortedPool = [...pool].sort(strat.sort);

                        WorkerPool.executeTask({
                            id: `strat_${strat.name}_${iterationCount}`,
                            method: 'optimize',
                            params: [{ ...container, layers: 1 }, sortedPool, 1, 'AREA_OPTIMIZED']
                        }).then(msg => {
                            if (finished) return;

                            const res = msg.result;
                            const placed = (res.rectangles || []).filter(r => r.x !== undefined && r.width > 0);
                            const totalArea = placed.reduce((sum, r) => sum + (r.width * r.length), 0);
                            const efficiency = res.efficiency || 0;

                            // EARLY EXIT: If efficiency is very high (> 96%), take it and run.
                            if (efficiency > 96) {
                                finished = true;
                                resolve([{ placed, totalArea, efficiency, strategy: strat.name }]); // Return immediately
                                return;
                            }

                            results.push({ placed, totalArea, efficiency, strategy: strat.name });
                            pending--;
                            if (pending === 0) {
                                resolve(results);
                            }
                        }).catch(err => {
                            console.error(`Strategy ${strat.name} failed:`, err);
                            pending--;
                            if (pending === 0 && !finished) {
                                resolve(results);
                            }
                        });
                    });
                });
            };

            const strategyResults = await runStrategiesParallel();

            // Find best result
            for (const res of strategyResults) {
                if (res.totalArea > bestBatchArea) {
                    bestBatchArea = res.totalArea;
                    // Clone result to avoid reference issues
                    bestBatchResult = res.placed.map(r => ({ ...r }));
                }
            }

            if (!bestBatchResult || bestBatchResult.length === 0) break;

            // --- ASSIGN PLATE ---
            const signature = createPatternSignature(bestBatchResult.map(r => ({ ...r, layer: 0 })));

            let targetPlateIndex;
            let targetLayer;

            if (mixedPatterns.has(signature)) {
                const patternState = mixedPatterns.get(signature);
                if (patternState.currentLayerCount >= layersPerPlate) {
                    // Start new plate
                    patternState.plateIndex = plateIndexCounter++;
                    patternState.currentLayerCount = 0;
                }
                targetPlateIndex = patternState.plateIndex;
                targetLayer = patternState.currentLayerCount;
                patternState.currentLayerCount++;
            } else {
                // New pattern
                const newPlateIndex = plateIndexCounter++;
                mixedPatterns.set(signature, {
                    plateIndex: newPlateIndex,
                    currentLayerCount: 1
                });
                targetPlateIndex = newPlateIndex;
                targetLayer = 0;
            }

            // --- SAVE ---
            bestBatchResult.forEach(r => {
                allPlacedRectangles.push({
                    ...r,
                    plateIndex: targetPlateIndex,
                    layer: targetLayer
                });
            });

            // --- REMOVE FROM POOL ---
            const usedIds = new Set(bestBatchResult.map(r => r.id));
            pool = pool.filter(r => !usedIds.has(r.id));
        }

        // 3. Merge Phase
        const mergedRects = this._runMergePhase(allPlacedRectangles);

        // 4. Rebuild Phase (Format for UI)
        let finalPlates = this._runRebuildPhase(mergedRects);

        // 5. Consolidation Phase (Smart Shelf)
        finalPlates = this._runConsolidationPhase(finalPlates, container);

        // 5.5 Re-Merge & Re-Rebuild (to ensure consolidation result is clean)
        // Extract all pieces from consolidated plates
        const piecesToReMerge = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));

        // Re-Merge
        const reMergedRects = this._runMergePhase(piecesToReMerge);

        // Re-Rebuild
        finalPlates = this._runRebuildPhase(reMergedRects);
        // ===== 6) FINAL REPACK LAST PLATE TO COMPLETE 1/2 -> FULL =====
        const lastPlateIndex = Math.max(...finalPlates.map(p => p.plateIndex));

        for (const plate of finalPlates) {
            if (plate.plateIndex !== lastPlateIndex) continue;

            for (const layer of plate.layers) {
                const repacked = this._repackPlateToCompletePairs(layer.rectangles, container);
                if (repacked) {
                    // giữ đúng metadata
                    repacked.forEach(r => { r.plateIndex = plate.plateIndex; r.layer = layer.layerIndexInPlate; });
                    layer.rectangles = repacked;
                }
            }
        }

        // Sau khi repack xong: merge lại lần nữa để UI hiển thị "size nguyên" sạch
        const afterRepackPieces = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
        const afterRepackMerged = this._runMergePhase(afterRepackPieces);
        finalPlates = this._runRebuildPhase(afterRepackMerged);
        return {
            success: true,
            packingResult: {
                plates: finalPlates,
                rectangles: afterRepackMerged
            }
        };
    }
}

export default new PackingOrchestrator();