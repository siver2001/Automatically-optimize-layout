
import {
  getBoundingBox,
  translate,
  rotatePolygon,
  normalizeToOrigin,
  simplifyPolygon,
  area as polygonArea
} from './polygonUtils.js';
import { rasterizeToBuffer } from '../utils/nestingUtils.js';

export class BaseNesting {
  constructor(config = {}) {
    this.config = {
      sheetWidth: 2000,
      sheetHeight: 1100,
      spacing: 3,
      marginX: 5,
      marginY: 5,
      gridStep: 1,
      allowRotate90: true,
      allowRotate180: true,
      maxSheets: 5,
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

  _checkRasterOverlap(r1, r2, dx, dy) {
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
    let stride = vertical ? raster.rows : raster.cols;
    const minStride = Math.max(1, Math.floor(stride * 0.15));

    while (stride > minStride) {
      const testStride = stride - 1;
      const collision = vertical
        ? this._checkRasterOverlap(raster, raster, 0, testStride)
        : this._checkRasterOverlap(raster, raster, testStride, 0);
      if (collision) break;
      stride = testStride;
    }

    return Math.max(1, stride);
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
}
