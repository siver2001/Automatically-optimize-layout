/**
 * polygonUtils.js - Tiện ích xử lý đa giác (True Shape) cho hàng Die-Cut
 *
 * Cung cấp các hàm:
 * - Tính diện tích đa giác (Shoelace formula)
 * - Tính Bounding Box
 * - Dịch chuyển (Translate) polygon
 * - Xoay (Rotate) polygon theo góc độ
 * - Lật gương (Mirror/Flip) polygon theo X hoặc Y
 * - Kiểm tra va chạm đơn giản bằng SAT (Separating Axis Theorem)
 * - Tính No-Fit Polygon (NFP) theo phương pháp Minkowski Sum
 */

// ─────────────────────────────────────────────
// 1. CÁC HÀM CƠ BẢN
// ─────────────────────────────────────────────

/**
 * Tính diện tích đa giác (dương hoặc âm - xác định chiều CW/CCW)
 * @param {Array<{x,y}>} polygon
 * @returns {number} Signed Area
 */
export function signedArea(polygon) {
  let s = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += (polygon[i].x * polygon[j].y) - (polygon[j].x * polygon[i].y);
  }
  return s / 2;
}

/**
 * Tính diện tích tuyệt đối của polygon
 */
export function area(polygon) {
  return Math.abs(signedArea(polygon));
}

/**
 * Đảo chiều polygon thành Counter-Clockwise (CCW - dương)
 */
export function ensureCCW(polygon) {
  if (signedArea(polygon) < 0) {
    return [...polygon].reverse();
  }
  return polygon;
}

/**
 * Tính Bounding Box của polygon
 * @returns {{minX,minY,maxX,maxY,width,height}}
 */
export function getBoundingBox(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Kiểm tra nhanh xem 2 Bounding Box có giao nhau không (hỗ trợ spacing)
 */
export function boundingBoxOverlap(bb1, bb2, spacing = 0) {
  return !(
    bb1.maxX + spacing <= bb2.minX ||
    bb1.minX - spacing >= bb2.maxX ||
    bb1.maxY + spacing <= bb2.minY ||
    bb1.minY - spacing >= bb2.maxY
  );
}

/**
 * Tính Centroid (tâm) của polygon
 */
export function centroid(polygon) {
  const n = polygon.length;
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    cx += (polygon[i].x + polygon[j].x) * cross;
    cy += (polygon[i].y + polygon[j].y) * cross;
    a += cross;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// ─────────────────────────────────────────────
// 2. BIẾN ĐỔI HÌNH HỌC (Transform)
// ─────────────────────────────────────────────

/**
 * Dịch chuyển polygon
 */
export function translate(polygon, dx, dy) {
  return polygon.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Xoay polygon theo góc (tính bằng radian) quanh tâm quay
 */
export function rotatePolygon(polygon, angleRad, cx = 0, cy = 0) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return polygon.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  });
}

/**
 * Xoay polygon 180 độ quanh tâm polygon
 */
export function rotate180(polygon) {
  const bb = getBoundingBox(polygon);
  const cx = bb.minX + bb.width / 2;
  const cy = bb.minY + bb.height / 2;
  return rotatePolygon(polygon, Math.PI, cx, cy);
}

/**
 * Lật gương theo trục X (flip horizontal) → tạo bàn chân Phải từ Trái
 */
export function flipX(polygon) {
  const bb = getBoundingBox(polygon);
  const cx = bb.minX + bb.width / 2;
  return flipXWithCenter(polygon, cx);
}

/**
 * Lật gương theo trục X với tâm cx cố định
 */
export function flipXWithCenter(polygon, cx) {
  return polygon.map(p => ({ x: 2 * cx - p.x, y: p.y }));
}

/**
 * Normalize polygon: dịch về gốc tọa độ (0,0)
 */
export function normalizeToOrigin(polygon) {
  const bb = getBoundingBox(polygon);
  return translate(polygon, -bb.minX, -bb.minY);
}

/**
 * Round tất cả tọa độ về N chữ số thập phân
 */
export function roundPolygon(polygon, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return polygon.map(p => ({
    x: Math.round(p.x * factor) / factor,
    y: Math.round(p.y * factor) / factor
  }));
}

// ─────────────────────────────────────────────
// 3. VA CHẠM VÀ NFP (No-Fit Polygon)
// ─────────────────────────────────────────────

/**
 * Kiểm tra điểm có nằm trong polygon không (Ray-casting)
 * Hỗ trợ offset để không cần phải clone polygon
 */
export function pointInPolygon(point, polygon, offset = {x: 0, y: 0}) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x + offset.x, yi = polygon[i].y + offset.y;
    const xj = polygon[j].x + offset.x, yj = polygon[j].y + offset.y;
    
    if ((yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Thuật toán Douglas-Peucker: Làm đơn giản hóa đa giác (để tìm check va chạm nhanh)
 * Lọc bớt các điểm răng cưa (noise) trên miếng lót giày.
 * @param {Array<{x,y}>} points 
 * @param {number} tolerance độ lệch tối đa (mm)
 */
export function simplifyPolygon(points, tolerance = 1.0) {
  if (points.length <= 3) return points;

  const getSqDist = (p, p1, p2) => {
    let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2.x; y = p2.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
    let maxSqDist = sqTolerance, index;
    for (let i = first + 1; i < last; i++) {
      let sqDist = getSqDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i; maxSqDist = sqDist;
      }
    }
    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  };

  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, tolerance * tolerance, simplified);
  // Không được quên điểm cuối cùng
  if (points[points.length - 1].x !== points[0].x || points[points.length - 1].y !== points[0].y) {
    simplified.push(points[points.length - 1]);
  }
  
  return simplified;
}

/**
 * Tính NFP (No-Fit Polygon) bằng thuật toán Minkowski Difference cho 2 Convex Hull.
 * Đây là phiên bản đơn giản chạy trên JavaScript thuần.
 * Kết quả: Tập hợp các điểm mà tâm của B không được rơi vào (để A và B không chồng lấn).
 *
 * @param {Array<{x,y}>} A - Polygon đã đặt (cố định)
 * @param {Array<{x,y}>} B - Polygon cần đặt mới (moving)
 * @returns {Array<{x,y}>} NFP Polygon
 */
export function computeNFP(A, B) {
  // Đảo chiều B: dùng B âm (negate) cho Minkowski Difference
  const negB = B.map(p => ({ x: -p.x, y: -p.y }));

  // Convex Hull của A + Convex Hull của (-B) = NFP (Minkowski Sum)
  const sumPoints = [];
  const hA = convexHull(A);
  const hNegB = convexHull(negB);

  for (const pa of hA) {
    for (const pb of hNegB) {
      sumPoints.push({ x: pa.x + pb.x, y: pa.y + pb.y });
    }
  }

  return convexHull(sumPoints);
}

/**
 * Convex Hull (Graham Scan)
 */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const n = sorted.length;
  if (n < 3) return sorted;

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

const segmentDataCache = new WeakMap();

function getSegmentData(poly) {
  let data = segmentDataCache.get(poly);
  if (data) return data;
  
  const n = poly.length;
  data = new Float64Array(n * 8); // x1, y1, x2, y2, minX, maxX, minY, maxY
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const idx = i * 8;
    data[idx] = p1.x;
    data[idx + 1] = p1.y;
    data[idx + 2] = p2.x;
    data[idx + 3] = p2.y;
    data[idx + 4] = p1.x < p2.x ? p1.x : p2.x;
    data[idx + 5] = p1.x > p2.x ? p1.x : p2.x;
    data[idx + 6] = p1.y < p2.y ? p1.y : p2.y;
    data[idx + 7] = p1.y > p2.y ? p1.y : p2.y;
  }
  segmentDataCache.set(poly, data);
  return data;
}

function segmentsIntersectOptimized(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
  const s1x = p1x - p0x;
  const s1y = p1y - p0y;
  const s2x = p3x - p2x;
  const s2y = p3y - p2y;
  
  const denom = -s2x * s1y + s1x * s2y;
  if (denom === 0) return false;
  
  const s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / denom;
  const t = (s2x * (p0y - p2y) - s2y * (p0x - p2x)) / denom;

  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

export function polygonsOverlap(polyA, polyB, offsetA = { x: 0, y: 0 }, offsetB = { x: 0, y: 0 }, spacing = 0) {
  const ax = offsetA.x, ay = offsetA.y;
  const bx = offsetB.x, by = offsetB.y;
  
  // 1. Precise SAT-like intersection check with spacing
  const nA = polyA.length;
  const nB = polyB.length;
  const sqSpacing = spacing * spacing;

  // Pre-transform polyA to avoid repeated additions
  const pA = new Float64Array(nA * 2);
  for (let i = 0; i < nA; i++) {
    pA[i*2] = polyA[i].x + ax;
    pA[i*2+1] = polyA[i].y + ay;
  }

  // Pre-transform polyB
  const pB = new Float64Array(nB * 2);
  for (let i = 0; i < nB; i++) {
    pB[i*2] = polyB[i].x + bx;
    pB[i*2+1] = polyB[i].y + by;
  }

  for (let i = 0; i < nA; i++) {
    const a1x = pA[i*2], a1y = pA[i*2+1];
    const a2x = pA[((i+1)%nA)*2], a2y = pA[((i+1)%nA)*2+1];

    for (let j = 0; j < nB; j++) {
      const b1x = pB[j*2], b1y = pB[j*2+1];
      const b2x = pB[((j+1)%nB)*2], b2y = pB[((j+1)%nB)*2+1];

      if (segmentsIntersectOptimized(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y)) return true;

      if (spacing > 0) {
        if (sqDistPointSegment(a1x, a1y, b1x, b1y, b2x, b2y) <= sqSpacing) return true;
        if (sqDistPointSegment(b1x, b1y, a1x, a1y, a2x, a2y) <= sqSpacing) return true;
      }
    }
  }

  if (pointInPolygon({x: polyA[0].x + ax, y: polyA[0].y + ay}, polyB, offsetB)) return true;
  if (pointInPolygon({x: polyB[0].x + bx, y: polyB[0].y + by}, polyA, offsetA)) return true;

  return false;
}

function segmentsIntersect(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
  let s1x = p1x - p0x, s1y = p1y - p0y;
  let s2x = p3x - p2x, s2y = p3y - p2y;
  
  // Vector cross direction
  let s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / (-s2x * s1y + s1x * s2y);
  let t = ( s2x * (p0y - p2y) - s2y * (p0x - p2x)) / (-s2x * s1y + s1x * s2y);

  if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
    return true; // giao nhau
  }
  return false;
}

function sqDistPointSegment(px, py, cx, cy, dx, dy) {
  let l2 = (dx - cx) ** 2 + (dy - cy) ** 2;
  if (l2 === 0) return (px - cx) ** 2 + (py - cy) ** 2; // Đoạn thẳng độ dài d=0
  
  let t = ((px - cx) * (dx - cx) + (py - cy) * (dy - cy)) / l2;
  t = Math.max(0, Math.min(1, t)); // Hạn định chỉ rớt trên đoạn vector
  
  return (px - (cx + t * (dx - cx))) ** 2 + (py - (cy + t * (dy - cy))) ** 2;
}

/**
 * Tính khoảng cách giữa 2 điểm
 */
export function distance(p1, p2) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}
