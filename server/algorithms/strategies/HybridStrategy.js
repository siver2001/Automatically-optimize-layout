// server/algorithms/strategies/HybridStrategy.js
import BaseStrategy from './BaseStrategy.js';

class HybridStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  execute(rectanglesToPack) {
    // [OPTIMIZATION 1] Windowing: Giới hạn số lượng hình tính toán
    let workingSet = rectanglesToPack;
    const THRESHOLD = 600; // Cho phép nhiều hơn FullSize một chút vì thuật toán này nhẹ hơn

    if (rectanglesToPack.length > THRESHOLD) {
        // Sort theo diện tích
        const sortedByArea = [...rectanglesToPack].sort((a, b) => (b.width * b.length) - (a.width * a.length));
        
        // Lấy 400 hình to nhất + 200 hình nhỏ nhất
        const bigOnes = sortedByArea.slice(0, 400);
        const smallOnes = sortedByArea.slice(Math.max(400, sortedByArea.length - 200));
        
        workingSet = [...bigOnes, ...smallOnes];
    }

    const rawRects = workingSet.map(r => ({...r}));

    // 1. Chuẩn bị dữ liệu
    const stripHorizontalData = this.preAlignRectangles(rawRects, 'horizontal');
    const sortedByHeight = this.sortRectanglesByHeight(stripHorizontalData);

    const stripVerticalData = this.preAlignRectangles(rawRects, 'vertical');
    const sortedByWidth = this.sortRectanglesByHeight(stripVerticalData);

    const areaData = this.sortRectanglesByArea(rawRects);

    // Chiến thuật cho Hybrid (ít hơn FullSize nhưng cần hiệu quả)
    const strategies = [
      // ✅ SMART SHELF: Rất nhanh và hiệu quả cho hình chữ nhật
      {
        name: 'Shelf_Smart_Horizontal',
        fn: () => this._shelfNextFitSmart(sortedByHeight.map(r => ({...r})), false) 
      },
      // ✅ Strip Packing: Tốt cho các băng dài
      { 
          name: 'Strip_Horizontal_BL', 
          fn: () => this._maxRectsBL(sortedByHeight.map(r => ({...r})), true) 
      },
      { 
          name: 'Strip_Vertical_BL', 
          fn: () => this._maxRectsBL(sortedByWidth.map(r => ({...r})), true)
      },
      // ✅ MaxRects (Area & BSSF): Vét cạn kinh điển
      { 
          name: 'Area_BSSF', 
          fn: () => this._maxRectsBSSF(areaData.map(r => ({...r})), false) 
      },
      { 
          name: 'Area_BAF', 
          fn: () => this._maxRectsBAF(areaData.map(r => ({...r})), false) 
      }
    ];

    let bestResult = null;

    for (const strategy of strategies) {
        const { placed, remaining } = strategy.fn(); 
        
        // Nếu chiến thuật này thất bại (không xếp được gì), bỏ qua
        if (placed.length === 0) continue;

        const count = placed.length;
        const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        const alignmentScore = this._calculateAlignmentScore(placed); 
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        placed.forEach(r => {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.width);
            maxY = Math.max(maxY, r.y + r.length);
        });
        const boundingArea = (placed.length > 0) ? (maxX - minX) * (maxY - minY) : 0;
        const compactness = (boundingArea > 0) ? (usedArea / boundingArea) : 0; 

        // [OPTIMIZATION 2] EARLY EXIT: Thoát sớm nếu kết quả quá tốt
        // Với Hybrid, ta yêu cầu độ nén cao hơn một chút (95%)
        if (compactness > 0.95 && placed.length > 0) {
            const placedIds = new Set(placed.map(r => r.id));
            // Tính lại remaining từ danh sách gốc
            const realRemaining = rectanglesToPack.filter(r => !placedIds.has(r.id));
            
            return { 
                placed: placed.map(r => ({...r, layer: 0})), 
                remaining: realRemaining,
                count, usedArea, alignmentScore, compactness,
                strategyName: strategy.name + '_EarlyExit'
            };
        }

        const currentResult = { 
            placed: placed.map(r => ({...r, layer: 0})), 
            remaining: remaining.map(r => ({...r})), // Lưu ý: remaining này chỉ đúng với workingSet
            count, usedArea, alignmentScore, compactness,
            strategyName: strategy.name
        };

        if (!bestResult) {
            bestResult = currentResult;
            continue;
        }

        // Logic so sánh (giữ nguyên)
        if (currentResult.count > bestResult.count) {
            bestResult = currentResult;
        } 
        else if (currentResult.count === bestResult.count) {
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

    // [QUAN TRỌNG] Chuẩn hóa lại remaining cuối cùng
    if (bestResult) {
        const finalPlacedIds = new Set(bestResult.placed.map(r => r.id));
        bestResult.remaining = rectanglesToPack.filter(r => !finalPlacedIds.has(r.id));
    }

    return bestResult; 
  }

  // Giữ lại hàm này để tương thích ngược
  run2DPacking(rectanglesToPack) {
    return this.execute(rectanglesToPack);
  }
}

export default HybridStrategy;