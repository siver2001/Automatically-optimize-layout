import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
    constructor(container) {
        super(container);
    }

    // =========================================================================
    // PHẦN 1: CÁC HÀM HELPER (CÔNG CỤ HỖ TRỢ)
    // =========================================================================

    // [HELPER 1] Tạo "Hạt giống thông minh" (Smart Seed)
    // Ưu tiên các tấm có kích thước bù trừ tốt với chiều rộng container
    _createSmartSeed(rectangles) {
        const containerWidth = this.container.width;
        return rectangles.slice().sort((a, b) => {
            const remA = containerWidth % a.width;
            const remB = containerWidth % b.width;
            return remA - remB;
        });
    }

    // [HELPER 2] TẠO SUPER-RECTANGLES (GỘP CÁC TẤM NHỎ THÀNH KHỐI LỚN)
    _createSuperRectangles(originalRects, tolerance = 0.001) {
        // 1. Clone dữ liệu để không ảnh hưởng mảng gốc
        let pool = originalRects.map(r => ({ ...r }));
        let superRects = [];

        // Giới hạn ghép: Không ghép quá lớn để tránh không nhét vừa container
        const MAX_MERGE_SIZE = Math.max(this.container.width, this.container.length);

        // Sắp xếp: Ưu tiên xử lý các tấm nhỏ/hẹp trước để ghép chúng vào nhau
        // Logic: Diện tích nhỏ xử lý trước
        pool.sort((a, b) => (a.width * a.length) - (b.width * b.length));

        while (pool.length > 0) {
            let current = pool.pop(); // Lấy 1 tấm ra
            let merged = false;

            // Tìm "người tình" phù hợp trong pool
            for (let i = pool.length - 1; i >= 0; i--) {
                let candidate = pool[i];

                // CASE A: Ghép Chồng (Cùng chiều Rộng) -> Tăng chiều Dài (Vertical Merge)
                if (Math.abs(current.width - candidate.width) < tolerance) {
                    const newLength = current.length + candidate.length;
                    if (newLength <= MAX_MERGE_SIZE) {
                        let newRect = {
                            ...current,
                            id: `super_${current.id}_${candidate.id}`,
                            length: newLength,
                            // Lưu trữ cấu trúc con để sau này bung ra
                            subRects: [
                                ...(current.subRects || [{ ...current, relX: 0, relY: 0 }]),
                                // Tấm thứ 2 nằm dưới tấm thứ 1 (Y tăng)
                                ...(candidate.subRects || [{ ...candidate, relX: 0, relY: 0 }]).map(r => ({ ...r, relY: r.relY + current.length }))
                            ]
                        };
                        pool.splice(i, 1); // Xóa candidate khỏi pool
                        pool.push(newRect); // Đẩy tấm mới ghép vào pool để thử ghép tiếp
                        merged = true;
                        break;
                    }
                }

                // CASE B: Ghép Ngang (Cùng chiều Dài) -> Tăng chiều Rộng (Horizontal Merge)
                else if (Math.abs(current.length - candidate.length) < tolerance) {
                    const newWidth = current.width + candidate.width;
                    if (newWidth <= MAX_MERGE_SIZE) {
                        let newRect = {
                            ...current,
                            id: `super_${current.id}_${candidate.id}`,
                            width: newWidth,
                            subRects: [
                                ...(current.subRects || [{ ...current, relX: 0, relY: 0 }]),
                                // Tấm thứ 2 nằm bên phải tấm thứ 1 (X tăng)
                                ...(candidate.subRects || [{ ...candidate, relX: 0, relY: 0 }]).map(r => ({ ...r, relX: r.relX + current.width }))
                            ]
                        };
                        pool.splice(i, 1);
                        pool.push(newRect);
                        merged = true;
                        break;
                    }
                }
            }

            // Nếu không ghép được với ai, đưa vào danh sách chốt
            if (!merged) {
                superRects.push(current);
            }
        }

        // Sắp xếp lại danh sách kết quả (Lớn trước) để chuẩn bị cho MaxRects
        return this.sortRectanglesByArea(superRects);
    }

    // [HELPER 3] BUNG SUPER-RECTANGLES RA (EXPLODE)
    // Chuyển đổi tọa độ của khối gộp thành tọa độ của từng tấm con
    _flattenSuperRectsResult(placedSuperRects, remainingSuperRects) {
        const finalPlaced = [];
        const finalRemaining = [];

        // 1. Bung danh sách đã xếp
        placedSuperRects.forEach(superRect => {
            if (superRect.subRects) {
                superRect.subRects.forEach(sub => {
                    let finalX, finalY, finalW, finalL, finalRotated;

                    if (superRect.rotated) {
                        // Nếu Super Rect bị xoay 90 độ
                        finalW = sub.length; // Con cũng bị xoay theo kích thước
                        finalL = sub.width;
                        finalRotated = !sub.rotated; // Đảo trạng thái xoay của con

                        // Tọa độ: X gốc + Y tương đối (đã xoay), Y gốc + X tương đối (đã xoay)
                        finalX = superRect.x + sub.relY;
                        finalY = superRect.y + sub.relX;
                    } else {
                        // Nếu Super Rect đứng thẳng
                        finalW = sub.width;
                        finalL = sub.length;
                        finalRotated = sub.rotated;

                        finalX = superRect.x + sub.relX;
                        finalY = superRect.y + sub.relY;
                    }

                    finalPlaced.push({
                        ...sub,
                        x: finalX,
                        y: finalY,
                        width: finalW,
                        length: finalL,
                        rotated: finalRotated,
                        layer: superRect.layer || 0,
                        relX: undefined, relY: undefined, subRects: undefined
                    });
                });
            } else {
                finalPlaced.push(superRect);
            }
        });

        // 2. Bung danh sách còn lại (Remaining)
        remainingSuperRects.forEach(superRect => {
            if (superRect.subRects) {
                superRect.subRects.forEach(sub => {
                    finalRemaining.push({ ...sub, relX: undefined, relY: undefined });
                });
            } else {
                finalRemaining.push(superRect);
            }
        });

        return { placed: finalPlaced, remaining: finalRemaining };
    }

    // =========================================================================
    // PHẦN 2: HÀM EXECUTE (QUẢN LÝ CHIẾN THUẬT)
    // =========================================================================

    execute(rectanglesToPack) {
        // Copy đầu vào một lần duy nhất để an toàn
        const rawRects = rectanglesToPack.map(r => ({ ...r }));
        const countTotal = rawRects.length;

        // --- CẤU HÌNH TÀI NGUYÊN ---
        const isLargeDataset = countTotal > 1000;
        const isSuperLarge = countTotal > 5000;

        let POPULATION_SIZE = 40;
        let GENERATIONS = 20;

        if (isSuperLarge) {
            POPULATION_SIZE = 10;
            GENERATIONS = 5;
        } else if (isLargeDataset) {
            POPULATION_SIZE = 25;
            GENERATIONS = 10;
        }

        // --- ĐỊNH NGHĨA DANH SÁCH CHIẾN THUẬT (ĐẤU TRƯỜNG) ---
        const strategies = [];

        // -----------------------------------------------------------------------
        // CHIẾN THUẬT 1: SUPER CLUSTERING MODE (Siêu Gộp - Tốc độ cao)
        // -----------------------------------------------------------------------
        strategies.push({
            name: 'Super_Clustering_Mode',
            fn: () => {
                // Bước 1: Gộp (Cho phép sai số 2mm để gộp được nhiều hơn)
                const superRects = this._createSuperRectangles(rawRects, 2);
                // Bước 2: Xếp (Dùng BSSF vì nó tốt cho các khối vuông)
                const packResult = this._maxRectsBSSF(superRects, false);
                // Bước 3: Bung
                return this._flattenSuperRectsResult(packResult.placed, packResult.remaining);
            }
        });

        // [EARLY EXIT 1] Nếu Super Clustering Mode đã làm tốt, dừng ngay
        // Chạy thử chiến thuật 1 trước
        const firstStrat = strategies[0];
        const firstRes = firstStrat.fn();

        if (firstRes) {
            const usedArea = firstRes.placed.reduce((sum, r) => sum + r.width * r.length, 0);
            const totalArea = this.container.width * this.container.length;
            const efficiency = totalArea > 0 ? (usedArea / totalArea) : 0;

            // Nếu hiệu suất > 93% và hết sạch vật tư -> Dừng luôn, khỏi chạy Genetic tốn kém
            if (firstRes.remaining.length === 0 && efficiency > 0.93) {
                return {
                    placed: firstRes.placed,
                    remaining: firstRes.remaining,
                    count: firstRes.placed.length,
                    usedArea,
                    alignmentScore: this._calculateAlignmentScore(firstRes.placed),
                    compactness: efficiency, // Xấp xỉ
                    strategyName: `FullSize_${firstStrat.name}_EarlyExit`
                };
            }
        }

        // Nếu chưa tốt, mới chạy tiếp các chiến thuật nặng đô
        // Lưu lại kết quả 1 để so sánh sau này
        let bestResult = null;
        if (firstRes) {
            const usedArea = firstRes.placed.reduce((sum, r) => sum + r.width * r.length, 0);
            const alignmentScore = this._calculateAlignmentScore(firstRes.placed);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            if (firstRes.placed.length > 0) {
                firstRes.placed.forEach(r => {
                    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
                    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.length);
                });
            } else { minX = 0; minY = 0; maxX = 0; maxY = 0; }
            const boundingArea = (maxX - minX) * (maxY - minY);
            const compactness = boundingArea > 0 ? (usedArea / boundingArea) : 0;

            bestResult = {
                placed: firstRes.placed,
                remaining: firstRes.remaining,
                count: firstRes.placed.length,
                usedArea, alignmentScore, compactness,
                strategyName: firstStrat.name
            };
        }

        // -----------------------------------------------------------------------
        // CHIẾN THUẬT 2: GENETIC HYBRID CHAOS V3 (Di truyền + Simulated Annealing)
        // -----------------------------------------------------------------------
        strategies.push({
            name: 'Genetic_Hybrid_Chaos_V3',
            fn: () => {
                let population = [];

                // A. TẠO QUẦN THỂ ĐA DẠNG
                population.push(this.sortRectanglesByArea(rawRects));          // Lớn -> Nhỏ
                population.push(this.sortRectanglesByAreaAscending(rawRects)); // Nhỏ -> Lớn
                population.push(this.sortRectanglesInterleaved(rawRects));     // Xen kẽ
                population.push(this._createSmartSeed(rawRects));              // Smart Seed

                // Random Shuffle
                const randomCount = POPULATION_SIZE - population.length;
                for (let i = 0; i < randomCount; i++) {
                    population.push(this.shuffleArray(rawRects.slice()));
                }

                let bestSolution = null;
                let bestScore = Infinity;
                const startTimeGA = Date.now();

                // B. VÒNG LẶP TIẾN HÓA
                for (let gen = 0; gen < GENERATIONS; gen++) {
                    // [TIME LIMIT] Nếu chạy quá 2 giây cho GA thì dừng
                    if (Date.now() - startTimeGA > 2000) break;

                    const results = population.map(individual => {
                        // [OPTIMIZATION] Dùng BAF (Best Area Fit) thay vì Contact Point cho GA
                        // BAF thường cho hiệu suất diện tích tốt hơn
                        const res = this._maxRectsBAF(individual, false);

                        const usedArea = res.placed.reduce((sum, r) => sum + r.width * r.length, 0);
                        const totalArea = this.container.width * this.container.length;
                        const wasteArea = totalArea - usedArea;

                        // Hàm mục tiêu: Phạt cực nặng nếu còn thừa ván
                        const penalty = res.remaining.length * 1000000000;

                        // Điểm số càng thấp càng tốt
                        const fitnessScore = wasteArea + penalty;

                        return { order: individual, score: fitnessScore, result: res };
                    });

                    results.sort((a, b) => a.score - b.score);

                    // Cập nhật Best Global
                    if (results[0].score < bestScore) {
                        bestScore = results[0].score;
                        bestSolution = results[0].result;
                    }

                    // Early Exit nếu hoàn hảo (Hết ván và hiệu suất cao)
                    if (bestSolution && bestSolution.remaining.length === 0 && (bestSolution.usedArea / (this.container.width * this.container.length)) > 0.95) {
                        return bestSolution;
                    }

                    // C. LAI GHÉP & ĐỘT BIẾN (Simulated Annealing Lite)
                    const ELITE_COUNT = Math.max(2, Math.floor(POPULATION_SIZE * 0.4));
                    const newPopulation = results.slice(0, ELITE_COUNT).map(r => r.order);

                    while (newPopulation.length < POPULATION_SIZE) {
                        // Lai ghép
                        const p1Idx = Math.floor(Math.random() * ELITE_COUNT);
                        const p2Idx = Math.floor(Math.random() * ELITE_COUNT);
                        const parent1 = newPopulation[p1Idx];
                        const parent2 = newPopulation[p2Idx];

                        const cutPoint = Math.floor(parent1.length / 2);
                        const child = parent1.slice(0, cutPoint);
                        const childIds = new Set(child.map(r => r.id));

                        for (const r of parent2) {
                            if (!childIds.has(r.id)) child.push(r);
                        }

                        // Đột biến: Swap ngẫu nhiên
                        // Tỷ lệ đột biến giảm dần theo thế hệ (Annealing)
                        const mutationRate = 0.5 * (1 - gen / GENERATIONS);
                        if (Math.random() < mutationRate && child.length > 1) {
                            const idxA = Math.floor(Math.random() * child.length);
                            const idxB = Math.floor(Math.random() * child.length);
                            [child[idxA], child[idxB]] = [child[idxB], child[idxA]];
                        }
                        newPopulation.push(child);
                    }
                    population = newPopulation;
                }
                return bestSolution || this._maxRectsBAF(this.sortRectanglesByArea(rawRects));
            }
        });

        // -----------------------------------------------------------------------
        // CHIẾN THUẬT 3: GENETIC SUPER CLUSTERING (Kết hợp cả 2 - Siêu Chiến Binh)
        // -----------------------------------------------------------------------
        strategies.push({
            name: 'Genetic_Super_Clustering',
            fn: () => {
                // Bước 1: Gộp thành khối (Tolerance 1mm)
                const superRects = this._createSuperRectangles(rawRects, 1);

                if (superRects.length > rawRects.length * 0.95) return null; // Bỏ qua nếu không gộp được nhiều

                // Bước 2: Chạy Genetic trên các khối Super Rects
                let population = [];
                const HYBRID_POP_SIZE = Math.max(10, Math.floor(POPULATION_SIZE * 0.6));
                const HYBRID_GEN = Math.max(5, Math.floor(GENERATIONS * 0.6));

                population.push(this.sortRectanglesByArea(superRects));
                population.push(this.shuffleArray(superRects.slice()));

                while (population.length < HYBRID_POP_SIZE) {
                    population.push(this.shuffleArray(superRects.slice()));
                }

                let bestLocalSol = null;
                let bestLocalScore = Infinity;
                const startTimeGA = Date.now();

                for (let gen = 0; gen < HYBRID_GEN; gen++) {
                    if (Date.now() - startTimeGA > 1500) break; // Time limit 1.5s

                    const results = population.map(individual => {
                        const res = this._maxRectsBAF(individual, false); // Dùng BAF

                        const usedArea = res.placed.reduce((sum, r) => sum + r.width * r.length, 0);
                        const totalArea = this.container.width * this.container.length;
                        const waste = totalArea - usedArea;
                        const penalty = res.remaining.length * 1000000000;

                        const score = waste + penalty;
                        return { order: individual, score, result: res };
                    });

                    results.sort((a, b) => a.score - b.score);

                    if (results[0].score < bestLocalScore) {
                        bestLocalScore = results[0].score;
                        bestLocalSol = results[0].result;
                    }

                    // Lai ghép đơn giản
                    const ELITE = 3;
                    const newPop = results.slice(0, ELITE).map(r => r.order);
                    while (newPop.length < HYBRID_POP_SIZE) {
                        const p1 = newPop[Math.floor(Math.random() * ELITE)];
                        const child = p1.slice();
                        // Mutation only
                        if (Math.random() < 0.4) {
                            const i1 = Math.floor(Math.random() * child.length);
                            const i2 = Math.floor(Math.random() * child.length);
                            [child[i1], child[i2]] = [child[i2], child[i1]];
                        }
                        newPop.push(child);
                    }
                    population = newPop;
                }

                if (bestLocalSol) {
                    return this._flattenSuperRectsResult(bestLocalSol.placed, bestLocalSol.remaining);
                }
                return null;
            }
        });

        // -----------------------------------------------------------------------
        // CÁC CHIẾN THUẬT DỰ PHÒNG (FALLBACK)
        // -----------------------------------------------------------------------
        let rectsAreaForFallback = null;
        if (!isSuperLarge) {
            rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
            const rectsShuffled = this.shuffleArray(rawRects.map(r => ({ ...r })));

            strategies.push(
                { name: 'MaxRects_BAF_Area', fn: () => this._maxRectsBAF(rectsAreaForFallback, false) }, // [NEW] BAF
                { name: 'MaxRects_BSSF_Area', fn: () => this._maxRectsBSSF(rectsAreaForFallback, false) },
                { name: 'MaxRects_BSSF_Random', fn: () => this._maxRectsBSSF(rectsShuffled, false) }
            );
        } else {
            rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
            strategies.push({ name: 'MaxRects_BAF_Area', fn: () => this._maxRectsBAF(rectsAreaForFallback, false) });
        }

        // =======================================================================
        // PHẦN 3: ĐẤU TRƯỜNG - SO SÁNH VÀ CHỌN NGƯỜI CHIẾN THẮNG
        // =======================================================================

        // Lưu ý: strategies[0] đã chạy ở trên rồi, nhưng logic vòng lặp dưới đây sẽ chạy lại nó
        // Để tối ưu, ta bỏ qua strategies[0] trong vòng lặp này
        for (let i = 1; i < strategies.length; i++) {
            const strat = strategies[i];
            const result = strat.fn();
            if (!result) continue;

            const count = result.placed.length;
            const usedArea = result.placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
            const alignmentScore = this._calculateAlignmentScore(result.placed);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            if (result.placed.length > 0) {
                result.placed.forEach(r => {
                    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
                    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.length);
                });
            } else { minX = 0; minY = 0; maxX = 0; maxY = 0; }

            const boundingArea = (maxX - minX) * (maxY - minY);
            const compactness = boundingArea > 0 ? (usedArea / boundingArea) : 0;

            const currentResult = {
                placed: result.placed,
                remaining: result.remaining,
                count, usedArea, alignmentScore, compactness,
                strategyName: strat.name
            };

            if (!bestResult) {
                bestResult = currentResult;
                continue;
            }

            // Logic so sánh: Số lượng > Hiệu suất diện tích (Used Area) > Độ nén
            if (currentResult.count > bestResult.count) {
                bestResult = currentResult;
            } else if (currentResult.count === bestResult.count) {
                // [OPTIMIZATION] Ưu tiên diện tích sử dụng thực tế (Used Area)
                // Nếu xếp được nhiều diện tích hơn (ít lãng phí hơn) -> Chọn
                if (currentResult.usedArea > bestResult.usedArea + 100) {
                    bestResult = currentResult;
                } else if (currentResult.usedArea >= bestResult.usedArea - 100) {
                    // Nếu diện tích ngang nhau, chọn cái nào nén chặt hơn (compactness)
                    if (currentResult.compactness > bestResult.compactness + 0.01) {
                        bestResult = currentResult;
                    }
                }
            }
        }

        if (bestResult) {
            bestResult.strategyName = `FullSize_${bestResult.strategyName} `;
        }

        return bestResult;
    }
}

export default FullSizeStrategy;