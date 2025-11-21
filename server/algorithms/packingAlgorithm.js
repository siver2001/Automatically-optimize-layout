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
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
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
                      console.error(`[Optimize] Conflict detected: ${rect.id} overlaps with ${acc.id}`);
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

        // [THAY ĐỔI DUY NHẤT: Gọi Strategy]
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
      
      // Factory: Chọn chiến thuật
      let strategyProcessor;
      if (strategyName === 'FULL_SIZE') {
          strategyProcessor = new FullSizeStrategy(container);
      } else {
          // Mặc định dùng Hybrid cũ
          strategyProcessor = new HybridStrategy(container);
      }

      const bestResult = this._runGreedyLayeringPass(
        container, 
        initialRectangles, 
        maxLayers,
        strategyProcessor
      );
      bestResult.strategy = strategyName;
      return bestResult;
    } catch (error) {
      console.error(`[Algorithm] ✗ Lỗi:`, error);
      throw error;
    }
  }
}

export default PackingAlgorithm;