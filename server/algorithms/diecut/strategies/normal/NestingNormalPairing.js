
import { BaseNesting } from '../../core/BaseNesting.js';
import { flipX, normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';
import { PairOptimizer } from '../../core/pairOptimizer.js';

export class NestingNormalPairing extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _findStride(raster, vertical = false) {
    let s = vertical ? raster.rows : raster.cols;
    const min = Math.max(1, Math.floor(s * 0.15));
    while (s > min) {
      const test = s - 1;
      const collision = vertical
        ? this._checkCol(raster, raster, 0, test)
        : this._checkCol(raster, raster, test, 0);
      if (collision) break;
      s = test;
    }
    return Math.max(1, s);
  }

  _checkCol(r1, r2, dx, dy) {
    const ys = Math.max(0, -dy);
    const ye = Math.min(r2.rows, r1.rows - dy);
    const xs = Math.max(0, -dx);
    const xe = Math.min(r2.cols, r1.cols - dx);
    if (ys >= ye || xs >= xe) return false;

    for (let r = ys; r < ye; r++) {
      const o1 = (r + dy) * r1.cols;
      const o2 = r * r2.cols;
      for (let c = xs; c < xe; c++) {
        if (r2.cells[o2 + c] && r1.cells[o1 + c + dx]) return true;
      }
    }
    return false;
  }

  _buildUnitFromPairResult(sizeName, scenario, result, config, step) {
    const leftItem = { sizeName, foot: scenario.labelA, polygon: scenario.p1 };
    const rightItem = { sizeName, foot: scenario.labelB, polygon: scenario.p2 };

    const aOrient = this._getOrient(leftItem, result.angle1, step, config.spacing);
    const bOrient = this._getOrient(rightItem, result.angle2, step, config.spacing);

    const dx = Math.round(result.offset.x / step);
    const dy = Math.round(result.offset.y / step);
    const minX = Math.min(0, dx);
    const minY = Math.min(0, dy);
    const maxX = Math.max(aOrient.raster.cols, dx + bOrient.raster.cols);
    const maxY = Math.max(aOrient.raster.rows, dy + bOrient.raster.rows);
    if (maxX <= minX || maxY <= minY) return null;

    const cols = maxX - minX;
    const rows = maxY - minY;
    const cells = new Uint8Array(cols * rows);
    const ax = -minX;
    const ay = -minY;
    const bx = dx - minX;
    const by = dy - minY;

    for (let r = 0; r < aOrient.raster.rows; r++) {
      const src = r * aOrient.raster.cols;
      const dst = (ay + r) * cols + ax;
      for (let c = 0; c < aOrient.raster.cols; c++) {
        if (aOrient.raster.cells[src + c]) cells[dst + c] = 1;
      }
    }

    for (let r = 0; r < bOrient.raster.rows; r++) {
      const src = r * bOrient.raster.cols;
      const dst = (by + r) * cols + bx;
      for (let c = 0; c < bOrient.raster.cols; c++) {
        if (bOrient.raster.cells[src + c]) cells[dst + c] = 1;
      }
    }

    const unitR = { cells, cols, rows };
    const sx = this._findStride(unitR, false);
    const sy = this._findStride(unitR, true);

    return {
      sizeName,
      aOrient,
      bOrient,
      unitR,
      ax, ay, bx, by, sx, sy,
      widthMm: sx * step,
      heightMm: sy * step
    };
  }

  _selectMastersForSize(sizeName, polygon, config, step) {
    const left = normalizeToOrigin(polygon);
    const right = normalizeToOrigin(flipX(polygon));
    const scenarios = [
      { p1: left, p2: left, labelA: 'L', labelB: 'L' },
      { p1: right, p2: right, labelA: 'R', labelB: 'R' }
    ];

    if (config.pairingStrategy !== 'same-side') {
      scenarios.push(
        { p1: left, p2: right, labelA: 'L', labelB: 'R' },
        { p1: right, p2: left, labelA: 'R', labelB: 'L' }
      );
    }

    const opt = new PairOptimizer({
      spacing: config.spacing,
      translationStep: config.gridStep <= 0.5 ? 0.5 : 1,
      rotationAngles: this._getAllowedAngles(config)
    });

    const allUnits = [];
    for (const scenario of scenarios) {
      const candidates = opt.optimize(scenario.p1, scenario.p2, scenario.labelA, scenario.labelB).slice(0, 6);
      for (const candidate of candidates) {
        const unit = this._buildUnitFromPairResult(sizeName, scenario, candidate, config, step);
        if (unit) {
          // Gán thêm các score để so sánh
          unit.score = candidate.totalScore;
          unit.rowScore = candidate.rowScore;
          unit.compactScore = candidate.compactScore;
          allUnits.push(unit);
        }
      }
    }

    if (!allUnits.length) return null;

    const rowMaster = [...allUnits].sort((a, b) => {
      if (b.rowScore !== a.rowScore) return b.rowScore - a.rowScore;
      if (a.heightMm !== b.heightMm) return a.heightMm - b.heightMm;
      return b.score - a.score;
    })[0];

    const compactMaster = [...allUnits].sort((a, b) => {
      if (b.compactScore !== a.compactScore) return b.compactScore - a.compactScore;
      return b.score - a.score;
    })[0];

    return { sizeName, rowMaster, compactMaster, allUnits };
  }

  _packRowsFast(board, bCols, bRows, groupedPairs, mastersBySize, config, step, placed) {
    const sizeOrder = [...groupedPairs.keys()].sort((a, b) => {
      const ma = mastersBySize.get(a)?.rowMaster;
      const mb = mastersBySize.get(b)?.rowMaster;
      const sa = ma ? (100000 / Math.max(1, ma.heightMm)) + ma.score : 0;
      const sb = mb ? (100000 / Math.max(1, mb.heightMm)) + mb.score : 0;
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

        for (const sizeName of sizeOrder) {
          const queue = groupedPairs.get(sizeName);
          if (!queue || !queue.length) continue;

          const masters = mastersBySize.get(sizeName);
          if (!masters?.rowMaster) continue;

          const unit = x === 0 ? masters.rowMaster : (masters.compactMaster || masters.rowMaster);
          if (unit.unitR.cols > widthLeft || y + unit.unitR.rows > bRows) continue;

          if (!this._checkCollision(board, bCols, bRows, unit.unitR, x, y)) {
            this._mark(board, bCols, unit.unitR, x, y, 1);
            const pair = queue.shift();
            placed.push(this._buildPlaced(pair.left, unit.aOrient, x + unit.ax, y + unit.ay, config, step));
            placed.push(this._buildPlaced(pair.right, unit.bOrient, x + unit.bx, y + unit.by, config, step));
            
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

      const remaining = sizeOrder.some(name => groupedPairs.get(name)?.length > 0);
      if (!remaining) break;
    }
  }

  _packOneSheet(pairs, config) {
    const step = config.gridStep || 1;
    const workWidth = config.sheetWidth - 2 * config.marginX;
    const workHeight = config.sheetHeight - 2 * config.marginY;
    const bCols = Math.ceil(workWidth / step);
    const bRows = Math.ceil(workHeight / step);
    const board = new Uint8Array(bCols * bRows);
    const placed = [];

    const groupedPairs = new Map();
    for (const pair of pairs) {
      if (!groupedPairs.has(pair.sizeName)) groupedPairs.set(pair.sizeName, []);
      groupedPairs.get(pair.sizeName).push(pair);
    }

    const mastersBySize = new Map();
    for (const [sizeName, queue] of groupedPairs.entries()) {
      if (!queue.length) continue;
      const master = this._selectMastersForSize(sizeName, queue[0].left.polygon, config, step);
      if (master) mastersBySize.set(sizeName, master);
    }

    this._packRowsFast(board, bCols, bRows, groupedPairs, mastersBySize, config, step, placed);

    const placedIds = new Set(placed.map(p => p.id));
    const remaining = pairs.filter(pair => !placedIds.has(pair.left.id));
    return { placed, remaining };
  }

  buildPairs(sizeList) {
    const pairs = [];
    let idCounter = 0;
    for (const size of sizeList) {
      const qty = size.quantity || 0;
      const leftPoly = normalizeToOrigin(size.polygon);
      const rightPoly = normalizeToOrigin(flipX(size.polygon));
      for (let i = 0; i < qty; i++) {
        pairs.push({
          sizeName: size.sizeName,
          left: { id: `${size.sizeName}_L_${idCounter}`, sizeName: size.sizeName, foot: 'L', polygon: leftPoly },
          right: { id: `${size.sizeName}_R_${idCounter}`, sizeName: size.sizeName, foot: 'R', polygon: rightPoly }
        });
        idCounter++;
      }
    }
    return pairs;
  }

  async nest(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._orientCache.clear();
    const startedAt = Date.now();
    const sheets = [];
    let remaining = this.buildPairs(sizeList);
    let sheetIndex = 0;

    while (remaining.length > 0 && sheetIndex < (config.maxSheets || 10)) {
      const { placed, remaining: nextRemaining } = this._packOneSheet(remaining, config);
      if (!placed.length) break;

      const usedArea = placed.reduce((sum, item) => sum + polygonArea(item.polygon), 0);
      sheets.push({
        sheetIndex,
        placed,
        placedCount: placed.length,
        efficiency: parseFloat(((usedArea / (config.sheetWidth * config.sheetHeight)) * 100).toFixed(1))
      });
      remaining = nextRemaining;
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
