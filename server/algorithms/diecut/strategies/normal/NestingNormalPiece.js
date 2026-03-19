
import { BaseNesting } from '../../core/BaseNesting.js';
import { flipX, normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';

export class NestingNormalPiece extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _packOneSheet(items, config) {
    const step = config.gridStep || 1;
    const workWidth = config.sheetWidth - 2 * config.marginX;
    const workHeight = config.sheetHeight - 2 * config.marginY;
    const bCols = Math.ceil(workWidth / step);
    const bRows = Math.ceil(workHeight / step);
    const board = new Uint8Array(bCols * bRows);
    const placed = [];
    const remaining = [];

    const angles = this._getAllowedAngles(config);

    // Sắp xếp items theo diện tích giảm dần
    const sortedItems = [...items].sort((a, b) => {
      return polygonArea(b.polygon) - polygonArea(a.polygon);
    });

    for (const item of sortedItems) {
      let bestPos = null;

      // Thử từng góc xoay
      for (const angle of angles) {
        const orient = this._getOrient(item, angle, step, config.spacing);
        if (orient.raster.cols > bCols || orient.raster.rows > bRows) continue;

        // Tìm vị trí đầu tiên trống (Top-Left scan)
        let found = false;
        for (let y = 0; y <= bRows - orient.raster.rows; y++) {
          for (let x = 0; x <= bCols - orient.raster.cols; x++) {
            if (!this._checkCollision(board, bCols, bRows, orient.raster, x, y)) {
              bestPos = { orient, x, y };
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }

      if (bestPos) {
        this._mark(board, bCols, bestPos.orient.raster, bestPos.x, bestPos.y, 1);
        placed.push(this._buildPlaced(item, bestPos.orient, bestPos.x, bestPos.y, config, step));
      } else {
        remaining.push(item);
      }
    }

    return { placed, remaining };
  }

  async nest(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._orientCache.clear();
    const startedAt = Date.now();
    
    // Tạo danh sách các chiếc đơn lẻ (L và R)
    let items = [];
    let idCounter = 0;
    for (const size of sizeList) {
      const qty = size.quantity || 0;
      const leftPoly = normalizeToOrigin(size.polygon);
      const rightPoly = normalizeToOrigin(flipX(size.polygon));
      for (let i = 0; i < qty; i++) {
        items.push({ id: `${size.sizeName}_L_${idCounter}`, sizeName: size.sizeName, foot: 'L', polygon: leftPoly });
        items.push({ id: `${size.sizeName}_R_${idCounter}`, sizeName: size.sizeName, foot: 'R', polygon: rightPoly });
        idCounter++;
      }
    }

    const sheets = [];
    let sheetIndex = 0;

    while (items.length > 0 && sheetIndex < (config.maxSheets || 10)) {
      const { placed, remaining: nextItems } = this._packOneSheet(items, config);
      if (!placed.length) break;

      const usedArea = placed.reduce((sum, item) => sum + polygonArea(item.polygon), 0);
      sheets.push({
        sheetIndex,
        placed,
        placedCount: placed.length,
        efficiency: parseFloat(((usedArea / (config.sheetWidth * config.sheetHeight)) * 100).toFixed(1))
      });
      items = nextItems;
      sheetIndex++;
    }

    return {
      sheets,
      totalItems: sizeList.reduce((sum, s) => sum + (s.quantity || 0), 0) * 2,
      placedCount: sheets.reduce((sum, s) => sum + s.placedCount, 0),
      timeMs: Date.now() - startedAt
    };
  }
}
