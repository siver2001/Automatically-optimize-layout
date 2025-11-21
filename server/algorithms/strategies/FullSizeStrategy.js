// server/algorithms/strategies/FullSizeStrategy.js
import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  execute(rectanglesToPack) {
    // Tạo bản sao dữ liệu gốc
    const rawRects = rectanglesToPack.map(r => ({...r}));

    // 1. Chuẩn bị các bộ dữ liệu cơ bản
    const rectsHorizontal = this.preAlignRectangles(rawRects, 'horizontal');
    const rectsVertical = this.preAlignRectangles(rawRects, 'vertical');
    const rectsArea = this.sortRectanglesByArea(rawRects); 

    // 2. ĐỊNH NGHĨA CÁC CHIẾN THUẬT
    const strategies = [
      // === NHÓM 1: SHELF SMART (Thẩm mỹ, tạo hàng cột) ===
      { 
        name: 'Shelf_Horizontal_Height', 
        fn: () => this._shelfNextFitSmart(this.sortRectanglesByHeight(rectsHorizontal), false) 
      },
      { 
        name: 'Shelf_Horizontal_Width', 
        fn: () => this._shelfNextFitSmart(this.sortRectanglesByWidth(rectsHorizontal), false) 
      },
      { 
        name: 'Shelf_Vertical_Height', 
        fn: () => this._shelfNextFitSmart(this.sortRectanglesByHeight(rectsVertical), false) 
      },
      { 
        name: 'Shelf_Vertical_Width', 
        fn: () => this._shelfNextFitSmart(this.sortRectanglesByWidth(rectsVertical), false) 
      },
      
      // === NHÓM 2: MAX RECTS (Hiệu suất, điền chỗ trống) ===
      { 
          name: 'MaxRects_BSSF_Area', // Best Short Side Fit
          fn: () => this._maxRectsBSSF(rectsArea.map(r => ({...r})), false) 
      },
      { 
          name: 'MaxRects_BL_Area', // Bottom Left
          fn: () => this._maxRectsBL(rectsArea.map(r => ({...r})), false) 
      },

      // ===  NHÓM 3: MONTE CARLO (Thử nghiệm ngẫu nhiên) ===
      {
        name: 'MonteCarlo_Random_BSSF',
        fn: () => {
            let bestRandomRun = null;
            // Số lần thử ngẫu nhiên (Tăng lên nếu máy mạnh, giảm nếu muốn nhanh)
            const TRIALS = 1000; 

            for (let i = 0; i < TRIALS; i++) {
                // Xáo trộn ngẫu nhiên thứ tự
                const shuffled = this.shuffleArray([...rectsArea.map(r => ({...r}))]);
                
                // Chạy thuật toán MaxRects BSSF (Thường là tốt nhất cho random)
                const result = this._maxRectsBSSF(shuffled, false);
                
                // Đánh giá nhanh
                const placedCount = result.placed.length;
                // Nếu xếp được nhiều hơn hoặc bằng nhưng diện tích tốt hơn
                if (!bestRandomRun || placedCount > bestRandomRun.placed.length) {
                    bestRandomRun = result;
                }
            }
            return bestRandomRun;
        }
      }
    ];

    let bestResult = null;

    // 3. CHẠY ĐUA (RACE)
    for (const strat of strategies) {
      const result = strat.fn();
      
      if (!result) continue;

      // Tính toán các chỉ số
      const count = result.placed.length;
      const usedArea = result.placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
      const alignmentScore = this._calculateAlignmentScore(result.placed);
      
      // Tính Compactness (Độ đặc khít)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      if (result.placed.length > 0) {
        result.placed.forEach(r => {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.width);
            maxY = Math.max(maxY, r.y + r.length);
        });
      } else {
        minX = 0; minY = 0; maxX = 0; maxY = 0;
      }
      
      const boundingArea = (maxX - minX) * (maxY - minY);
      const compactness = boundingArea > 0 ? (usedArea / boundingArea) : 0;

      const currentResult = {
          placed: result.placed.map(r => ({...r, layer: 0})),
          remaining: result.remaining.map(r => ({...r})),
          count,
          usedArea,
          alignmentScore,
          compactness,
          strategyName: strat.name
      };

      // 4. SO SÁNH VÀ CHỌN LỌC
      if (!bestResult) {
          bestResult = currentResult;
          continue;
      }

      // Tiêu chí 1: Số lượng là vua
      if (currentResult.count > bestResult.count) {
          bestResult = currentResult;
      } 
      // Tiêu chí 2: Nếu số lượng bằng nhau
      else if (currentResult.count === bestResult.count) {
          // Ưu tiên độ đặc khít (Compactness) cao hơn
          if (currentResult.compactness > bestResult.compactness + 0.05) { 
             bestResult = currentResult;
          }
          // Nếu độ đặc khít tương đương, chọn cái nào thẳng hàng hơn (Dễ cắt)
          else if (Math.abs(currentResult.compactness - bestResult.compactness) <= 0.05) {
             if (currentResult.alignmentScore > bestResult.alignmentScore) {
                bestResult = currentResult;
             }
          }
      }
    }

    // Gắn tên chiến thuật
    if (bestResult) {
        bestResult.strategyName = `FullSize_${bestResult.strategyName}`;
    }
    
    return bestResult;
  }
}

export default FullSizeStrategy;