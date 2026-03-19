
import { NestingNormalPairing } from '../normal/NestingNormalPairing.js';
import { normalizeToOrigin, flipX, translate, area as polygonArea } from '../../core/polygonUtils.js';

export class CapacityTestPairing extends NestingNormalPairing {
  constructor(config = {}) {
    super(config);
  }

  _minSepV(rA, rB, dx) {
    for (let dy = -rB.rows; dy <= rA.rows + rB.rows; dy++) {
      let overlap = false;
      const yStart = Math.max(0, dy);
      const yEnd = Math.min(rA.rows, dy + rB.rows);
      if (yStart < yEnd) {
        outer: for (let r = yStart; r < yEnd; r++) {
          const offA = r * rA.cols;
          const offB = (r - dy) * rB.cols;
          for (let cB = 0; cB < rB.cols; cB++) {
            const cA = cB + dx;
            if (cA >= 0 && cA < rA.cols) {
              if (rA.cells[offA + cA] && rB.cells[offB + cB]) {
                overlap = true;
                break outer;
              }
            }
          }
        }
      }
      if (!overlap) return dy;
    }
    return rA.rows + rB.rows;
  }

  _minSepH(rA, rB, dy) {
    for (let dx = -rB.cols; dx <= rA.cols + rB.cols; dx++) {
      let overlap = false;
      const xStart = Math.max(0, dx);
      const xEnd = Math.min(rA.cols, dx + rB.cols);
      if (xStart < xEnd) {
        outer: for (let c = xStart; c < xEnd; c++) {
          for (let rB_c = 0; rB_c < rB.rows; rB_c++) {
             const rA_c = rB_c + dy;
             if (rA_c >= 0 && rA_c < rA.rows) {
                if (rA.cells[rA_c * rA.cols + c] && rB.cells[rB_c * rB.cols + (c - dx)]) {
                   overlap = true;
                   break outer;
                }
             }
          }
        }
      }
      if (!overlap) return dx;
    }
    return rA.cols + rB.cols;
  }

  _merge(rA, rB, dx, dy) {
    const minX = Math.min(0, dx);
    const minY = Math.min(0, dy);
    const maxX = Math.max(rA.cols, dx + rB.cols);
    const maxY = Math.max(rA.rows, dy + rB.rows);
    const cols = maxX - minX;
    const rows = maxY - minY;
    if (cols <= 0 || rows <= 0) return { cells: new Uint8Array(0), cols: 0, rows: 0, ax: 0, ay: 0, bx: 0, by: 0 };
    
    const cells = new Uint8Array(cols * rows);
    const ax = -minX, ay = -minY;
    const bx = dx - minX, by = dy - minY;

    for (let r = 0; r < rA.rows; r++) {
      const src = r * rA.cols;
      const dst = (ay + r) * cols + ax;
      for (let c = 0; c < rA.cols; c++) {
        if (rA.cells[src + c]) cells[dst + c] = 1;
      }
    }

    for (let r = 0; r < rB.rows; r++) {
      const src = r * rB.cols;
      const dst = (by + r) * cols + bx;
      for (let c = 0; c < rB.cols; c++) {
        if (rB.cells[src + c]) cells[dst + c] = 1;
      }
    }

    return { cells, cols, rows, ax, ay, bx, by };
  }

  _findBestConfig(polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const angles = this._getAllowedAngles(config);
    const pL = normalizeToOrigin(polygon);
    const pR = normalizeToOrigin(flipX(polygon));

    // For pairing, a "unit" represents a Left + Right shoe pair.
    // So `piecesPerUnit` = 2.
    // We try all angles for A=Left, B=Right
    // OR A=Left, B=Left (if pairingStrategy allows same-side?)
    // Here we focus on standard pairs: L+R or R+L
    const pairings = [
      { a: { foot: 'L', polygon: pL }, b: { foot: 'R', polygon: pR } },
      { a: { foot: 'R', polygon: pR }, b: { foot: 'L', polygon: pL } }
    ];

    if (config.pairingStrategy === 'same-side') {
      pairings.push(
        { a: { foot: 'L', polygon: pL }, b: { foot: 'L', polygon: pL } },
        { a: { foot: 'R', polygon: pR }, b: { foot: 'R', polygon: pR } }
      );
    }

    let maxPairs = 0;
    let bestCfg = null;

    const evalLayout = (cfg) => {
      if (cfg.sx <= 0 || cfg.sy <= 0) return;
      const cols = Math.floor(workWidth / (cfg.sx * step));
      const rows = Math.floor(workHeight / (cfg.sy * step));
      if (cols > 0 && rows > 0) {
        const pairs = cols * rows; // Each cfg is exactly 1 pair
        if (pairs > maxPairs) {
          maxPairs = pairs;
          bestCfg = { ...cfg, cols, rows };
        }
      }
    };

    const dxStep = Math.max(1, Math.floor(1 / step));

    for (const pair of pairings) {
      for (const angA of angles) {
        const oA = this._getOrient(pair.a, angA, step, config.spacing);
        const maxArea = oA.raster.cols * oA.raster.rows * 4;

        for (const angB of angles) {
          const oB = this._getOrient(pair.b, angB, step, config.spacing);

          // Head-to-Toe / vertical staggering
          for (let dx = -oB.raster.cols; dx <= oA.raster.cols; dx += dxStep) {
            const dy = this._minSepV(oA.raster, oB.raster, dx);
            const m = this._merge(oA.raster, oB.raster, dx, dy);
            if (m.cols * m.rows > maxArea) continue;
            const sx = this._findStride(m, false);
            const sy = this._findStride(m, true);
            evalLayout({ sx, sy, piecesPerUnit: 2, layout: [{ o: oA, dx: m.ax, dy: m.ay }, { o: oB, dx: m.bx, dy: m.by }] });
          }

          // Side-by-Side staggering
          for (let dy = -oB.raster.rows; dy <= oA.raster.rows; dy += dxStep) {
            const dx = this._minSepH(oA.raster, oB.raster, dy);
            const m = this._merge(oA.raster, oB.raster, dx, dy);
            if (m.cols * m.rows > maxArea) continue;
            const sx = this._findStride(m, false);
            const sy = this._findStride(m, true);
            evalLayout({ sx, sy, piecesPerUnit: 2, layout: [{ o: oA, dx: m.ax, dy: m.ay }, { o: oB, dx: m.bx, dy: m.by }] });
          }
        }
      }
    }

    return bestCfg;
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._orientCache.clear();
    const startTime = Date.now();

    const workWidth  = config.sheetWidth  - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const totalArea  = config.sheetWidth  * config.sheetHeight;
    const step = config.gridStep || 1;

    const sheetsBySize = {};
    const summary = [];

    for (const s of sizeList) {
      const best = this._findBestConfig(s.polygon, config, workWidth, workHeight);
      
      if (!best) {
        summary.push({ sizeName: s.sizeName, sizeValue: s.sizeValue, totalPieces: 0, pairs: 0, placedCount: 0, efficiency: 0 });
        sheetsBySize[s.sizeName] = null;
        continue;
      }

      const { cols, rows, sx, sy, layout } = best;
      const pairs = cols * rows;
      const pieces = pairs * 2;
      const pieceArea = polygonArea(s.polygon) || 1;
      const efficiency = totalArea > 0 ? parseFloat(((pieces * pieceArea / totalArea) * 100).toFixed(1)) : 0;

      const placed = [];
      let uid = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const baseX = config.marginX + col * sx * step;
          const baseY = config.marginY + row * sy * step;

          for (const item of layout) {
            const pad = item.o.raster.pad;
            const wx = baseX + item.dx * step - pad * step;
            const wy = baseY + item.dy * step - pad * step;
            placed.push({
              id: `${s.sizeName}_${item.o.foot}_${uid++}`,
              sizeName: s.sizeName,
              foot: item.o.foot,
              x: parseFloat(wx.toFixed(2)),
              y: parseFloat(wy.toFixed(2)),
              angle: item.o.angle,
              polygon: translate(item.o.polygon, wx, wy)
            });
          }
        }
      }

      const sheet = {
        sheetIndex: 0, placed,
        sheetWidth: config.sheetWidth, sheetHeight: config.sheetHeight,
        placedCount: pieces, efficiency,
        tileInfo: { cols, rows, pairs, unitWidthMm: parseFloat((sx*step).toFixed(2)), unitHeightMm: parseFloat((sy*step).toFixed(2)) }
      };

      sheetsBySize[s.sizeName] = sheet;
      summary.push({ sizeName: s.sizeName, sizeValue: s.sizeValue, totalPieces: pieces, pairs, placedCount: pieces, efficiency });
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true, mode: 'test-capacity-pairing', summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName, sheet: defaultSheet, sheetsBySize, timeMs: Date.now() - startTime
    };
  }
}
