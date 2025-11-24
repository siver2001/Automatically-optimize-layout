// server/algorithms/strategies/HybridStrategy.js
import BaseStrategy from './BaseStrategy.js';

class HybridStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  // Chính là _runSingleLayerPacking cũ
  execute(rectanglesToPack) {
    const rawRects = rectanglesToPack.map(r => ({...r}));

    // 1. Chuẩn bị dữ liệu
    const stripHorizontalData = this.preAlignRectangles(rawRects, 'horizontal');
    const sortedByHeight = this.sortRectanglesByHeight(stripHorizontalData);

    const stripVerticalData = this.preAlignRectangles(rawRects, 'vertical');
    const sortedByWidth = this.sortRectanglesByHeight(stripVerticalData);

    const areaData = this.sortRectanglesByArea(rawRects);

    const strategies = [
      // ✅ SMART SHELF
      {
        name: 'Shelf_Smart_Horizontal',
        fn: () => this._shelfNextFitSmart(sortedByHeight.map(r => ({...r})), false) 
      },
      // Chiến thuật cũ
      { 
          name: 'Strip_Horizontal_BL', 
          fn: () => this._maxRectsBL(sortedByHeight.map(r => ({...r})), true) 
      },
      { 
          name: 'Strip_Vertical_BL', 
          fn: () => this._maxRectsBL(sortedByWidth.map(r => ({...r})), true)
      },
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
        
        const count = placed.length;
        const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        const alignmentScore = this._calculateAlignmentScore(placed); 
        const rotatedCount = placed.filter(r => r.rotated).length;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        placed.forEach(r => {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.width);
            maxY = Math.max(maxY, r.y + r.length);
        });
        const boundingArea = (placed.length > 0) ? (maxX - minX) * (maxY - minY) : 0;
        const compactness = (boundingArea > 0) ? (usedArea / boundingArea) : 0; 

        const currentResult = { 
            placed: placed.map(r => ({...r, layer: 0})), 
            remaining: remaining.map(r => ({...r})),
            count, usedArea, alignmentScore, rotatedCount, compactness,
            strategyName: strategy.name
        };

        if (!bestResult) {
            bestResult = currentResult;
            continue;
        }

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

    return bestResult; 
  }

  // Giữ lại hàm này để tương thích ngược (nếu có code nào gọi)
  run2DPacking(rectanglesToPack) {
    return this.execute(rectanglesToPack);
  }
}

export default HybridStrategy;