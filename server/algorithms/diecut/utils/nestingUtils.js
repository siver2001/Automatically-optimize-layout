
import {
  getBoundingBox} from '../core/polygonUtils.js';

export function pointInPoly(px, py, polygon) {
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

export function rasterizeToBuffer(polygon, step, spacing, refBB = null) {
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
