// server/algorithms/packingAlgorithm.js
import HybridStrategy from './strategies/HybridStrategy.js';
import FullSizeStrategy from './strategies/FullSizeStrategy.js';

class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.layers = 1;
    this.startTime = null;
  }

  checkTimeout(maxSeconds = 240) {
    if (this.startTime && (Date.now() - this.startTime) / 1000 > maxSeconds) {
      throw new Error(`Thuật toán vượt quá ${maxSeconds} giây`);
    }
  }

  _runGreedyLayeringPass(container, initialRectangles, maxLayers, strategyProcessor) {
    let unpackedRectangles = initialRectangles.map(r => ({ ...r }));
    let allPlacedRectangles = [];
    let layersUsed = 0;

    const canFit = (r) => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length);

    const sanitizeLayer = (placed, remaining) => {
      const accepted = [];
      const stillRemaining = [...remaining];
      const isWithinBounds = (r) => r.x >= 0 && r.y >= 0 && (r.x + r.width) <= container.width && (r.y + r.length) <= container.length;
      const overlaps = (a, b) => (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.length && a.y + a.length > b.y);

      for (const rect of placed) {
        if (!isWithinBounds(rect)) {
          console.error("[Optimize] Algorithm placed rectangle out of bounds:", rect);
          stillRemaining.push(rect);
          continue;
        }
        let conflict = false;
        for (const acc of accepted) {
          if (overlaps(rect, acc)) {
            conflict = true;
            break;
          }
        }
        if (conflict) {
          stillRemaining.push(rect);
        } else {
          accepted.push(rect);
        }
      }
      return { accepted, stillRemaining };
    };

    for (let layer = 0; layer < maxLayers; layer++) {
      this.checkTimeout(30);

      if (unpackedRectangles.length === 0) {
        break;
      }
      const { placed: placedRaw, remaining: remainingRaw } = strategyProcessor.execute(unpackedRectangles);

      const sanitizeResult = sanitizeLayer(placedRaw, []);
      let placedInLayer = sanitizeResult.accepted;

      unpackedRectangles = [...sanitizeResult.stillRemaining, ...remainingRaw];

      placedInLayer.forEach(rect => {
        rect.layer = layer;
        allPlacedRectangles.push(rect);
      });

      if (placedInLayer.length > 0) {
        layersUsed++;
      } else {
        break;
      }
    }

    const containerAreaPerLayer = container.width * container.length;
    const finalUsedArea = allPlacedRectangles.reduce((sum, rect) =>
      sum + (rect.width * rect.length), 0
    );
    const totalUsedArea = containerAreaPerLayer * layersUsed;

    return {
      rectangles: allPlacedRectangles,
      remainingRectangles: unpackedRectangles,
      remainingFeasibleCount: unpackedRectangles.filter(canFit).length,
      remainingUnfitCount: unpackedRectangles.length - unpackedRectangles.filter(canFit).length,
      efficiency: totalUsedArea > 0 ? (finalUsedArea / totalUsedArea) * 100 : 0,
      usedArea: finalUsedArea,
      totalArea: totalUsedArea,
      wasteArea: totalUsedArea - finalUsedArea,
      layersUsed: layersUsed
    };
  }

  async optimize(container, initialRectangles, maxLayers, strategyName = 'AREA_OPTIMIZED') {
    this.startTime = Date.now();
    this.container = container;
    try {
      this.checkTimeout(30);

      let strategyProcessor;
      if (strategyName === 'FULL_SIZE') {
        strategyProcessor = new FullSizeStrategy(container);
      } else {
        strategyProcessor = new HybridStrategy(container);
      }

      // 1. CHẠY THUẬT TOÁN CHÍNH (Lần 1)
      let bestResult = this._runGreedyLayeringPass(container, initialRectangles, maxLayers, strategyProcessor);

      // =====================================================================
      // [NÂNG CẤP] TỐI ƯU HÓA 2 TẤM CUỐI CÙNG (RE-OPTIMIZE LAST 2 SHEETS)
      // =====================================================================

      // [EARLY EXIT] Nếu kết quả đã quá tốt (Hết hàng & Hiệu suất > 95%), bỏ qua bước này để tiết kiệm thời gian
      const isAlreadyOptimal = bestResult.remainingRectangles.length === 0 && bestResult.efficiency > 95;

      if (!isAlreadyOptimal && strategyName !== 'FULL_SIZE' && bestResult.layersUsed > 0 && strategyProcessor.executeFinalSheet) {

        const startOptimizeLayer = Math.max(0, bestResult.layersUsed - 2);
        const endOptimizeLayer = bestResult.layersUsed - 1;

        let itemsToRepack = bestResult.rectangles.filter(r => r.layer >= startOptimizeLayer);

        // Reset kích thước gốc
        itemsToRepack = itemsToRepack.map(r => {
          const { x, y, layer, rotated, ...rest } = r;
          let w = r.width; let l = r.length;
          if (r.rotated) { w = r.length; l = r.width; }
          return { ...rest, width: w, length: l };
        });

        if (itemsToRepack.length > 0) {
          let newPlacedRects = [];
          let currentPool = [...itemsToRepack];
          let success = true;

          for (let i = startOptimizeLayer; i <= endOptimizeLayer; i++) {
            // --- THAY ĐỔI Ở ĐÂY ---
            // Trước đây: Chỉ tấm cuối dùng executeFinalSheet.
            // Bây giờ: CẢ 2 TẤM đều dùng executeFinalSheet.
            // Lý do: executeFinalSheet bỏ qua AlignmentScore, chỉ tập trung Dồn Trái (MaxX Min).

            let res = strategyProcessor.executeFinalSheet(currentPool);

            if (res && res.placed.length > 0) {
              res.placed.forEach(r => {
                r.layer = i;
                // Đánh dấu strategy là Final_DeepSearch để dễ debug
                r.strategy = `ReOpt_ForceLeft_${res.strategyName}`;
                newPlacedRects.push(r);
              });
              currentPool = res.remaining;
            } else {
              if (currentPool.length > 0) success = false;
            }
          }

          // Chỉ cập nhật nếu thành công (xếp hết vật tư và không phát sinh tấm mới)
          if (success && currentPool.length === 0) {
            bestResult.rectangles = bestResult.rectangles.filter(r => r.layer < startOptimizeLayer);
            bestResult.rectangles.push(...newPlacedRects);
          }
        }
      }

      const containerAreaPerLayer = container.width * container.length;
      const finalUsedArea = bestResult.rectangles.reduce((sum, rect) =>
        sum + (rect.width * rect.length), 0
      );
      const totalUsedArea = containerAreaPerLayer * bestResult.layersUsed;

      return {
        ...bestResult,
        strategy: strategyName,
        efficiency: totalUsedArea > 0 ? (finalUsedArea / totalUsedArea) * 100 : 0,
        usedArea: finalUsedArea,
        totalArea: totalUsedArea,
        wasteArea: totalUsedArea - finalUsedArea,
        remainingFeasibleCount: bestResult.remainingRectangles ? bestResult.remainingRectangles.filter(r => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length)).length : 0,
        remainingUnfitCount: bestResult.remainingRectangles ? (bestResult.remainingRectangles.length - bestResult.remainingRectangles.filter(r => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length)).length) : 0
      };

    } catch (error) {
      throw error;
    }
  }
}

export default PackingAlgorithm;