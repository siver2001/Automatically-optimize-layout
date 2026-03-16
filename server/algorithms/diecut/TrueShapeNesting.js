/**
 * TrueShapeNesting.js - v7 Ultra-Performance Industrial Nesting
 * Optimized for real-time UI & Maximum Yield.
 */

import {
  getBoundingBox,
  translate,
  rotatePolygon,
  flipX,
  normalizeToOrigin,
  simplifyPolygon,
  area as polygonArea
} from './polygonUtils.js';
import { PairOptimizer } from './pairOptimizer.js';

// ─────────────────────────────────────────────────────────────────────
// Rasterized Unit: The "Stamp" that makes nesting fast
// ─────────────────────────────────────────────────────────────────────

function pointInPoly(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    if ((polygon[i].y > py) !== (polygon[j].y > py) && px < ((polygon[j].x - xi) * (py - yi) / (polygon[j].y - yi)) + xi) inside = !inside;
  }
  return inside;
}

function rasterizeToBuffer(polygon, step, spacing, refBB = null) {
  const bb = refBB || getBoundingBox(polygon);
  const pad = Math.round((spacing / 2) / step);
  const cols = Math.ceil(bb.width / step) + 2 + pad * 2;
  const rows = Math.ceil(bb.height / step) + 2 + pad * 2;
  const cells = new Uint8Array(cols * rows);

  const offX = bb.minX, offY = bb.minY;

  for (let r = pad; r < rows - pad; r++) {
    const wy = (r - pad) * step + step * 0.5 + offY;
    for (let c = pad; c < cols - pad; c++) {
      if (pointInPoly((c - pad) * step + step * 0.5 + offX, wy, polygon)) cells[r * cols + c] = 1;
    }
  }

  // Khuyếch đại biên để tạo khoảng cách (Dilation)
  const expanded = new Uint8Array(cols * rows);
  if (pad > 0) {
    const h = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const off = r * cols;
      for (let c = 0; c < cols; c++) {
        if (!cells[off + c]) continue;
        for (let cc = Math.max(0, c - pad); cc <= Math.min(cols - 1, c + pad); cc++) h[off + cc] = 1;
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!h[r * cols + c]) continue;
        for (let rr = Math.max(0, r - pad); rr <= Math.min(rows - 1, r + pad); rr++) expanded[rr * cols + c] = 1;
      }
    }
  } else expanded.set(cells);
  return { cells: expanded, cols, rows, pad };
}

// ─────────────────────────────────────────────────────────────────────
// Main Class
// ─────────────────────────────────────────────────────────────────────

export class TrueShapeNesting {
  constructor(config = {}) {
    this.config = {
      sheetWidth: 2000,
      sheetHeight: 1100,
      spacing: 3,
      marginX: 5,
      marginY: 5,
      pairingStrategy: 'same-side',
      gridStep: 1.0,
      rotationAngles: [0, 90, 180, 270],
      ...config
    };
    this._cache = new Map();
  }

  _getOrient(item, angle, step, spacing) {
    const key = `${item.sizeName}-${item.foot || 'L'}-${angle}-${step}-${spacing}`;
    if (this._cache.has(key)) return this._cache.get(key);
    
    // 1. Tạo Polygon độ phân giải CAO để xuất kết quả cuối cùng
    const highPoly = normalizeToOrigin(rotatePolygon(item.polygon, angle * Math.PI / 180));
    
    // 2. Tạo Polygon độ phân giải thấp (đã đơn giản hóa) để tính Raster nhanh
    const bb = getBoundingBox(highPoly);
    const lowPoly = simplifyPolygon(highPoly, 0.4);
    
    // RasterizeToBuffer sử dụng BBox của HighPoly để đảm bảo khớp tọa độ khi gán lại
    const raster = rasterizeToBuffer(lowPoly, step, spacing, bb);
    
    const res = { angle, polygon: highPoly, raster };
    this._cache.set(key, res);
    return res;
  }

  _checkCollision(board, bCols, bRows, r, bx, by) {
    if (bx < 0 || by < 0 || bx + r.cols > bCols || by + r.rows > bRows) return true;
    for (let i = 0; i < r.rows; i++) {
        const bOff = (by + i) * bCols + bx, rOff = i * r.cols;
        for (let j = 0; j < r.cols; j++) if (r.cells[rOff + j] && board[bOff + j]) return true;
    }
    return false;
  }

  _mark(board, bCols, r, bx, by) {
    for (let i = 0; i < r.rows; i++) {
        const bOff = (by + i) * bCols + bx, rOff = i * r.cols;
        for (let j = 0; j < r.cols; j++) if (r.cells[rOff + j]) board[bOff + j] = 1;
    }
  }

  _createUnit(size, config, step) {
    // Không simplify ở đây để giữ nguyên tọa độ gốc
    const base = size.polygon;
    const left = base, right = flipX(base);
    const opt = new PairOptimizer({ spacing: config.spacing, translationStep: 2 });
    
    const scs = (config.pairingStrategy === 'same-side') 
        ? [{p1:left, p2:left, l1:'L', l2:'L'}, {p1:right, p2:right, l1:'R', l2:'R'}]
        : [{p1:left, p2:right, l1:'L', l2:'R'}];

    let bestUnit = null, maxYield = -1;
    for (const sc of scs) {
        const results = opt.optimize(sc.p1, sc.p2, sc.l1, sc.l2);
        for (const res of results.slice(0, 5)) {
            const lo = this._getOrient({ sizeName: size.sizeName, foot: sc.l1, polygon: sc.p1 }, res.angle1, step, config.spacing);
            const ro = this._getOrient({ sizeName: size.sizeName, foot: sc.l2, polygon: sc.p2 }, res.angle2, step, config.spacing);
            
            const dx = Math.round(res.offset.x / step), dy = Math.round(res.offset.y / step);
            const minX = Math.min(0, dx), minY = Math.min(0, dy);
            const maxX = Math.max(lo.raster.cols, dx + ro.raster.cols), maxY = Math.max(lo.raster.rows, dy + ro.raster.rows);
            const unitW = maxX - minX, unitH = maxY - minY;

            // Tạo "Siêu Raster" cho Đơn vị chuẩn (The Stamp)
            const unitCells = new Uint8Array(unitW * unitH);
            const r1 = lo.raster, r2 = ro.raster;
            const ax = -minX, ay = -minY, bx = dx - minX, by = dy - minY;
            
            for (let r = 0; r < r1.rows; r++) {
               const offR = r * r1.cols, offU = (ay + r) * unitW + ax;
               for (let c = 0; c < r1.cols; c++) if (r1.cells[offR + c]) unitCells[offU + c] = 1;
            }
            for (let r = 0; r < r2.rows; r++) {
               const offR = r * r2.cols, offU = (by + r) * unitW + bx;
               for (let c = 0; c < r2.cols; c++) if (r2.cells[offR + c]) unitCells[offU + c] = 1;
            }

            const unitR = { cells: unitCells, cols: unitW, rows: unitH };
            const sx = this._findStride(unitR, unitR, step), sy = this._findStride(unitR, unitR, step, true);
            
            const yieldVal = Math.floor((config.sheetWidth / (sx * step))) * Math.floor((config.sheetHeight / (sy * step))) * 2;
            if (yieldVal > maxYield) {
                maxYield = yieldVal;
                bestUnit = { sizeName: size.sizeName, lOrient: lo, rOrient: ro, unitR, ax, ay, bx, by, sx, sy };
            }
        }
    }
    return bestUnit;
  }

  _findStride(r1, r2, step, vertical = false) {
    let s = vertical ? r1.rows : r1.cols;
    const min = Math.floor(s * 0.1);
    while (s > min) {
        const test = s - 1;
        const collision = vertical ? this._checkCol(r1, r2, 0, test) : this._checkCol(r1, r2, test, 0);
        if (collision) break;
        s = test;
    }
    return s;
  }

  _checkCol(r1, r2, dx, dy) {
    const ys = Math.max(0, -dy), ye = Math.min(r2.rows, r1.rows - dy);
    const xs = Math.max(0, -dx), xe = Math.min(r2.cols, r1.cols - dx);
    if (ys >= ye || xs >= xe) return false;
    for (let r = ys; r < ye; r++) {
        const o1 = (r + dy) * r1.cols, o2 = r * r2.cols;
        for (let c = xs; c < xe; c++) if (r2.cells[o2 + c] && r1.cells[o1 + c + dx]) return true;
    }
    return false;
  }

  _packOneSheet(pairs, config) {
    const step = config.gridStep || 1.0;
    const bCols = Math.ceil((config.sheetWidth - 2 * config.marginX) / step);
    const bRows = Math.ceil((config.sheetHeight - 2 * config.marginY) / step);
    const board = new Uint8Array(bCols * bRows), placed = [];

    const sizeGroups = new Map();
    for (const p of pairs) {
      if (!sizeGroups.has(p.sizeName)) sizeGroups.set(p.sizeName, []);
      sizeGroups.get(p.sizeName).push(p);
    }

    const units = Array.from(sizeGroups.entries()).map(([name, g]) => this._createUnit({ sizeName: name, polygon: g[0].left.polygon }, config, step)).filter(u => u);

    for (const u of units) {
       const g = sizeGroups.get(u.sizeName);
       let pIdx = 0, y = 0, rIdx = 0;
       while (pIdx < g.length && y + u.unitR.rows <= bRows) {
          let x = (rIdx % 2 === 1) ? -Math.floor(u.sx / 2) : 0;
          rIdx++;
          // FAST TILING: Nếu hàng sạch, nhét cả loạt
          while (x <= bCols - u.unitR.cols + 10 && pIdx < g.length) {
             const ex = Math.max(0, Math.round(x));
             if (!this._checkCollision(board, bCols, bRows, u.unitR, ex, y)) {
                this._mark(board, bCols, u.unitR, ex, y);
                const p = g[pIdx];
                placed.push(this._build(p.left, u.lOrient, ex + u.ax, y + u.ay, config, step));
                placed.push(this._build(p.right, u.rOrient, ex + u.bx, y + u.by, config, step));
                pIdx++; x += u.sx;
             } else x += 2;
          }
          y += u.sy;
       }
       sizeGroups.set(u.sizeName, g.slice(pIdx));
    }

    // LEFT OVER: Nhét nốt hàng đơn vào kẽ hở bằng logic Row-Filling chuẩn
    const survivors = [];
    for (const [name, g] of sizeGroups) g.forEach(p => { survivors.push(p.left); survivors.push(p.right); });
    if (survivors.length > 0) this._fill(board, bCols, bRows, survivors, config, step, placed);

    const ids = new Set(placed.map(i => i.id));
    return { placed, remaining: pairs.filter(p => !ids.has(p.left.id)) };
  }

  _fill(board, bCols, bRows, items, config, step, placed) {
    let idx = 0;
    let y = 0;
    const candidateAngles = [0, 90, 180, 270];

    while (y < bRows && idx < items.length) {
      let rowAngle = null;
      let rowHeight = 0;
      let x = 0;
      let placedAny = false;

      // Chọn góc cho cả hàng
      for (const ang of candidateAngles) {
        const o = this._getOrient(items[idx], ang, step, config.spacing);
        if (x + o.raster.cols > bCols || y + o.raster.rows > bRows) continue;
        if (!this._checkCollision(board, bCols, bRows, o.raster, x, y)) {
          rowAngle = ang;
          break;
        }
      }

      if (rowAngle === null) {
        y += 1;
        continue;
      }

      while (x < bCols && idx < items.length) {
        const o = this._getOrient(items[idx], rowAngle, step, config.spacing);

        if (x + o.raster.cols <= bCols &&
            y + o.raster.rows <= bRows &&
            !this._checkCollision(board, bCols, bRows, o.raster, x, y)) {
          this._mark(board, bCols, o.raster, x, y);
          placed.push(this._build(items[idx], o, x, y, config, step));
          rowHeight = Math.max(rowHeight, o.raster.rows);
          x += o.raster.cols;
          idx++;
          placedAny = true;
        } else {
          x += 1;
        }
      }

      y += placedAny ? Math.max(1, rowHeight) : 1;
    }
  }

  _build(item, o, x, y, config, step) {
    const xm = config.marginX + (x - o.raster.pad) * step, ym = config.marginY + (y - o.raster.pad) * step;
    return { id: item.id, sizeName: item.sizeName, x: parseFloat(xm.toFixed(2)), y: parseFloat(ym.toFixed(2)), angle: o.angle, polygon: translate(o.polygon, xm, ym) };
  }

  async nest(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._cache.clear();
    const startTime = Date.now();
    let remaining = this.buildPairs(sizeList, config);
    const sheets = [];
    let sIdx = 0;
    while (remaining.length > 0 && sIdx < 5) {
      const res = this._packOneSheet(remaining, config);
      if (res.placed.length === 0) break;
      const area = res.placed.reduce((s,i) => s + polygonArea(i.polygon), 0);
      sheets.push({ sheetIndex: sIdx, placed: res.placed, placedCount: res.placed.length, efficiency: parseFloat(((area / (config.sheetWidth * config.sheetHeight)) * 100).toFixed(1)) });
      remaining = res.remaining; sIdx++;
    }
    return { sheets, totalItems: sizeList.reduce((s,i)=>s+i.quantity,0)*2, placedCount: sheets.reduce((s,sh)=>s+sh.placedCount,0), timeMs: Date.now() - startTime };
  }

  buildPairs(sizeList, config) {
    const pairs = [];
    let pairId = 0;
    for (const size of sizeList) {
      const q = size.quantity || 0;
      const lp = normalizeToOrigin(size.polygon), rp = normalizeToOrigin(flipX(size.polygon));
      for (let i = 0; i < q; i++) {
        pairs.push({ pairId, sizeName: size.sizeName, left: { id: `${size.sizeName}_L_${pairId}`, sizeName: size.sizeName, polygon: lp }, right: { id: `${size.sizeName}_R_${pairId}`, sizeName: size.sizeName, polygon: rp } });
        pairId++;
      }
    }
    return pairs;
  }
}

export default TrueShapeNesting;
