
import { NestingNormalPiece } from '../normal/NestingNormalPiece.js';
import { normalizeToOrigin, flipX, translate, area as polygonArea } from '../../core/polygonUtils.js';

export class CapacityTestPiece extends NestingNormalPiece {
  constructor(config = {}) {
    super(config);
  }

  // Tìm khoảng cách Y nhỏ nhất để rB có thể nằm dưới rA (offset X là dx) mà không va chạm.
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

  // Tìm khoảng cách X nhỏ nhất để rB nằm bên phải rA (offset Y là dy) mà không va chạm.
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
    const ax = -minX;
    const ay = -minY;
    const bx = dx - minX;
    const by = dy - minY;

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
    const items = [
      { foot: 'L', polygon: normalizeToOrigin(polygon) },
      { foot: 'R', polygon: normalizeToOrigin(flipX(polygon)) }
    ];

    let maxPieces = 0;
    let bestCfg = null;

    const evalLayout = (cfg) => {
      if (cfg.sx <= 0 || cfg.sy <= 0) return;
      const cols = Math.floor(workWidth / (cfg.sx * step));
      const rows = Math.floor(workHeight / (cfg.sy * step));
      if (cols > 0 && rows > 0) {
        const pieces = cols * rows * cfg.piecesPerUnit;
        if (pieces > maxPieces) {
          maxPieces = pieces;
          bestCfg = { ...cfg, cols, rows };
        }
      }
    };

    // 1-piece unit
    for (const item of items) {
      for (const ang of angles) {
        const oA = this._getOrient(item, ang, step, config.spacing);
        const sx = this._findStride(oA.raster, false);
        const sy = this._findStride(oA.raster, true);
        evalLayout({ sx, sy, piecesPerUnit: 1, layout: [{ o: oA, dx: 0, dy: 0 }] });
      }
    }

    // 2-piece unit (exhaustive search to find deepest interlock)
    const dxStep = Math.max(1, Math.floor(1 / step));
    for (const itemA of items) {
      for (const angA of angles) {
        const oA = this._getOrient(itemA, angA, step, config.spacing);
        const maxArea = oA.raster.cols * oA.raster.rows * 4; // optimization cutoff

        for (const itemB of items) {
          for (const angB of angles) {
            const oB = this._getOrient(itemB, angB, step, config.spacing);

            // Vertical Head-to-Toe staggering offsets
            for (let dx = -oB.raster.cols; dx <= oA.raster.cols; dx += dxStep) {
              const dy = this._minSepV(oA.raster, oB.raster, dx);
              const m = this._merge(oA.raster, oB.raster, dx, dy);
              if (m.cols * m.rows > maxArea) continue; // too sparse
              const sx = this._findStride(m, false);
              const sy = this._findStride(m, true);
              evalLayout({ sx, sy, piecesPerUnit: 2, layout: [{ o: oA, dx: m.ax, dy: m.ay }, { o: oB, dx: m.bx, dy: m.by }] });
            }

            // Horizontal staggering offsets (side by side)
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

      const { cols, rows, piecesPerUnit, sx, sy, layout } = best;
      const pieces = cols * rows * piecesPerUnit;
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
        tileInfo: { cols, rows, piecesPerUnit, unitWidthMm: parseFloat((sx*step).toFixed(2)), unitHeightMm: parseFloat((sy*step).toFixed(2)) }
      };

      sheetsBySize[s.sizeName] = sheet;
      summary.push({ sizeName: s.sizeName, sizeValue: s.sizeValue, totalPieces: pieces, pairs: Math.floor(pieces / 2), placedCount: pieces, efficiency });
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true, mode: 'test-capacity-piece', summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName, sheet: defaultSheet, sheetsBySize, timeMs: Date.now() - startTime
    };
  }
}
