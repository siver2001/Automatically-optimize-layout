// server/algorithms/strategies/FullSizeStrategy.js
import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  execute(rectanglesToPack) {
    const rawRects = rectanglesToPack.map(r => ({...r}));

    // 1. Chuẩn bị các bộ dữ liệu cơ bản
    // Bộ dữ liệu đã xoay ngang/dọc sẵn để ưu tiên sắp hàng/cột
    const rectsHorizontal = this.preAlignRectangles(rawRects, 'horizontal');
    const rectsVertical = this.preAlignRectangles(rawRects, 'vertical');
    const rectsArea = this.sortRectanglesByArea(rawRects); 
    
    // Tạo thêm bộ dữ liệu sắp theo chiều cao và chiều rộng
    // Điều này giúp thuật toán MaxRects nhìn thấy các "cột" tiềm năng
    const rectsByHeight = this.sortRectanglesByHeight(rawRects);
    const rectsByWidth = this.sortRectanglesByWidth(rawRects);

    // Cluster: Gom các tấm giống hệt nhau lại
    const rectsClustered = rawRects.slice().sort((a, b) => {
        const maxA = Math.max(a.width, a.length);
        const maxB = Math.max(b.width, b.length);
        if (Math.abs(maxA - maxB) > 0.1) return maxB - maxA;
        const minA = Math.min(a.width, a.length);
        const minB = Math.min(b.width, b.length);
        return minB - minA;
    });

    // 2. ĐỊNH NGHĨA CÁC CHIẾN THUẬT
    const strategies = [
      // === NHÓM 1: SHELF (Thẩm mỹ) ===
      { name: 'Shelf_Cluster_Smart', fn: () => this._shelfNextFitSmart(rectsClustered, false) },
      { name: 'Shelf_Horizontal_Height', fn: () => this._shelfNextFitSmart(this.sortRectanglesByHeight(rectsHorizontal), false) },
      { name: 'Shelf_Vertical_Width', fn: () => this._shelfNextFitSmart(this.sortRectanglesByWidth(rectsVertical), false) },
      
      // === NHÓM 2: MAX RECTS - BIẾN THỂ THEO DIMENSION (QUAN TRỌNG) ===
      // Đây là chìa khóa để máy xếp giống người: thử xếp theo cột (Height) và hàng (Width)
      // thay vì chỉ xếp theo diện tích.
      { name: 'MaxRects_BSSF_Height', fn: () => this._maxRectsBSSF(rectsByHeight.map(r => ({...r})), false) },
      { name: 'MaxRects_BSSF_Width', fn: () => this._maxRectsBSSF(rectsByWidth.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Height', fn: () => this._maxRectsBL(rectsByHeight.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Width', fn: () => this._maxRectsBL(rectsByWidth.map(r => ({...r})), false) },

      // === NHÓM 3: MAX RECTS - CLUSTER & AREA (Cổ điển & Gom nhóm) ===
      { name: 'MaxRects_BSSF_Cluster', fn: () => this._maxRectsBSSF(rectsClustered.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Cluster', fn: () => this._maxRectsBL(rectsClustered.map(r => ({...r})), false) },
      { name: 'MaxRects_BSSF_Area', fn: () => this._maxRectsBSSF(rectsArea.map(r => ({...r})), false) },
      
      // === NHÓM 4: VÉT CẠN (Bottom Left Fill - Đã nâng cấp Rotation) ===
      // Chiến thuật "ngây thơ" này đôi khi lại thắng vì nó thử nhét vào mọi ngóc ngách
      { name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsArea.map(r => ({...r}))) },

      // === NHÓM 5: MONTE CARLO (Thử vận may) ===
      {
        name: 'MonteCarlo_Random_BSSF',
        fn: () => {
            let bestRandomRun = null;
            const TRIALS = 2000; // Tăng số lần thử lên gấp đôi
            for (let i = 0; i < TRIALS; i++) {
                const shuffled = this.shuffleArray([...rectsArea.map(r => ({...r}))]);
                const result = this._maxRectsBSSF(shuffled, false);
                
                // Logic chọn nhanh trong Monte Carlo
                if (!bestRandomRun) bestRandomRun = result;
                else {
                    if (result.placed.length > bestRandomRun.placed.length) bestRandomRun = result;
                    else if (result.placed.length === bestRandomRun.placed.length) {
                         // Ưu tiên độ đặc khít trong các lần thử random
                         const used1 = result.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                         const used2 = bestRandomRun.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                         if (used1 > used2) bestRandomRun = result;
                    }
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

      // Tính toán chỉ số
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
          placed: result.placed.map(r => ({...r, layer: 0})),
          remaining: result.remaining.map(r => ({...r})),
          count, usedArea, alignmentScore, compactness,
          strategyName: strat.name
      };

      // 4. SO SÁNH VÀ CHỌN LỌC
      if (!bestResult) {
          bestResult = currentResult;
          continue;
      }

      // Tiêu chí 1: Số lượng là VUA (để bắt được 3 tấm còn thiếu)
      if (currentResult.count > bestResult.count) {
          bestResult = currentResult;
      } 
      // Tiêu chí 2: Nếu số lượng bằng nhau
      else if (currentResult.count === bestResult.count) {
          // Ưu tiên độ đẹp (Size nguyên)
          if (currentResult.alignmentScore > bestResult.alignmentScore + 50) {
               bestResult = currentResult;
          }
          else if (Math.abs(currentResult.alignmentScore - bestResult.alignmentScore) <= 50) {
               if (currentResult.compactness > bestResult.compactness) {
                   bestResult = currentResult;
               }
          }
      }
    }

    if (bestResult) {
        bestResult.strategyName = `FullSize_${bestResult.strategyName}`;
    }
    
    return bestResult;
  }
}

export default FullSizeStrategy;