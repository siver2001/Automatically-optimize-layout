
// server/algorithms/packingAlgorithm.js
import HybridStrategy from './strategies/HybridStrategy.js';
import FullSizeStrategy from './strategies/FullSizeStrategy.js';
// import HorizontalStrategy from './strategies/HorizontalStrategy.js'; // Removed
import { FastGrid } from './utils/FastGrid.js';

class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.layers = 1;
    this.startTime = null;
  }

  checkTimeout(maxSeconds = 60) {
    if (this.startTime && (Date.now() - this.startTime) / 1000 > maxSeconds) {
      throw new Error(`Thuật toán vượt quá ${maxSeconds} giây`);
    }
  }

  // Helper to ensure safe return result
  _safeResult() {
    return { sheets: [], efficiency: 0, layersUsed: 0 };
  }

  async _runGreedyLayeringPass(container, initialRectangles, maxLayers, strategyProcessor, strategyConfig = {}) {
    let unpackedRectangles = initialRectangles.map(r => ({ ...r }));
    let allPlacedRectangles = [];
    let layersUsed = 0;

    const canFit = (r) => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length);

    const sanitizeLayer = (placed, remaining) => {
      const accepted = [];
      const stillRemaining = [...remaining];
      const isWithinBounds = (r) => r.x >= 0 && r.y >= 0 && (r.x + r.width) <= container.width && (r.y + r.length) <= container.length;

      // --- SPATIAL GRID OPTIMIZATION (TYPED ARRAY) ---
      // Estimate capacity: placed items + potential remaining items
      const capacity = placed.length + remaining.length + 100;
      const grid = new FastGrid(container.width, container.length, 100, capacity);

      for (const rect of placed) {
        if (!isWithinBounds(rect)) {
          console.error("[Optimize] Algorithm placed rectangle out of bounds:", rect);
          stillRemaining.push(rect);
          continue;
        }

        grid.add(rect);
        accepted.push(rect);
      }
      return { accepted, stillRemaining };
    };

    for (let layer = 0; layer < maxLayers; layer++) {
      this.checkTimeout(30);

      if (unpackedRectangles.length === 0) {
        break;
      }

      // [ASYNC UPDATE] Await the execution result
      const { placed: placedRaw, remaining: remainingRaw } = await strategyProcessor.execute(unpackedRectangles, strategyConfig);

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
      let strategyConfig = { alignmentMode: 'default' };

      if (strategyName === 'FULL_SIZE') {
        strategyProcessor = new FullSizeStrategy(container);
      } else if (strategyName === 'AREA_OPTIMIZED_HORIZONTAL') {
        // [MOD] Use HybridStrategy for Horizontal too, but with horizontal alignment bias
        strategyProcessor = new HybridStrategy(container);
        strategyConfig = { alignmentMode: 'horizontal' };
      } else {
        strategyProcessor = new HybridStrategy(container);
      }

      // 1. CHẠY THUẬT TOÁN CHÍNH (Lần 1)
      let bestResult = await this._runGreedyLayeringPass(container, initialRectangles, maxLayers, strategyProcessor, strategyConfig);

      // ===== TRY MERGE LAST 2 SHEETS INTO 1 (REDUCE SHEET COUNT) =====
        if (strategyName !== 'FULL_SIZE' && bestResult.layersUsed >= 2 && strategyProcessor.executeFinalSheet) {
          const startOptimizeLayer = bestResult.layersUsed - 2;

          // lấy toàn bộ item của 2 layer cuối
          let itemsToRepack = bestResult.rectangles.filter(r => r.layer >= startOptimizeLayer);

          // bỏ x/y/layer/rotated và chuẩn hóa width/length giống code bên dưới của bạn
          itemsToRepack = itemsToRepack.map(r => {
            const { x, y, layer, rotated, ...rest } = r;
            let w = r.width, l = r.length;
            if (r.rotated) { w = r.length; l = r.width; }
            return { ...rest, width: w, length: l };
          });

          const merged = await strategyProcessor.executeFinalSheet(itemsToRepack);

          // Nếu nhét hết vào 1 tấm → giảm layersUsed đi 1
          if (merged && merged.remaining && merged.remaining.length === 0) {
            const kept = bestResult.rectangles.filter(r => r.layer < startOptimizeLayer);

            merged.placed.forEach(r => { r.layer = startOptimizeLayer; });

            bestResult.rectangles = kept.concat(merged.placed);
            bestResult.layersUsed = bestResult.layersUsed - 1;
            bestResult.remainingRectangles = [];

            // (tuỳ bạn) có thể return luôn để khỏi chạy bước repack 2 tấm
            // return bestResult;
          }
        }

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
            // executeFinalSheet is now async and parallelized
            let res = await strategyProcessor.executeFinalSheet(currentPool);

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
        remainingUnfitCount: bestResult.remainingRectangles ? (bestResult.remainingRectangles.length - bestResult.remainingRectangles.filter(r => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length)).length) : 0,
        sheets: [] 
      };

    } catch (error) {
      console.error("Optimization failed:", error);
      return { sheets: [], efficiency: 0, error: error.message };
    }
  }
}

export default PackingAlgorithm;