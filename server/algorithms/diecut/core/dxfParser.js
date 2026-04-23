import DxfParser from 'dxf-parser';
import path from 'path';
import {
  getBoundingBox,
  area,
  normalizeToOrigin,
  roundPolygon,
  simplifyPolygon,
  pointInPolygon,
  translate
} from './polygonUtils.js';



/**
 * @param {number} x1 
 * @param {number} y1 
 * @param {number} x2 
 * @param {number} y2 
 * @param {number} bulge  
 * @param {number} _segments 
 * @returns {Array<{x, y}>}
 */
function bulgeToArcPoints(x1, y1, x2, y2, bulge, _segments = 48) {

  if (Math.abs(bulge) < 2e-3) return [];

  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-4) return [];

  // 1. Góc quét của cung (sweep = 4 * atan(bulge)), theta = giá trị tuyệt đối
  const sweep = 4 * Math.atan(bulge);
  const theta = Math.abs(sweep);

  // 2. Bán kính
  const r = chord / (2 * Math.sin(theta / 2));

  // 3. Góc của đường thẳng nối p1 -> p2 (chord angle)
  const alpha = Math.atan2(dy, dx);

  // 4. Góc đường nối từ p1 đến tâm C
  const angle_p1_C = alpha + Math.sign(bulge) * (Math.PI / 2 - theta / 2);

  // 5. Tọa độ tâm
  const cx = x1 + r * Math.cos(angle_p1_C);
  const cy = y1 + r * Math.sin(angle_p1_C);

  // 6. Góc xuất phát từ tâm đến p1
  const startAngle = Math.atan2(y1 - cy, x1 - cx);

  // Tính chu vi cung thực tế để linh hoạt số điểm
  const arcLength = r * theta;
  // Cứ khoảng 0.5mm đến 1.0mm thì lấy 1 điểm để tránh quá dày đặc gây "răng cưa" ảo
  const dynamicSegments = Math.max(2, Math.min(96, Math.ceil(arcLength / 0.5)));

  // 7. Rời rạc hóa cung tròn (CHỈ LẤY ĐIỂM TRUNG GIAN)
  const pts = [];
  for (let i = 1; i < dynamicSegments; i++) {
    const angle = startAngle + (i / dynamicSegments) * sweep;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function splineToPoints(controlPoints, degree = 3, knots = null, segments = 200) {
  const n = controlPoints.length;
  if (n < 2) return controlPoints;

  // Nếu không có knot vector → tạo uniform knot
  if (!knots || knots.length < n + degree + 1) {
    knots = [];
    const totalKnots = n + degree + 1;
    for (let i = 0; i < totalKnots; i++) {
      if (i <= degree) knots.push(0);
      else if (i >= totalKnots - degree - 1) knots.push(1);
      else knots.push((i - degree) / (n - degree));
    }
  } else {
    // Normalize knots về [0,1]
    const kMin = knots[0], kMax = knots[knots.length - 1];
    const kRange = kMax - kMin || 1;
    knots = knots.map(k => (k - kMin) / kRange);
  }

  function deBoor(t) {
    // Tìm knot span
    let k = degree;
    for (let i = degree; i < knots.length - degree - 1; i++) {
      if (t >= knots[i] && t < knots[i + 1]) { k = i; break; }
    }
    if (t >= knots[knots.length - degree - 1]) k = knots.length - degree - 2;

    const d = [];
    for (let i = 0; i <= degree; i++) {
      const idx = k - degree + i;
      if (idx >= 0 && idx < n) {
        d.push({ x: controlPoints[idx].x, y: controlPoints[idx].y });
      } else {
        d.push({ x: 0, y: 0 });
      }
    }

    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const ki = k - degree + j;
        const den = knots[ki + degree - r + 1] - knots[ki];
        const alpha = den < 1e-10 ? 0 : (t - knots[ki]) / den;
        d[j] = {
          x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
          y: (1 - alpha) * d[j - 1].y + alpha * d[j].y
        };
      }
    }
    return d[degree];
  }

  const points = [];
  const tStart = knots[degree];
  const tEnd   = knots[knots.length - degree - 1];

  for (let i = 0; i <= segments; i++) {
    const t = tStart + (i / segments) * (tEnd - tStart);
    const pt = deBoor(t);
    if (isFinite(pt.x) && isFinite(pt.y)) {
      points.push(pt);
    }
  }
  return points;
}

// ─────────────────────────────────────────────
// 3. ARC → Points
// ─────────────────────────────────────────────
function arcToPoints(cx, cy, r, startDeg, endDeg, segments = 64) {
  let startRad = (startDeg * Math.PI) / 180;
  let endRad   = (endDeg   * Math.PI) / 180;
  // DXF ARC luôn CCW -> đảm bảo endRad > startRad
  if (endRad < startRad) endRad += 2 * Math.PI;
  const step = (endRad - startRad) / segments;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = startRad + i * step;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// ─────────────────────────────────────────────
// 4. GOM LINE ENTITIES → Closed Polygon Ring
// ─────────────────────────────────────────────
function lineEntitiesToPolygons(lines, tolerance = 0.5) {
  if (lines.length === 0) return { polygons: [], orphans: [] };

  const used = Array(lines.length).fill(false);
  const polygons = [];
  const orphans = [];

  for (let start = 0; start < lines.length; start++) {
    if (used[start]) continue;

    // Bắt đầu một chain mới
    let chain = [{ x: lines[start].start.x, y: lines[start].start.y }];
    
    // Nếu seg đầu tiên là arc, thêm các điểm trung gian
    if (lines[start]._pts) {
      const midPts = lines[start]._pts.slice(1, -1);
      chain.push(...midPts);
    }
    
    chain.push({ x: lines[start].end.x, y: lines[start].end.y });
    used[start] = true;
    let curEnd = lines[start].end;

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (used[i]) continue;
        const s = lines[i].start, e = lines[i].end;
        const dS = Math.hypot(curEnd.x - s.x, curEnd.y - s.y);
        const dE = Math.hypot(curEnd.x - e.x, curEnd.y - e.y);

        if (dS < tolerance) {
          if (lines[i]._pts) {
             chain.push(...lines[i]._pts.slice(1, -1));
          }
          chain.push({ x: e.x, y: e.y });
          curEnd = e;
          used[i] = true;
          changed = true;
        } else if (dE < tolerance) {
          if (lines[i]._pts) {
             const revMid = [...lines[i]._pts].reverse().slice(1, -1);
             chain.push(...revMid);
          }
          chain.push({ x: s.x, y: s.y });
          curEnd = s;
          used[i] = true;
          changed = true;
        }
      }
    }

    // Kiểm tra khép kín để tạo polygon
    const dClose = Math.hypot(curEnd.x - chain[0].x, curEnd.y - chain[0].y);
    if (dClose < tolerance * 10 && chain.length >= 3) {
      polygons.push(chain);
    } else if (chain.length >= 2) {
      orphans.push(chain);
    }
  }
  return { polygons, orphans };
}

function isClosedPointPath(points, tolerance = 0.5) {
  if (!points || points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) <= tolerance;
}

// ─────────────────────────────────────────────
// 5. PARSE DXF → POLYGON LIST (chính xác)
// ─────────────────────────────────────────────
/**
 * Parse DXF text và trả về mảng Polygon [{x,y}] chính xác từ file DXF
 * Mỗi entity khép kín (LWPOLYLINE closed, SPLINE, v.v.) → 1 polygon
 *
 * @param {string} dxfText
 * @returns {Array<Array<{x,y}>>}
 */
function parseDxfDocument(dxfText) {
  const parser = new DxfParser();
  try {
    return parser.parseSync(dxfText);
  } catch (e) {
    throw new Error(`Lỗi khi đọc file DXF: ${e.message}`);
  }
}

export function parseDxfToPolygons(dxfText) {
  return parseDxfDocumentToPolygonAnalysis(parseDxfDocument(dxfText)).polygons.map(p => p.points);
}

function parseDxfDocumentToPolygons(dxf) {
  return parseDxfDocumentToPolygonAnalysis(dxf).polygons.map(p => p.points);
}

function parseDxfDocumentToPolygonAnalysis(dxf) {
  const polygons = [];
  const lineEntities = [];
  let openContourSegmentCount = 0;

  if (!dxf || !dxf.entities) {
    return {
      polygons,
      analysis: {
        stitchedPolygonCount: 0,
        openContourSegmentCount: 0,
        lineEntityCount: 0
      }
    };
  }

  for (const entity of dxf.entities) {
    let pts = null;

    // ── LWPOLYLINE ─────────────────────────
    if (entity.type === 'LWPOLYLINE') {
      const verts = entity.vertices || [];
      if (verts.length < 2) continue;

      pts = [];
      for (let i = 0; i < verts.length; i++) {
        const cur  = verts[i];
        const next = verts[(i + 1) % verts.length];
        const bulge = cur.bulge || 0;
        const isLast = (i === verts.length - 1);

        // Luôn thêm điểm hiện tại
        pts.push({ x: cur.x, y: cur.y });

        // Nếu không phải điểm cuối (hoặc closed), thêm arc points
        if (!isLast || entity.closed) {
          const arcPts = bulgeToArcPoints(cur.x, cur.y, next.x, next.y, bulge, 48);
          // arcPts giờ chỉ chứa các điểm trung gian, nên push toàn bộ
          for (const p of arcPts) {
            pts.push(p);
          }
        }
      }

      // Nếu closed → bỏ điểm trùng lặp cuối-đầu
      const isClosedShape = entity.closed || isClosedPointPath(pts, 0.5);

      if (isClosedShape && pts.length > 0) {
        const last = pts[pts.length - 1];
        const first = pts[0];
        if (Math.hypot(last.x - first.x, last.y - first.y) < 0.001) {
          pts.pop();
        }
      } else {
        openContourSegmentCount += 1;
        lineEntities.push({
          start: pts[0],
          end: pts[pts.length - 1],
          type: 'polyline',
          _pts: pts
        });
        pts = null;
      }
    }

    // ── POLYLINE + VERTEX ────────────────
    else if (entity.type === 'POLYLINE') {
      const verts = entity.vertices || [];
      if (verts.length < 2) continue;

      pts = [];
      for (let i = 0; i < verts.length; i++) {
        const cur  = verts[i];
        const next = verts[(i + 1) % verts.length];
        const bulge = cur.bulge || 0;
        const isLast = (i === verts.length - 1);

        pts.push({ x: cur.x, y: cur.y });

        if (!isLast || entity.closed) {
          const arcPts = bulgeToArcPoints(cur.x, cur.y, next.x, next.y, bulge, 48);
          for (const p of arcPts) {
            pts.push(p);
          }
        }
      }

      const isClosedShape = entity.closed || isClosedPointPath(pts, 0.5);
      if (isClosedShape && pts.length > 0) {
        const last = pts[pts.length - 1];
        const first = pts[0];
        if (Math.hypot(last.x - first.x, last.y - first.y) < 0.001) {
          pts.pop();
        }
      } else {
        openContourSegmentCount += 1;
        lineEntities.push({
          start: pts[0],
          end: pts[pts.length - 1],
          type: 'polyline',
          _pts: pts
        });
        pts = null;
      }
    }

    // ── SPLINE ────────────────────────────
    else if (entity.type === 'SPLINE') {
      const cps = (entity.controlPoints || []).map(v => ({ x: v.x, y: v.y }));
      const fps = (entity.fitPoints   || []).map(v => ({ x: v.x, y: v.y }));
      
      // Nếu spline có Control Points, dùng nội suy B-Spline tiêu chuẩn
      if (cps.length >= 2) {
        const degree = entity.degreeOfSplineCurve || 3;
        const knots  = entity.knotValues || null;
        pts = splineToPoints(cps, degree, knots, Math.max(32, cps.length * 4));
      } 
      // Nếu chỉ có Fit Points (rất hay gặp khi user vẽ Spline tự do), đa phần là điểm đi qua sát viền
      else if (fps.length >= 2) {
        pts = fps;
      } 
      else {
        continue;
      }
    }

    // ── ARC ────────────────────────────────
    else if (entity.type === 'ARC') {
      if (entity.center) {
        // ARC là đường hở → chỉ dùng khi không có entity khác hoặc cần gom
        pts = arcToPoints(
          entity.center.x, entity.center.y, entity.radius,
          entity.startAngle, entity.endAngle, 72
        );
        // Không close arc thành polygon riêng → cộng vào line pool
        lineEntities.push({
          start: pts[0],
          end:   pts[pts.length - 1],
          type: 'arc',
          _pts: pts
        });
        pts = null; // Không tạo polygon trực tiếp
      }
    }

    // ── CIRCLE ─────────────────────────────
    else if (entity.type === 'CIRCLE') {
      if (entity.center) {
        pts = arcToPoints(entity.center.x, entity.center.y, entity.radius, 0, 360, 120);
      }
    }

    // ── LINE ──────────────────────────────
    else if (entity.type === 'LINE') {
      if (entity.start && entity.end) {
        lineEntities.push({
          start: { x: entity.start.x, y: entity.start.y },
          end:   { x: entity.end.x,   y: entity.end.y   }
        });
      } else if (entity.vertices && entity.vertices.length >= 2) {
        lineEntities.push({
          start: { x: entity.vertices[0].x, y: entity.vertices[0].y },
          end:   { x: entity.vertices[1].x, y: entity.vertices[1].y }
        });
      }
    }

    // Nếu có pts hợp lệ và đủ điểm → thêm vào polygon list
    if (pts && pts.length >= 3) {
      // Lọc bỏ các điểm liên tiếp trùng nhau (gây lỗi nét vẽ stroke dày)
      const cleanPts = [];
      for (const p of pts) {
        if (cleanPts.length === 0) {
          cleanPts.push(p);
        } else {
          const lastP = cleanPts[cleanPts.length - 1];
          if (Math.hypot(p.x - lastP.x, p.y - lastP.y) > 1e-4) {
            cleanPts.push(p);
          }
        }
      }
      // Kiểm tra điểm cuối và điểm đầu
      if (cleanPts.length >= 3) {
        const first = cleanPts[0];
        const last = cleanPts[cleanPts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
          cleanPts.pop();
        }
      }

      if (cleanPts.length >= 3) {
        polygons.push(cleanPts.map(p => ({ x: p.x, y: p.y })));
      }
    }
  }

  // Gom LINE entities thành polygon vòng khép kín (nếu có)
  let stitchedPolygonCount = 0;
  let orphans = [];
  if (lineEntities.length >= 3) {
    const res = lineEntitiesToPolygons(lineEntities, 0.5);
    stitchedPolygonCount = res.polygons.length;
    polygons.push(...res.polygons);
    orphans = res.orphans;
  }

  // Chuyển polygons sang structure mới: { points, internals }
  const finalPolygons = polygons.map(poly => ({
    points: poly.map(p => ({ x: p.x, y: -p.y })),
    internals: []
  }));

  // Xử lý orphans: nếu trung điểm của orphan nằm trong polygon nào đó thì coi là đường line bên trong
  for (const orphan of orphans) {
    if (orphan.length < 2) continue;
    const flippedOrphan = orphan.map(p => ({ x: p.x, y: -p.y }));
    const midPoint = {
      x: (flippedOrphan[0].x + flippedOrphan[flippedOrphan.length - 1].x) / 2,
      y: (flippedOrphan[0].y + flippedOrphan[flippedOrphan.length - 1].y) / 2
    };

    for (const polyObj of finalPolygons) {
      if (pointInPolygon(midPoint, polyObj.points)) {
        polyObj.internals.push(flippedOrphan);
        break;
      }
    }
  }

  // Post-process: simplify, normalize, round cho cả points và internals
  return {
    polygons: finalPolygons.map(polyObj => {
      const simplifiedPoints = simplifyPolygon(polyObj.points, 0.25);
      const bb = getBoundingBox(simplifiedPoints);
      const normalizedPoints = translate(simplifiedPoints, -bb.minX, -bb.minY);
      
      const normalizedInternals = polyObj.internals.map(path => {
        const simplifiedPath = simplifyPolygon(path, 0.25);
        return translate(simplifiedPath, -bb.minX, -bb.minY);
      });

      return {
        points: roundPolygon(normalizedPoints, 4),
        internals: normalizedInternals.map(path => roundPolygon(path, 4))
      };
    }),
    analysis: {
      stitchedPolygonCount,
      openContourSegmentCount,
      lineEntityCount: lineEntities.length
    }
  };
}

// ─────────────────────────────────────────────
// 6. GÁN SIZE TỰ ĐỘNG
// ─────────────────────────────────────────────
export async function parseCadBufferToPolygons(buffer, fileName = 'drawing.dxf') {
  const dxfText = buffer.toString('utf-8');
  const polygonAnalysis = parseDxfDocumentToPolygonAnalysis(parseDxfDocument(dxfText));
  return filterLikelyAuxiliaryPolygons(polygonAnalysis.polygons);
}

/**
 * Gán size tự động cho danh sách polygon
 * Sắp xếp từ polygon có diện tích nhỏ nhất → lớn nhất → gán size tăng dần
 *
 * @param {Array<Array<{x,y}>>} polygons
 * @param {number} startSize
 * @param {number} stepSize
 * @returns {Array<{sizeName, sizeValue, polygon, boundingBox, area, pointCount}>}
 */
function extractDetectedSizeLabelsFromDxf(dxf) {
  const uniqueLabels = new Map();

  for (const entity of dxf.entities || []) {
    if (entity.type !== 'TEXT' && entity.type !== 'MTEXT') continue;

    const rawText = String(entity.text || entity.string || entity.plainText || '')
      .replace(/\\P/g, ' ')
      .replace(/\\[A-Za-z][^;]*;/g, ' ')
      .replace(/,/g, '.')
      .trim();

    if (!/^\d+(?:\.\d+)?$/.test(rawText)) continue;

    const sizeValue = Number.parseFloat(rawText);
    if (!Number.isFinite(sizeValue) || sizeValue < 3 || sizeValue > 20) continue;

    const key = String(sizeValue);
    if (!uniqueLabels.has(key)) {
      uniqueLabels.set(key, {
        sizeName: Number.isInteger(sizeValue) ? String(sizeValue) : rawText.replace(/\.0+$/, ''),
        sizeValue
      });
    }
  }

  return [...uniqueLabels.values()].sort((a, b) => a.sizeValue - b.sizeValue);
}

function assignSizesWithDetectedLabels(polygons, detectedLabels, startSize = 3.5, stepSize = 0.5) {
  if (!Array.isArray(detectedLabels) || detectedLabels.length !== polygons.length) {
    return assignSizesToPolygons(polygons, startSize, stepSize);
  }

  const sortedPolygons = [...polygons].sort((a, b) => area(a.points) - area(b.points));

  return sortedPolygons.map((p, index) => {
    const detected = detectedLabels[index];
    const bb = getBoundingBox(p.points);

    return {
      sizeName: detected.sizeName,
      sizeValue: detected.sizeValue,
      polygon: p.points,
      internals: p.internals,
      boundingBox: {
        width: parseFloat(bb.width.toFixed(2)),
        height: parseFloat(bb.height.toFixed(2))
      },
      area: parseFloat(area(p.points).toFixed(2)),
      pointCount: p.points.length
    };
  });
}

function getPolygonBoundingMetrics(polygon) {
  const bb = getBoundingBox(polygon);
  return {
    width: bb.width,
    height: bb.height,
    area: area(polygon)
  };
}

function isLikelyAuxiliaryMarker(metrics) {
  return metrics.area <= 100 && metrics.width <= 10 && metrics.height <= 10;
}

function isLikelyMainPiece(metrics) {
  return metrics.area >= 1000 || Math.max(metrics.width, metrics.height) >= 30;
}

function filterLikelyAuxiliaryPolygons(polygons) {
  const validPolygons = Array.isArray(polygons)
    ? polygons.filter((p) => p && p.points && p.points.length >= 3)
    : [];

  if (validPolygons.length <= 1) return validPolygons;

  const descriptors = validPolygons.map((p) => ({
    p,
    ...getPolygonBoundingMetrics(p.points)
  }));
  const auxiliaryCount = descriptors.filter((item) => isLikelyAuxiliaryMarker(item)).length;
  const mainPieceCount = descriptors.filter((item) => isLikelyMainPiece(item)).length;

  if (!auxiliaryCount || mainPieceCount < 3) {
    return validPolygons;
  }

  return descriptors
    .filter((item) => !isLikelyAuxiliaryMarker(item))
    .map((item) => item.p);
}

function normalizeDetectionText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function detectDoubleInsoleDoubleContourFile(fileName = '') {
  const normalizedFileName = normalizeDetectionText(fileName);
  const baseName = path.basename(normalizedFileName);

  const isInsidePreparedFolder = /(^|\/)(ghep san|ghep-san|ghep_san|prepaired|pre-paired|double contour|double-contour)(\/|$)/.test(normalizedFileName);
  const hasDoubleContourToken = /(^|[^a-z0-9])dc([^a-z0-9]|$)/.test(baseName);
  const hasPreparedNamingHint =
    baseName.includes('double contour') ||
    baseName.includes('dinh dang luxin') ||
    baseName.includes('dao go luxin') ||
    baseName.includes('daogoluxin');

  return isInsidePreparedFolder || (hasDoubleContourToken && hasPreparedNamingHint);
}

function buildCadImportAnalysis(polygons, detectedLabels, polygonAnalysis, fileName = '') {
  const stitchedPolygonCount = polygonAnalysis?.analysis?.stitchedPolygonCount || 0;
  const openContourSegmentCount = polygonAnalysis?.analysis?.openContourSegmentCount || 0;
  const detectedLabelCount = Array.isArray(detectedLabels) ? detectedLabels.length : 0;
  const polygonCount = Array.isArray(polygons) ? polygons.length : 0;
  const isDoubleInsoleDoubleContour =
    polygonCount > 0 &&
    detectDoubleInsoleDoubleContourFile(fileName);

  return {
    polygonCount,
    detectedLabelCount,
    stitchedPolygonCount,
    openContourSegmentCount,
    recommendation: isDoubleInsoleDoubleContour
      ? {
          kind: 'double-insole-double-contour',
          autoApply: true,
          title: 'Đã nhận diện file ghép sẵn',
          modeLabel: 'Tối ưu cho file ghép sẵn',
          pairingStrategy: 'same-side',
          capacityLayoutMode: 'same-side-double-contour',
          reason:
            'File ghép sẵn sẽ tự động dùng layout tối ưu, không cần chọn mode thủ công.'
        }
      : {
          kind: 'single-insole-standard',
          autoApply: false,
          title: 'Đã nhận diện file thường',
          modeLabel: 'Tối ưu cho file thường',
          pairingStrategy: 'pair',
          capacityLayoutMode: 'pair-complementary',
          reason:
            'File thường sẽ tự động dùng layout tối ưu, không cần chọn mode thủ công.'
        }
  };
}

export async function parseCadBufferToSizedShapesWithAnalysis(
  buffer,
  fileName = 'drawing.dxf',
  startSize = 3.5,
  stepSize = 0.5
) {
  const dxfText = buffer.toString('utf-8');

  const dxf = parseDxfDocument(dxfText);
  const polygonAnalysis = parseDxfDocumentToPolygonAnalysis(dxf);
  const filteredPolygons = filterLikelyAuxiliaryPolygons(polygonAnalysis.polygons);
  const detectedLabels = extractDetectedSizeLabelsFromDxf(dxf);
  const shapes = assignSizesWithDetectedLabels(
    filteredPolygons,
    detectedLabels,
    startSize,
    stepSize
  );

  return {
    shapes,
    importAnalysis: buildCadImportAnalysis(
      filteredPolygons,
      detectedLabels,
      polygonAnalysis,
      fileName
    )
  };
}

export async function parseCadBufferToSizedShapes(
  buffer,
  fileName = 'drawing.dxf',
  startSize = 3.5,
  stepSize = 0.5
) {
  const result = await parseCadBufferToSizedShapesWithAnalysis(
    buffer,
    fileName,
    startSize,
    stepSize
  );
  return result.shapes;
}

export function assignSizesToPolygons(polygons, startSize = 3.5, stepSize = 0.5) {
  // Lọc bỏ polygon rỗng
  const valid = polygons.filter(p => p && p.points && p.points.length >= 3);

  // Sort theo diện tích từ nhỏ đến lớn
  const sorted = [...valid].sort((a, b) => area(a.points) - area(b.points));

  return sorted.map((p, index) => {
    const sizeValue = startSize + index * stepSize;
    const sizeName  = sizeValue.toFixed(1);
    const bb = getBoundingBox(p.points);

    return {
      sizeName,
      sizeValue,
      polygon: p.points,
      internals: p.internals,
      boundingBox: {
        width:  parseFloat(bb.width.toFixed(2)),
        height: parseFloat(bb.height.toFixed(2))
      },
      area:       parseFloat(area(p.points).toFixed(2)),
      pointCount: p.points.length
    };
  });
}
