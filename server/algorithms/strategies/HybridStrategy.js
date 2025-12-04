import BaseStrategy from './BaseStrategy.js';

class HybridStrategy extends BaseStrategy {
    constructor(container) {
        super(container);
    }

    execute(rectanglesToPack) {
        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // 1. CHUẨN BỊ DỮ LIỆU
        const stripHorizontalData = this.preAlignRectangles(rawRects, 'horizontal');
        const sortedByHeight = this.sortRectanglesByHeight(stripHorizontalData);

        const stripVerticalData = this.preAlignRectangles(rawRects, 'vertical');
        const sortedByWidth = this.sortRectanglesByHeight(stripVerticalData); // Lưu ý: hàm sort cũ tên là ByHeight nhưng logic là sort cạnh dài

        const areaData = this.sortRectanglesByArea(rawRects);
        const groupedData = this.sortRectanglesByExactDimension(rawRects);
        const widthSortData = this.sortRectanglesByWidth(rawRects);

        //  Sắp xếp ưu tiên Chiều Cao (Length) giảm dần -> Quan trọng cho hình mẫu của bạn
        const heightSortData = rawRects.slice().sort((a, b) => b.length - a.length);

        //  Sắp xếp "Thông minh": Cao trước, nếu bằng nhau thì Rộng trước
        const smartSortData = rawRects.slice().sort((a, b) => {
            if (Math.abs(b.length - a.length) > 1) return b.length - a.length; // Ưu tiên chiều cao
            return b.width - a.width; // Sau đó đến chiều rộng
        });

        const strategies = [
            // --- NHÓM CŨ (GIỮ NGUYÊN ĐỂ ĐẢM BẢO HIỆU SUẤT CÁC TẤM GIỮA) ---
            { name: 'Shelf_Smart_Horizontal', fn: () => this._shelfNextFitSmart(sortedByHeight.map(r => ({ ...r })), false) },
            { name: 'Grouped_BSSF', fn: () => this._maxRectsBSSF(groupedData.map(r => ({ ...r })), true) },
            { name: 'Area_BSSF', fn: () => this._maxRectsBSSF(areaData.map(r => ({ ...r })), false) },
            { name: 'Area_BAF', fn: () => this._maxRectsBAF(areaData.map(r => ({ ...r })), false) },

            // --- NHÓM MỚI: TỐI ƯU TẤM CUỐI (PACK LEFT) ---

            // 1. Dồn trái theo Chiều Rộng (Code cũ - Giữ lại)
            {
                name: 'Pack_Left_ByWidth',
                fn: () => this._maxRectsPackLeft(widthSortData.map(r => ({ ...r })), false)
            },

            // 2. Dồn trái theo Chiều Cao 
            {
                name: 'Pack_Left_ByHeight',
                fn: () => this._maxRectsPackLeft(heightSortData.map(r => ({ ...r })), false)
            },

            // 3. Dồn trái Smart (Cao -> Rộng)
            // Tạo ra các cột chặt chẽ nhất
            {
                name: 'Pack_Left_Smart',
                fn: () => this._maxRectsPackLeft(smartSortData.map(r => ({ ...r })), false)
            },

            // 4. Dồn trái theo Diện tích (Phòng hờ)
            {
                name: 'Pack_Left_ByArea',
                fn: () => this._maxRectsPackLeft(areaData.map(r => ({ ...r })), false)
            }
        ];

        let bestResult = null;

        for (const strategy of strategies) {
            const { placed, remaining } = strategy.fn();

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

            // Chỉ số Max X (Càng nhỏ càng tốt -> Dồn trái càng mạnh)
            const rightMostEdge = maxX;

            const currentResult = {
                placed: placed.map(r => ({ ...r, layer: 0 })),
                remaining: remaining.map(r => ({ ...r })),
                count, usedArea, alignmentScore, compactness, rightMostEdge,
                strategyName: strategy.name
            };

            // [EARLY EXIT] Nếu kết quả quá tốt, dừng ngay lập tức
            // Điều kiện: Hết sạch vật tư VÀ Hiệu suất > 96% (Rất cao)
            if (remaining.length === 0 && efficiency > 0.96) {
                return currentResult;
            }

            if (!bestResult) {
                bestResult = currentResult;
                continue;
            }

            // --- LOGIC CHỌN NGƯỜI CHIẾN THẮNG ---

            // 1. Số lượng là VUA (Để tránh bị tách ra 2 tấm lẻ)
            if (currentResult.count > bestResult.count) {
                bestResult = currentResult;
            }
            else if (currentResult.count === bestResult.count) {
                // 2. Nếu số lượng bằng nhau -> Chọn cái nào dồn về trái (rightMostEdge nhỏ nhất)
                // Ngưỡng 30mm: Nếu chênh lệch đáng kể thì chọn ngay cái dồn trái tốt hơn
                if (currentResult.rightMostEdge < bestResult.rightMostEdge - 30) {
                    bestResult = currentResult;
                }
                // Nếu phương án mới bị bè ra to hơn -> Bỏ qua
                else if (currentResult.rightMostEdge > bestResult.rightMostEdge + 30) {
                    continue;
                }
                // Nếu độ dồn trái ngang nhau -> Chọn cái nào đẹp hơn (Alignment)
                else {
                    if (currentResult.alignmentScore > bestResult.alignmentScore) {
                        bestResult = currentResult;
                    }
                    else if (currentResult.alignmentScore === bestResult.alignmentScore) {
                        // Cuối cùng mới xét đến độ đặc
                        if (currentResult.compactness > bestResult.compactness) {
                            bestResult = currentResult;
                        }
                    }
                }
            }
        }

        return bestResult;
    }

    executeFinalSheet(rectanglesToPack) {
        // [OPTIMIZATION] Dynamic Iterations & Time Limit
        // Giảm số lần thử từ 1000 xuống thấp hơn tùy theo số lượng items
        // Nếu ít items (< 20) -> Chạy nhiều (500) để tìm tối ưu
        // Nếu nhiều items -> Chạy ít (100) để tránh lag

        const itemCount = rectanglesToPack.length;
        let ITERATIONS = 200;
        if (itemCount < 20) ITERATIONS = 500;
        if (itemCount > 100) ITERATIONS = 50; // Quá nhiều items thì giảm mạnh

        const MAX_TIME_MS = 1000; // Tối đa 1 giây cho việc optimize tấm cuối
        const startTime = Date.now();

        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // Các chiến thuật khởi đầu (Heuristic)
        const initialCandidates = [
            rawRects.slice().sort((a, b) => b.length - a.length), // Cao trước (Thác nước)
            this.sortRectanglesByWidth(rawRects),                 // Rộng trước (Cột)
            this.sortRectanglesByArea(rawRects),                  // Lớn trước
            // Smart Sort: Cao trước, nếu bằng thì Rộng
            rawRects.slice().sort((a, b) => {
                if (Math.abs(b.length - a.length) > 1) return b.length - a.length;
                return b.width - a.width;
            })
        ];

        let bestResult = null;

        // Hàm đánh giá: TUYỆT ĐỐI KHÔNG TÍNH ĐIỂM ĐẸP (AlignmentScore)
        const evaluateAndSave = (placed, remaining, strategyName) => {
            // Tấm cuối phải xếp hết
            if (remaining.length > 0 && bestResult && bestResult.remaining.length === 0) return;

            let maxX = 0;
            let maxY = 0;
            placed.forEach(r => {
                maxX = Math.max(maxX, r.x + r.width);
                maxY = Math.max(maxY, r.y + r.length);
            });

            const current = { placed, remaining, count: placed.length, maxX, maxY, strategyName };

            if (!bestResult) {
                bestResult = current;
                return;
            }

            // TIÊU CHÍ 1: Số lượng (Phải xếp hết)
            if (current.count > bestResult.count) {
                bestResult = current;
            }
            else if (current.count === bestResult.count) {
                // TIÊU CHÍ 2: Dồn trái cực đoan (MaxX nhỏ nhất)
                // Chỉ cần nhỏ hơn 1 chút xíu cũng chọn
                if (current.maxX < bestResult.maxX - 0.5) {
                    bestResult = current;
                }
                // TIÊU CHÍ 3: Nếu MaxX bằng nhau, chọn dồn đáy (MaxY nhỏ nhất)
                else if (Math.abs(current.maxX - bestResult.maxX) <= 0.5 && current.maxY < bestResult.maxY) {
                    bestResult = current;
                }
                // KHÔNG CÓ TIÊU CHÍ ALIGNMENT SCORE Ở ĐÂY
            }
        };

        // BƯỚC 1: Chạy Heuristic
        for (let i = 0; i < initialCandidates.length; i++) {
            const sortedRects = initialCandidates[i];
            const res = this._maxRectsPackLeft(sortedRects.map(r => ({ ...r })), false);
            evaluateAndSave(res.placed, res.remaining, `Final_Heuristic_${i}`);

            // [EARLY EXIT] Nếu Heuristic đã xếp hết và rất gọn (MaxX < 1/2 container) -> Dừng
            if (bestResult && bestResult.remaining.length === 0 && bestResult.maxX < this.container.width * 0.5) {
                return bestResult;
            }
        }

        // BƯỚC 2: DEEP SEARCH (SHUFFLE) - QUAN TRỌNG NHẤT
        for (let i = 0; i < ITERATIONS; i++) {
            // [TIME LIMIT CHECK]
            if (Date.now() - startTime > MAX_TIME_MS) break;

            const shuffled = this.shuffleArray(rawRects.map(r => ({ ...r })));
            const res = this._maxRectsPackLeft(shuffled, false);

            // Chỉ lưu nếu xếp hết 100% (hoặc tốt hơn kết quả hiện tại)
            if (res.remaining.length === 0 || (bestResult && res.placed.length >= bestResult.count)) {
                evaluateAndSave(res.placed, res.remaining, `Final_DeepSearch_${i}`);
            }

            // [EARLY EXIT] Nếu tìm thấy phương án rất tốt trong lúc random
            if (bestResult && bestResult.remaining.length === 0 && bestResult.maxX < this.container.width * 0.4) {
                break;
            }
        }

        return bestResult;
    }
    run2DPacking(rectanglesToPack) {
        return this.execute(rectanglesToPack);
    }
}

export default HybridStrategy;