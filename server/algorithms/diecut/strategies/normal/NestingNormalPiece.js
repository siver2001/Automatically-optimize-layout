import { BaseNesting } from '../../core/BaseNesting.js';
import { flipX, normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';

export class NestingNormalPiece extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _buildUnitFromOrient(item, orient, step) {
    if (!orient?.raster?.cols || !orient?.raster?.rows) return null;

    const sx = this._findStride(orient.raster, false);
    const sy = this._findStride(orient.raster, true);
    const widthMm = sx * step;
    const heightMm = sy * step;
    const bboxArea = Math.max(1e-6, widthMm * heightMm);
    const fillDensity = polygonArea(orient.polygon) / bboxArea;
    const horizontalBias = widthMm / Math.max(1e-6, heightMm);
    const lowProfileScore = 1 / Math.max(1e-6, heightMm);
    const compactScore = fillDensity * 0.70 + (1 / bboxArea) * 0.30;
    const rowScore = lowProfileScore * 0.55 + fillDensity * 0.30 + horizontalBias * 0.15;
    const totalScore = rowScore * 0.58 + compactScore * 0.42;

    return {
      sizeName: item.sizeName,
      foot: item.foot,
      orient,
      sx,
      sy,
      widthMm,
      heightMm,
      compactScore,
      rowScore,
      totalScore
    };
  }

  _selectMastersForItem(item, config, step) {
    const angles = this._getAllowedAngles(config);
    const allUnits = [];

    for (const angle of angles) {
      const orient = this._getOrient(item, angle, step, config.spacing);
      const unit = this._buildUnitFromOrient(item, orient, step);
      if (unit) allUnits.push(unit);
    }

    if (!allUnits.length) return null;

    const rowMaster = [...allUnits].sort((a, b) => {
      if (b.rowScore !== a.rowScore) return b.rowScore - a.rowScore;
      if (a.heightMm !== b.heightMm) return a.heightMm - b.heightMm;
      return b.totalScore - a.totalScore;
    })[0];

    const compactMaster = [...allUnits].sort((a, b) => {
      if (b.compactScore !== a.compactScore) return b.compactScore - a.compactScore;
      if (a.widthMm !== b.widthMm) return a.widthMm - b.widthMm;
      return b.totalScore - a.totalScore;
    })[0];

    return {
      key: `${item.sizeName}__${item.foot || 'X'}`,
      sizeName: item.sizeName,
      foot: item.foot,
      rowMaster,
      compactMaster,
      allUnits
    };
  }

  _packRowsFast(board, bCols, bRows, groupedItems, mastersByKey, placed, config, step) {
    const keyOrder = [...groupedItems.keys()].sort((a, b) => {
      const ma = mastersByKey.get(a)?.rowMaster;
      const mb = mastersByKey.get(b)?.rowMaster;
      const sa = ma
        ? (polygonArea(ma.orient.polygon) * 0.0035) + (ma.compactScore || 0) * 4 + (ma.rowScore || 0) * 3 + ma.totalScore
        : 0;
      const sb = mb
        ? (polygonArea(mb.orient.polygon) * 0.0035) + (mb.compactScore || 0) * 4 + (mb.rowScore || 0) * 3 + mb.totalScore
        : 0;
      return sb - sa;
    });

    let y = 0;
    while (y < bRows) {
      let rowPlaced = false;
      let rowHeight = 0;
      let x = 0;

      while (x < bCols) {
        let placedHere = false;
        const widthLeft = bCols - x;

        for (const key of keyOrder) {
          const queue = groupedItems.get(key);
          if (!queue || !queue.length) continue;

          const masters = mastersByKey.get(key);
          if (!masters?.rowMaster) continue;

          const unit = x === 0 ? masters.rowMaster : (masters.compactMaster || masters.rowMaster);
          const raster = unit.orient.raster;
          if (raster.cols > widthLeft || y + raster.rows > bRows) continue;

          if (!this._checkCollision(board, bCols, bRows, raster, x, y)) {
            this._mark(board, bCols, raster, x, y, 1);
            const item = queue.shift();
            placed.push(this._buildTempPlacement(item, unit.orient, x, y));
            rowPlaced = true;
            rowHeight = Math.max(rowHeight, unit.sy);
            x += unit.sx;
            placedHere = true;
            break;
          }
        }

        if (!placedHere) x += 1;
      }

      if (!rowPlaced) y += 1;
      else y += rowHeight;

      const hasRemaining = keyOrder.some((key) => groupedItems.get(key)?.length > 0);
      if (!hasRemaining) break;
    }
  }

  _getFallbackUnits(master) {
    if (!master) return [];
    const seen = new Set();
    const candidates = [master.rowMaster, master.compactMaster, ...(master.allUnits || [])];

    return candidates.filter((unit) => {
      if (!unit?.orient?.raster) return false;
      const key = [
        unit.orient.angle,
        unit.orient.raster.cols,
        unit.orient.raster.rows,
        unit.sx,
        unit.sy
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.heightMm - b.heightMm;
    });
  }

  _packFallbackGreedy(board, bCols, bRows, items, mastersByKey, config, step, placed) {
    const sortedItems = [...items].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon));
    const remaining = [];

    for (const item of sortedItems) {
      const key = `${item.sizeName}__${item.foot || 'X'}`;
      const master = mastersByKey.get(key);
      const candidates = this._getFallbackUnits(master);
      let bestPos = null;

      for (const unit of candidates) {
        const raster = unit.orient.raster;
        if (raster.cols > bCols || raster.rows > bRows) continue;

        let found = false;
        for (let y = 0; y <= bRows - raster.rows; y++) {
          for (let x = 0; x <= bCols - raster.cols; x++) {
            if (!this._checkCollision(board, bCols, bRows, raster, x, y)) {
              bestPos = { unit, x, y };
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }

      if (bestPos) {
        this._mark(board, bCols, bestPos.unit.orient.raster, bestPos.x, bestPos.y, 1);
        placed.push(this._buildTempPlacement(item, bestPos.unit.orient, bestPos.x, bestPos.y));
      } else {
        remaining.push(item);
      }
    }

    return remaining;
  }

  _packOneSheet(items, config) {
    const step = config.gridStep || 1;
    const workWidth = config.sheetWidth - 2 * config.marginX;
    const workHeight = config.sheetHeight - 2 * config.marginY;
    const bCols = Math.ceil(workWidth / step);
    const bRows = Math.ceil(workHeight / step);
    const board = new Uint8Array(bCols * bRows);
    const tempPlaced = [];

    const groupedItems = new Map();
    for (const item of items) {
      const key = `${item.sizeName}__${item.foot || 'X'}`;
      if (!groupedItems.has(key)) groupedItems.set(key, []);
      groupedItems.get(key).push(item);
    }

    const mastersByKey = new Map();
    for (const [key, queue] of groupedItems.entries()) {
      if (!queue.length) continue;
      const master = this._selectMastersForItem(queue[0], config, step);
      if (master) mastersByKey.set(key, master);
    }

    this._packRowsFast(board, bCols, bRows, groupedItems, mastersByKey, tempPlaced, config, step);

    const tempPlacedIds = new Set(tempPlaced.map((placement) => placement.item.id));
    const afterRows = items.filter((item) => !tempPlacedIds.has(item.id));
    const remaining = this._packFallbackGreedy(
      board,
      bCols,
      bRows,
      afterRows,
      mastersByKey,
      config,
      step,
      tempPlaced
    );

    const compactPlaced = this._compactTempPlacements(tempPlaced, bCols, bRows);
    const placed = this._materializeTempPlacements(compactPlaced, config, step);

    return { placed, remaining };
  }

  async nest(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._orientCache.clear();
    const startedAt = Date.now();

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
    const maxSheets = Number.isFinite(config.maxSheets) && config.maxSheets > 0
      ? config.maxSheets
      : Number.POSITIVE_INFINITY;

    while (items.length > 0 && sheetIndex < maxSheets) {
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
