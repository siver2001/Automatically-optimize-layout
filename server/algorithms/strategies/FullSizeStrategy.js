// server/algorithms/strategies/FullSizeStrategy.js
import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  // === CHIẾN THUẬT 1: GHÉP BÙ TRỪ (Perfect Width) ===
  // Tìm các cặp có tổng chiều rộng xấp xỉ chiều rộng container
  _bundlePerfectWidth(rects) {
      const containerW = this.container.width;
      const bundled = [];
      const usedIndices = new Set();
      // Sort theo chiều rộng giảm dần
      const sorted = [...rects].sort((a, b) => b.width - a.width);

      for (let i = 0; i < sorted.length; i++) {
          if (usedIndices.has(i)) continue;
          
          const targetW = containerW - sorted[i].width;
          let bestMatchIdx = -1;
          let minDiff = Infinity;

          for (let j = i + 1; j < sorted.length; j++) {
              if (usedIndices.has(j)) continue;
              
              // Kiểm tra chiều dài phải xấp xỉ nhau (chênh lệch < 50mm)
              if (Math.abs(sorted[i].length - sorted[j].length) > 50) continue;

              const diff = Math.abs(sorted[j].width - targetW);
              // Sai số cho phép 5mm
              if (diff < minDiff && diff < 5) { 
                  minDiff = diff;
                  bestMatchIdx = j;
                  if (diff === 0) break; 
              }
          }

          if (bestMatchIdx !== -1) {
               const p1 = sorted[i];
               const p2 = sorted[bestMatchIdx];
               const newWidth = p1.width + p2.width;
               const newLength = Math.max(p1.length, p2.length); 
               
               bundled.push({
                   ...p1,
                   id: `perfect_row_${p1.id}_${p2.id}`,
                   width: newWidth,
                   length: newLength,
                   isBundle: true,
                   originals: [p1, p2],
                   bundleType: 'perfect_width'
               });
               usedIndices.add(i);
               usedIndices.add(bestMatchIdx);
          } else {
               bundled.push(sorted[i]);
               usedIndices.add(i);
          }
      }
      return bundled;
  }

  // === CHIẾN THUẬT 2: GHÉP CẶP GIỐNG NHAU ===
  _bundleIdenticalRects(rects) {
    if (rects.length < 500) return { bundled: rects, isBundled: false };

    const bundled = [];
    const usedIndices = new Set();
    const sorted = [...rects].sort((a, b) => {
        if (a.width !== b.width) return b.width - a.width;
        return b.length - a.length;
    });

    let pairCount = 0;

    for (let i = 0; i < sorted.length; i++) {
        if (usedIndices.has(i)) continue;
        
        let pairFound = false;
        for (let j = i + 1; j < sorted.length; j++) {
           if (usedIndices.has(j)) continue;
           
           if (Math.abs(sorted[i].width - sorted[j].width) > 0.1 || 
               Math.abs(sorted[i].length - sorted[j].length) > 0.1) {
               break; 
           }

           if (sorted[i].width * 2 <= this.container.width) {
               const p1 = sorted[i];
               const p2 = sorted[j];
               
               const bundledRect = {
                   ...p1,
                   id: `bundle_${p1.id}_${p2.id}`,
                   width: p1.width * 2,
                   length: p1.length,
                   isBundle: true,
                   originals: [p1, p2],
                   bundleType: 'horizontal'
               };
               
               bundled.push(bundledRect);
               usedIndices.add(i);
               usedIndices.add(j);
               pairFound = true;
               pairCount++;
               break;
           }
        }
        
        if (!pairFound) {
            bundled.push(sorted[i]);
            usedIndices.add(i);
        }
    }
    
    if (pairCount > sorted.length * 0.1) {
        return { bundled, isBundled: true };
    }
    return { bundled: rects, isBundled: false };
  }

  // === HÀM TÁCH CẶP (UNBUNDLE) ===
  _unbundleRects(placedRects) {
      const finalRects = [];
      for (const rect of placedRects) {
          if (rect.isBundle && rect.originals) {
              const [p1, p2] = rect.originals;
              const isRotated = rect.rotated; 
                 
              const p1Params = { ...p1, x: rect.x, y: rect.y, rotated: isRotated, layer: rect.layer };
              const p2Params = { ...p2, rotated: isRotated, layer: rect.layer };

              if (!isRotated) {
                  p2Params.x = rect.x + p1.width;
                  p2Params.y = rect.y;
              } else {
                  p2Params.x = rect.x;
                  p2Params.y = rect.y + p1.width;
              }
              
              finalRects.push(p1Params);
              finalRects.push(p2Params);
          } else {
              finalRects.push(rect);
          }
      }
      return finalRects;
  }

  // === HÀM TRỘN XEN KẼ TO - NHỎ ===
  _createInterleavedList(rects) {
      const sorted = [...rects].sort((a, b) => (b.width * b.length) - (a.width * a.length));
      const mid = Math.floor(sorted.length / 2);
      const bigs = sorted.slice(0, mid);
      const smalls = sorted.slice(mid).reverse(); 
      
      const interleaved = [];
      const maxLength = Math.max(bigs.length, smalls.length);
      
      for (let i = 0; i < maxLength; i++) {
          if (i < bigs.length) interleaved.push(bigs[i]);
          if (i < smalls.length) interleaved.push(smalls[i]);
      }
      return interleaved;
  }

  execute(rectanglesToPack) {
    // 1. AUTO-PAIRING (CHẠY 2 CHIẾN THUẬT GỘP)
    // Bước 1: Gộp bù trừ (Perfect Width) trước
    const rectsAfterPerfectWidth = this._bundlePerfectWidth(rectanglesToPack);

    // Bước 2: Gộp giống nhau (Identical) sau
    const { bundled: inputRects } = this._bundleIdenticalRects(rectsAfterPerfectWidth);
    
    const isBundled = inputRects.some(r => r.isBundle);

    // 2. WINDOWING (NÂNG CẤP: TỶ LỆ VÀNG THEO DIỆN TÍCH)
    let workingSet = inputRects;
    const MAX_ITEMS = 600; // Tăng nhẹ giới hạn để thuật toán "dễ thở" hơn

    if (inputRects.length > MAX_ITEMS) {
        // Sort diện tích giảm dần
        const sortedByArea = [...inputRects].sort((a, b) => (b.width * b.length) - (a.width * a.length));
        
        // 1. Lấy nhóm "Đá Tảng" (Big Rocks) - Khoảng 60% quota
        const bigCount = Math.floor(MAX_ITEMS * 0.6); // ~360 hình
        const bigOnes = sortedByArea.slice(0, bigCount);
        
        // Tính tổng diện tích nhóm to
        const bigArea = bigOnes.reduce((sum, r) => sum + (r.width * r.length), 0);
        // Mục tiêu: Nhóm nhỏ chiếm 20% diện tích nhóm to (Tỷ lệ vàng kinh nghiệm để lấp đầy)
        const targetSmallArea = bigArea * 0.20; 

        // 2. Lấy nhóm "Cát" (Small Sand) - Lấy từ dưới lên
        const smallOnes = [];
        let currentSmallArea = 0;
        const maxSmallCount = MAX_ITEMS - bigCount; // ~240 hình còn lại

        // Duyệt từ cuối mảng lên (nhỏ nhất trước)
        for (let i = sortedByArea.length - 1; i >= bigCount; i--) {
            const rect = sortedByArea[i];
            smallOnes.push(rect);
            currentSmallArea += (rect.width * rect.length);
            
            // Dừng nếu đã đủ diện tích hoặc hết quota số lượng
            if (currentSmallArea >= targetSmallArea || smallOnes.length >= maxSmallCount) {
                break;
            }
        }
        
        workingSet = [...bigOnes, ...smallOnes];
    }

    const rawRects = workingSet.map(r => ({...r}));
    
    // Chuẩn bị dữ liệu
    const rectsHorizontal = this.preAlignRectangles(rawRects, 'horizontal');
    const rectsVertical = this.preAlignRectangles(rawRects, 'vertical');
    const rectsArea = this.sortRectanglesByArea(rawRects); 
    const rectsByHeight = this.sortRectanglesByHeight(rawRects);
    const rectsByWidth = this.sortRectanglesByWidth(rawRects);
    
    // Dữ liệu xen kẽ
    const rectsInterleaved = this._createInterleavedList(rawRects);

    const rectsClustered = rawRects.slice().sort((a, b) => {
        const maxA = Math.max(a.width, a.length); const maxB = Math.max(b.width, b.length);
        if (Math.abs(maxA - maxB) > 0.1) return maxB - maxA;
        const minA = Math.min(a.width, a.length); const minB = Math.min(b.width, b.length);
        return minB - minA;
    });

    const strategies = [
      { name: 'Shelf_Cluster_Smart', fn: () => this._shelfNextFitSmart(rectsClustered, false) },
      { name: 'MaxRects_Interleaved', fn: () => this._maxRectsBSSF(rectsInterleaved.map(r => ({...r})), false) },
      
      { name: 'Shelf_Horizontal_Height', fn: () => this._shelfNextFitSmart(this.sortRectanglesByHeight(rectsHorizontal), false) },
      { name: 'Shelf_Vertical_Width', fn: () => this._shelfNextFitSmart(this.sortRectanglesByWidth(rectsVertical), false) },
      { name: 'MaxRects_BSSF_Height', fn: () => this._maxRectsBSSF(rectsByHeight.map(r => ({...r})), false) },
      { name: 'MaxRects_BSSF_Width', fn: () => this._maxRectsBSSF(rectsByWidth.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Height', fn: () => this._maxRectsBL(rectsByHeight.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Width', fn: () => this._maxRectsBL(rectsByWidth.map(r => ({...r})), false) },
      { name: 'MaxRects_BSSF_Cluster', fn: () => this._maxRectsBSSF(rectsClustered.map(r => ({...r})), false) },
      { name: 'MaxRects_BL_Cluster', fn: () => this._maxRectsBL(rectsClustered.map(r => ({...r})), false) },
      { name: 'MaxRects_BSSF_Area', fn: () => this._maxRectsBSSF(rectsArea.map(r => ({...r})), false) },
      { name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsArea.map(r => ({...r}))) },
      {
        name: 'MonteCarlo_Random_BSSF',
        fn: () => {
            if (rawRects.length > 500) return { placed: [], remaining: [] };
            let bestRandomRun = null;
            const TRIALS = rawRects.length > 200 ? 50 : 2000;
            for (let i = 0; i < TRIALS; i++) {
                const shuffled = this.shuffleArray([...rectsArea.map(r => ({...r}))]);
                const result = this._maxRectsBSSF(shuffled, false);
                if (!bestRandomRun) bestRandomRun = result;
                else if (result.placed.length > bestRandomRun.placed.length) bestRandomRun = result;
                else if (result.placed.length === bestRandomRun.placed.length) {
                     const used1 = result.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                     const used2 = bestRandomRun.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                     if (used1 > used2) bestRandomRun = result;
                }
            }
            return bestRandomRun;
        }
      }
    ];

    let bestResult = null;

    // 3. CHẠY ĐUA (RACE)
    for (const strat of strategies) {
      if (inputRects.length > 1000 && strat.name.includes('MonteCarlo')) {
          continue;
      }

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

      // [OPTIMIZATION 3] EARLY EXIT
      if (compactness > 0.94 && result.placed.length > 0) {
           const placedIds = new Set(result.placed.map(r => r.id));
           const realRemaining = inputRects.filter(r => !placedIds.has(r.id));
           
           const finalPlaced = isBundled ? this._unbundleRects(result.placed) : result.placed;

           const finalRes = {
              placed: finalPlaced.map(r => ({...r, layer: 0})),
              remaining: realRemaining, 
              count: finalPlaced.length,
              usedArea,
              strategyName: strat.name + '_EarlyExit' + (isBundled ? '_Bundled' : '')
           };
           return finalRes;
      }

      const currentResult = {
          placed: result.placed.map(r => ({...r, layer: 0})),
          remaining: result.remaining.map(r => ({...r})),
          count, usedArea, alignmentScore, compactness,
          strategyName: strat.name
      };

      if (!bestResult) {
          bestResult = currentResult;
          continue;
      }
      if (currentResult.count > bestResult.count) {
          bestResult = currentResult;
      } 
      else if (currentResult.count === bestResult.count) {
          if (currentResult.alignmentScore > bestResult.alignmentScore + 50) bestResult = currentResult;
          else if (Math.abs(currentResult.alignmentScore - bestResult.alignmentScore) <= 50) {
               if (currentResult.compactness > bestResult.compactness) bestResult = currentResult;
          }
      }
    }

    if (bestResult) {
        bestResult.strategyName = `FullSize_${bestResult.strategyName}`;
        
        // Unbundle kết quả cuối cùng
        if (isBundled) {
             bestResult.placed = this._unbundleRects(bestResult.placed);
             bestResult.strategyName += '_Bundled';
        }

        const finalPlacedIds = new Set(bestResult.placed.map(r => r.id));
        // Remaining trả về phải là những hình GỐC chưa được xếp
        bestResult.remaining = rectanglesToPack.filter(r => !finalPlacedIds.has(r.id));
    }
    
    return bestResult;
  }
}

export default FullSizeStrategy;