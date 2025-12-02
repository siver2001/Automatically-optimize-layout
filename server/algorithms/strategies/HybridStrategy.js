// server/algorithms/strategies/HybridStrategy.js
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

        const areaData = this.sortRectanglesByArea(rawRects);
        const groupedData = this.sortRectanglesByExactDimension(rawRects);
        const widthSortData = this.sortRectanglesByWidth(rawRects);

        //  Sắp xếp ưu tiên Chiều Cao (Length) giảm dần -> Quan trọng cho hình mẫu của bạn
        //  [FIX] Sử dụng sortRectanglesByHeight để đảm bảo ổn định (cùng chiều cao thì xét chiều rộng)
        const heightSortData = this.sortRectanglesByHeight(rawRects);

        //  Sắp xếp "Thông minh": Cao trước, nếu bằng nhau thì Rộng trước
        const smartSortData = rawRects.slice().sort((a, b) => {
            if (Math.abs(b.length - a.length) > 1) return b.length - a.length; // Ưu tiên chiều cao
            return b.width - a.width; // Sau đó đến chiều rộng
        });

        const strategies = [

            { name: 'Shelf_Smart_Horizontal', fn: () => this._shelfNextFitSmart(sortedByHeight.map(r => ({ ...r })), false) },
            { name: 'Grouped_BSSF', fn: () => this._maxRectsBSSF(groupedData.map(r => ({ ...r })), true) },
            { name: 'Area_BSSF', fn: () => this._maxRectsBSSF(areaData.map(r => ({ ...r })), false) },
            { name: 'Area_BAF', fn: () => this._maxRectsBAF(areaData.map(r => ({ ...r })), false) },

            // --- NHÓM MỚI: TỐI ƯU TẤM CUỐI (PACK LEFT) ---

            // 1. Dồn trái theo Chiều Rộng
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

            // Chỉ số Max X (Càng nhỏ càng tốt -> Dồn trái càng mạnh)
            const rightMostEdge = maxX;

            const currentResult = {
                placed: placed.map(r => ({ ...r, layer: 0 })),
                remaining: remaining.map(r => ({ ...r })),
                count, usedArea, alignmentScore, compactness, rightMostEdge,
                strategyName: strategy.name
            };

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
        // [NEW] Chiến thuật "Virtual Merging" (Gom ảo)
        // Thử gom các tấm lẻ thành tấm chẵn, xếp thử, nếu OK thì dùng luôn
        const virtualMergeResult = this._tryVirtualMergeStrategy(rectanglesToPack);
        if (virtualMergeResult && virtualMergeResult.remaining.length === 0) {
            return virtualMergeResult;
        }

        const ITERATIONS = 500;
        const rawRects = rectanglesToPack.map(r => ({ ...r }));

        // --- 1. CHIẾN THUẬT "KỶ LUẬT" (Uniformity First) ---
        // Mục tiêu: Cố gắng xếp mà KHÔNG XOAY lung tung. Nếu xếp được hết thì đây là phương án đẹp nhất.

        // Tạo danh sách đã xoay sẵn toàn bộ sang Ngang và SẮP XẾP ỔN ĐỊNH
        const allHorizontal = this.sortRectanglesByHeight(this.preAlignRectangles(rawRects, 'horizontal').map(r => ({ ...r, noRotate: true })));

        // Tạo danh sách đã xoay sẵn toàn bộ sang Dọc và SẮP XẾP ỔN ĐỊNH
        const allVertical = this.sortRectanglesByHeight(this.preAlignRectangles(rawRects, 'vertical').map(r => ({ ...r, noRotate: true })));

        // --- 2. CHIẾN THUẬT "LINH HOẠT" (Efficiency Backup) ---
        // Chỉ dùng khi chiến thuật kỷ luật bị thất bại (không xếp hết)
        const flexibleCandidates = [
            this.sortRectanglesByArea(rawRects),              // Lớn xếp trước
            this.sortRectanglesByHeight(rawRects),            // [FIX] Cao xếp trước (Ổn định)
            this.sortRectanglesByWidth(rawRects)              // Rộng xếp trước
        ];

        let bestResult = null;

        // Hàm đánh giá: Ưu tiên sự đồng bộ (Uniformity)
        const evaluateAndSave = (placed, remaining, strategyName, isStrict = false) => {
            // Nếu là chế độ Strict (Kỷ luật) mà còn thừa ván -> Thất bại, bỏ qua ngay
            if (isStrict && remaining.length > 0) return;

            // Nếu chế độ thường mà còn thừa ván, trong khi đã có kết quả tốt hơn -> Bỏ qua
            if (remaining.length > 0 && bestResult && bestResult.remaining.length === 0) return;

            let maxX = 0;
            let maxY = 0;
            // Tính điểm đồng bộ hướng (Uniformity Score)
            let rotationChanges = 0;

            placed.forEach((r, index) => {
                maxX = Math.max(maxX, r.x + r.width);
                maxY = Math.max(maxY, r.y + r.length);
                // Kiểm tra xem tấm này có bị xoay khác hướng so với tấm trước đó không
                if (index > 0 && r.rotated !== placed[index - 1].rotated) {
                    rotationChanges++;
                }
            });

            const currentAlignment = this._calculateAlignmentScore(placed);

            const current = {
                placed, remaining,
                count: placed.length,
                maxX, maxY,
                alignment: currentAlignment,
                rotationChanges, // Chỉ số mới: càng thấp càng tốt (ít đổi chiều)
                strategyName
            };

            if (!bestResult) {
                bestResult = current;
                return;
            }

            // --- LOGIC SO SÁNH MỚI ---

            // 1. Số lượng là VUA
            if (current.count > bestResult.count) {
                bestResult = current;
            }
            else if (current.count === bestResult.count) {
                // 2. [MỚI] Ưu tiên độ đồng bộ hướng (Rotation Consistency)
                // Nếu phương án mới ít bị xoay lung tung hơn hẳn -> Chọn ngay
                if (current.rotationChanges < bestResult.rotationChanges - 2) {
                    bestResult = current;
                }
                else if (current.rotationChanges > bestResult.rotationChanges + 2) {
                    // Nếu phương án mới xoay lung tung quá -> Bỏ qua
                    return;
                }
                else {
                    // 3. Nếu độ lung tung ngang nhau -> Xét hiệu suất (MaxX)
                    if (current.maxX < bestResult.maxX - 20) {
                        bestResult = current;
                    }
                    else if (current.maxX <= bestResult.maxX + 20) {
                        // 4. Cuối cùng mới xét độ đẹp (khớp cạnh)
                        if (current.alignment > bestResult.alignment) {
                            bestResult = current;
                        } else if (current.maxX < bestResult.maxX) {
                            bestResult = current;
                        }
                    }
                }
            }
        };

        // BƯỚC 1: Thử chế độ "Kỷ luật" trước (Horizontal & Vertical Only)
        // Lưu ý: PackLeft sẽ chạy với dữ liệu noRotate: true
        const resH = this._maxRectsPackLeft(allHorizontal, false); // false = score thường
        evaluateAndSave(resH.placed, resH.remaining, 'Strict_Horizontal', true);

        const resV = this._maxRectsPackLeft(allVertical, false);
        evaluateAndSave(resV.placed, resV.remaining, 'Strict_Vertical', true);

        // Nếu chế độ kỷ luật đã xếp xong hết 100% -> Trả về luôn, không cần thử cái khác nữa!
        // Điều này đảm bảo kết quả sẽ rất đồng bộ.
        if (bestResult && bestResult.remaining.length === 0) {
            return bestResult;
        }

        // BƯỚC 2: Nếu kỷ luật thất bại (còn thừa ván), chạy chế độ Linh hoạt (Heuristic)
        flexibleCandidates.forEach((sortedRects, index) => {
            // 1. Thử Pack Left (Dồn trái - Tốt cho việc tiết kiệm ván)
            const resLeft = this._maxRectsPackLeft(sortedRects.map(r => ({ ...r })), false);
            evaluateAndSave(resLeft.placed, resLeft.remaining, `Flex_PackLeft_${index}`);

            // 2. [MỚI] Thử BSSF (Khớp cạnh - Tốt cho việc gom nhóm)
            const resBSSF = this._maxRectsBSSF(sortedRects.map(r => ({ ...r })), true); // true = forceGridPreference
            evaluateAndSave(resBSSF.placed, resBSSF.remaining, `Flex_BSSF_${index}`);
        });

        // BƯỚC 3: Deep Search (Random) để cứu vãn tình thế
        for (let i = 0; i < ITERATIONS; i++) {
            const shuffled = this.shuffleArray(rawRects.map(r => ({ ...r })));
            const res = this._maxRectsPackLeft(shuffled, false);

            if (res.remaining.length === 0 || (bestResult && res.placed.length >= bestResult.count)) {
                evaluateAndSave(res.placed, res.remaining, `Flex_DeepSearch_${i}`);
            }
        }

        return bestResult;
    }

    // [NEW] Chiến thuật Gom ảo (Virtual Merging)
    _tryVirtualMergeStrategy(rectangles) {
        const rawRects = rectangles.map(r => ({ ...r }));

        // 1. Tìm các kích thước đích (Target Sizes)
        const targetSizes = new Set();
        rawRects.forEach(r => {
            targetSizes.add(`${r.width}x${r.length}`);
            targetSizes.add(`${r.length}x${r.width}`);
        });

        // 2. Gom nhóm các tấm lẻ
        const mergedRects = [];
        const usedIndices = new Set();

        for (let i = 0; i < rawRects.length; i++) {
            if (usedIndices.has(i)) continue;

            let merged = false;
            for (let j = i + 1; j < rawRects.length; j++) {
                if (usedIndices.has(j)) continue;

                const r1 = rawRects[i];
                const r2 = rawRects[j];

                // Chỉ ghép nếu cùng kích thước
                if (Math.abs(r1.width - r2.width) > 0.1 || Math.abs(r1.length - r2.length) > 0.1) continue;

                // Thử ghép chiều rộng: (W+W) x H
                const combinedW = r1.width + r2.width;
                const combinedH = r1.length;
                if (targetSizes.has(`${combinedW}x${combinedH}`) || targetSizes.has(`${combinedH}x${combinedW}`)) {
                    mergedRects.push({
                        ...r1,
                        width: combinedW,
                        length: combinedH,
                        isVirtual: true,
                        children: [r1, r2],
                        mergeType: 'width'
                    });
                    usedIndices.add(i);
                    usedIndices.add(j);
                    merged = true;
                    break;
                }

                // Thử ghép chiều cao: W x (H+H)
                const combinedW2 = r1.width;
                const combinedH2 = r1.length + r2.length;
                if (targetSizes.has(`${combinedW2}x${combinedH2}`) || targetSizes.has(`${combinedH2}x${combinedW2}`)) {
                    mergedRects.push({
                        ...r1,
                        width: combinedW2,
                        length: combinedH2,
                        isVirtual: true,
                        children: [r1, r2],
                        mergeType: 'height'
                    });
                    usedIndices.add(i);
                    usedIndices.add(j);
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                // Nếu không ghép được với ai, giữ nguyên
                if (!usedIndices.has(i)) {
                    mergedRects.push(rawRects[i]);
                    usedIndices.add(i);
                }
            }
        }


        // 3. Xếp thử danh sách đã gom (Ưu tiên PackLeft để tiết kiệm ván)
        // Sắp xếp lại để tối ưu
        const sortedMerged = this.sortRectanglesByHeight(mergedRects);
        const res = this._maxRectsPackLeft(sortedMerged, false);

        // 4. Nếu xếp thành công (hết ván), trả về kết quả (Giữ nguyên khối Gộp)
        if (res.remaining.length === 0) {
            const finalPlaced = [];
            res.placed.forEach(r => {
                if (r.isVirtual) {
                    // [MODIFIED] Thay vì bung ra, ta trả về luôn khối gộp
                    // Cập nhật ID và Name để người dùng biết
                    const [c1, c2] = r.children;

                    // Tạo ID gộp: "ID1_ID2"
                    const newId = `${c1.id}_${c2.id}`;

                    // Tạo Name gộp: "Name1 + Name2" (hoặc giữ nguyên nếu giống nhau)
                    const newName = (c1.name === c2.name) ? `${c1.name} (x2)` : `${c1.name} + ${c2.name}`;

                    // Trả về khối gộp này như 1 tấm ván duy nhất
                    finalPlaced.push({
                        ...r,
                        id: newId,
                        name: newName,
                        // Xóa các thuộc tính ảo để nó trở thành tấm thật
                        isVirtual: false,
                        children: undefined,
                        mergeType: undefined
                    });
                } else {
                    finalPlaced.push(r);
                }
            });

            return {
                placed: finalPlaced,
                remaining: [],
                strategyName: 'Virtual_Merge_PackLeft'
            };
        }

        return null; // Thất bại, trả về null để chạy fallback
    }

    run2DPacking(rectanglesToPack) {
        return this.execute(rectanglesToPack);
    }
}

export default HybridStrategy;