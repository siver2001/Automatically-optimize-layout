
// =========================================================
// File: TrueShapeNesting.js
// =========================================================

import {
  getBoundingBox,
  translate,
  rotatePolygon,
  flipX,
  normalizeToOrigin,
  simplifyPolygon,
  area as polygonArea
} from './core/polygonUtils.js';
import { PairOptimizer } from './core/pairOptimizer.js';

function pointInPoly(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function rasterizeToBuffer(polygon, step, spacing, refBB = null) {
  const bb = refBB || getBoundingBox(polygon);
  const pad = Math.round((spacing / 2) / step);
  const cols = Math.ceil(bb.width / step) + 2 + pad * 2;
  const rows = Math.ceil(bb.height / step) + 2 + pad * 2;
  const cells = new Uint8Array(cols * rows);

  const offX = bb.minX;
  const offY = bb.minY;

  for (let r = pad; r < rows - pad; r++) {
    const wy = (r - pad) * step + step * 0.5 + offY;
    for (let c = pad; c < cols - pad; c++) {
      const wx = (c - pad) * step + step * 0.5 + offX;
      if (pointInPoly(wx, wy, polygon)) {
        cells[r * cols + c] = 1;
      }
    }
  }

  const expanded = new Uint8Array(cols * rows);
  if (pad <= 0) {
    expanded.set(cells);
    return { cells: expanded, cols, rows, pad };
  }

  const horiz = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const off = r * cols;
    for (let c = 0; c < cols; c++) {
      if (!cells[off + c]) continue;
      for (let cc = Math.max(0, c - pad); cc <= Math.min(cols - 1, c + pad); cc++) {
        horiz[off + cc] = 1;
      }
    }
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!horiz[r * cols + c]) continue;
      for (let rr = Math.max(0, r - pad); rr <= Math.min(rows - 1, r + pad); rr++) {
        expanded[rr * cols + c] = 1;
      }
    }
  }

  return { cells: expanded, cols, rows, pad };
}

export class TrueShapeNesting {
  constructor(config = {}) {
    this.config = {
      sheetWidth: 2000,
      sheetHeight: 1100,
      spacing: 3,
      marginX: 5,
      marginY: 5,
      pairingStrategy: 'mirrored',
      gridStep: 1,
      allowRotate90: true,
      allowRotate180: true,
      rotationAngles: null,
      maxSheets: 5,
      localRefine: false,
      ...config
    };
    this._orientCache = new Map();
  }

  _getAllowedAngles(config) {
    if (Array.isArray(config.rotationAngles) && config.rotationAngles.length) {
      return [...new Set(config.rotationAngles.map(v => ((v % 360) + 360) % 360))];
    }
    if (config.allowRotate90 === false && config.allowRotate180 === false) return [0];
    if (config.allowRotate90 === false) return [0, 180];
    if (config.allowRotate180 === false) return [0, 90];
    return [0, 90, 180];
  }

  _getOrient(item, angle, step, spacing) {
    const key = `${item.sizeName}-${item.foot || 'X'}-${angle}-${step}-${spacing}`;
    if (this._orientCache.has(key)) return this._orientCache.get(key);

    const highPoly = normalizeToOrigin(rotatePolygon(item.polygon, angle * Math.PI / 180));
    const bb = getBoundingBox(highPoly);
    const lowPoly = simplifyPolygon(highPoly, 0.4);
    const raster = rasterizeToBuffer(lowPoly, step, spacing, bb);
    const res = { angle, polygon: highPoly, raster };
    this._orientCache.set(key, res);
    return res;
  }

  _checkCollision(board, bCols, bRows, raster, bx, by) {
    if (bx < 0 || by < 0 || bx + raster.cols > bCols || by + raster.rows > bRows) return true;
    for (let r = 0; r < raster.rows; r++) {
      const bOff = (by + r) * bCols + bx;
      const rOff = r * raster.cols;
      for (let c = 0; c < raster.cols; c++) {
        if (raster.cells[rOff + c] && board[bOff + c]) return true;
      }
    }
    return false;
  }

  _mark(board, bCols, raster, bx, by, val = 1) {
    for (let r = 0; r < raster.rows; r++) {
      const bOff = (by + r) * bCols + bx;
      const rOff = r * raster.cols;
      for (let c = 0; c < raster.cols; c++) {
        if (raster.cells[rOff + c]) board[bOff + c] = val;
      }
    }
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
      pairType: result.type,
      score: result.totalScore,
      rowScore: result.rowScore,
      compactScore: result.compactScore,
      gapScore: result.gapScore,
      repeatScore: result.repeatScore,
      alignmentScore: result.alignmentScore,
      aOrient,
      bOrient,
      unitR,
      ax,
      ay,
      bx,
      by,
      sx,
      sy,
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
        if (unit) allUnits.push(unit);
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

    return {
      sizeName,
      rowMaster,
      compactMaster,
      allUnits
    };
  }

  _buildPlaced(item, orient, x, y, config, step) {
    const xm = config.marginX + (x - orient.raster.pad) * step;
    const ym = config.marginY + (y - orient.raster.pad) * step;
    return {
      id: item.id,
      sizeName: item.sizeName,
      foot: item.foot,
      x: parseFloat(xm.toFixed(2)),
      y: parseFloat(ym.toFixed(2)),
      angle: orient.angle,
      polygon: translate(orient.polygon, xm, ym)
    };
  }

  _tryPlaceUnit(board, bCols, bRows, unit, pair, x, y, config, step, placed) {
    if (this._checkCollision(board, bCols, bRows, unit.unitR, x, y)) return false;

    this._mark(board, bCols, unit.unitR, x, y, 1);
    placed.push(this._buildPlaced(pair.left, unit.aOrient, x + unit.ax, y + unit.ay, config, step));
    placed.push(this._buildPlaced(pair.right, unit.bOrient, x + unit.bx, y + unit.by, config, step));
    return true;
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
    let rowIndex = 0;
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

          const unit = x === 0 ? masters.rowMaster : masters.compactMaster || masters.rowMaster;
          if (!unit) continue;
          if (unit.unitR.cols > widthLeft || y + unit.unitR.rows > bRows) continue;

          const pair = queue[0];
          if (!this._tryPlaceUnit(board, bCols, bRows, unit, pair, x, y, config, step, placed)) {
            continue;
          }

          queue.shift();
          rowPlaced = true;
          rowHeight = Math.max(rowHeight, unit.sy);
          x += Math.max(1, unit.sx);
          placedHere = true;
          break;
        }

        if (!placedHere) x += 1;
      }

      if (!rowPlaced) {
        y += 1;
      } else {
        const advance = Math.max(1, rowHeight - (rowIndex % 2 === 1 ? Math.floor(rowHeight * 0.05) : 0));
        y += advance;
        rowIndex += 1;
      }

      const anyRemaining = sizeOrder.some(name => groupedPairs.get(name)?.length);
      if (!anyRemaining) break;
    }
  }

  _findFreeRegions(board, bCols, bRows, minCells = 10) {
    const visited = new Uint8Array(board.length);
    const regions = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let y = 0; y < bRows; y++) {
      for (let x = 0; x < bCols; x++) {
        const idx = y * bCols + x;
        if (board[idx] || visited[idx]) continue;

        const stack = [[x, y]];
        visited[idx] = 1;
        let minX = x;
        let minY = y;
        let maxX = x;
        let maxY = y;
        let areaCells = 0;

        while (stack.length) {
          const [cx, cy] = stack.pop();
          areaCells += 1;
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;

          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= bCols || ny >= bRows) continue;
            const ni = ny * bCols + nx;
            if (board[ni] || visited[ni]) continue;
            visited[ni] = 1;
            stack.push([nx, ny]);
          }
        }

        if (areaCells >= minCells) {
          regions.push({
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            areaCells
          });
        }
      }
    }

    return regions.sort((a, b) => b.areaCells - a.areaCells);
  }

  _fillSinglesInRegion(region, board, bCols, bRows, singles, config, step, placed) {
    const angles = this._getAllowedAngles(config);
    let i = 0;

    while (i < singles.length) {
      const item = singles[i];
      let best = null;

      for (const angle of angles) {
        const orient = this._getOrient(item, angle, step, config.spacing);
        if (orient.raster.cols > region.width || orient.raster.rows > region.height) continue;

        for (let y = region.minY; y <= region.maxY - orient.raster.rows + 1; y++) {
          for (let x = region.minX; x <= region.maxX - orient.raster.cols + 1; x++) {
            if (this._checkCollision(board, bCols, bRows, orient.raster, x, y)) continue;
            const waste = (region.width * region.height) - (orient.raster.cols * orient.raster.rows);
            const edgeBias = Math.abs(x - region.minX) + Math.abs(y - region.minY);
            const score = waste * 0.10 + edgeBias * 0.03;
            if (!best || score < best.score) best = { orient, x, y, score };
          }
        }
      }

      if (!best) {
        i += 1;
        continue;
      }

      this._mark(board, bCols, best.orient.raster, best.x, best.y, 1);
      placed.push(this._buildPlaced(item, best.orient, best.x, best.y, config, step));
      singles.splice(i, 1);
    }
  }

  _gapFillLight(board, bCols, bRows, groupedPairs, mastersBySize, singles, config, step, placed) {
    const regions = this._findFreeRegions(board, bCols, bRows, 12);
    for (const region of regions) {
      for (const [sizeName, queue] of groupedPairs.entries()) {
        if (!queue.length) continue;
        const unit = mastersBySize.get(sizeName)?.compactMaster;
        if (!unit) continue;
        if (unit.unitR.cols > region.width || unit.unitR.rows > region.height) continue;

        let done = false;
        for (let y = region.minY; y <= region.maxY - unit.unitR.rows + 1 && !done; y++) {
          for (let x = region.minX; x <= region.maxX - unit.unitR.cols + 1; x++) {
            if (!this._tryPlaceUnit(board, bCols, bRows, unit, queue[0], x, y, config, step, placed)) continue;
            queue.shift();
            done = true;
            break;
          }
        }
      }

      if (singles.length) {
        this._fillSinglesInRegion(region, board, bCols, bRows, singles, config, step, placed);
      }
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

    const singles = [];
    for (const queue of groupedPairs.values()) {
      for (const pair of queue) {
        singles.push(pair.left, pair.right);
      }
    }

    if (singles.length) {
      this._gapFillLight(board, bCols, bRows, groupedPairs, mastersBySize, singles, config, step, placed);
    }

    const placedIds = new Set(placed.map(p => p.id));
    const remaining = pairs.filter(pair => !placedIds.has(pair.left.id));
    return { placed, remaining };
  }

  buildPairs(sizeList) {
    const pairs = [];
    let pairId = 0;

    for (const size of sizeList) {
      const quantity = size.quantity || 0;
      const leftPoly = normalizeToOrigin(size.polygon);
      const rightPoly = normalizeToOrigin(flipX(size.polygon));

      for (let i = 0; i < quantity; i++) {
        pairs.push({
          pairId,
          sizeName: size.sizeName,
          left: {
            id: `${size.sizeName}_L_${pairId}`,
            sizeName: size.sizeName,
            foot: 'L',
            polygon: leftPoly
          },
          right: {
            id: `${size.sizeName}_R_${pairId}`,
            sizeName: size.sizeName,
            foot: 'R',
            polygon: rightPoly
          }
        });
        pairId += 1;
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

    while (remaining.length > 0 && sheetIndex < (config.maxSheets || 5)) {
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
      sheetIndex += 1;
    }

    return {
      sheets,
      totalItems: sizeList.reduce((sum, size) => sum + (size.quantity || 0), 0) * 2,
      placedCount: sheets.reduce((sum, sheet) => sum + sheet.placedCount, 0),
      timeMs: Date.now() - startedAt
    };
  }
}

export default TrueShapeNesting;
