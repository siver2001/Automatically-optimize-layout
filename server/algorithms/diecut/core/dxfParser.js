import DxfParser from 'dxf-parser';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {
  getBoundingBox,
  area,
  normalizeToOrigin,
  roundPolygon,
  simplifyPolygon
} from './polygonUtils.js';

const execFileAsync = promisify(execFile);
const DEFAULT_ODA_PATHS = [
  process.env.ODA_FILE_CONVERTER_PATH,
  'C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe',
  'C:\\Program Files\\Open Design Alliance\\ODAFileConverter\\ODAFileConverter.exe'
].filter(Boolean);

async function resolveOdaFileConverterPath() {
  for (const candidate of DEFAULT_ODA_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep checking known install locations.
    }
  }
  return null;
}

async function convertDwgBufferToDxfText(buffer, fileName = 'drawing.dwg') {
  const converterPath = await resolveOdaFileConverterPath();
  if (!converterPath) {
    throw new Error(
      'Chưa tìm thấy ODA File Converter. Cài ODA File Converter hoặc set ODA_FILE_CONVERTER_PATH để đọc file DWG.'
    );
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'diecut-dwg-'));
  const inputDir = path.join(tempRoot, 'input');
  const outputDir = path.join(tempRoot, 'output');
  const inputName = path.basename(fileName, path.extname(fileName) || '.dwg') + '.dwg';
  const inputPath = path.join(inputDir, inputName);
  const outputPath = path.join(outputDir, inputName.replace(/\.dwg$/i, '.dxf'));

  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(inputPath, buffer);

    await execFileAsync(
      converterPath,
      [inputDir, outputDir, 'ACAD2018', 'DXF', '0', '1', '*.DWG'],
      { windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );

    await fs.access(outputPath);
    return await fs.readFile(outputPath, 'utf8');
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    const stdout = error?.stdout?.toString?.().trim();
    const details = stderr || stdout || error.message;
    throw new Error(`Không thể chuyển file DWG sang DXF: ${details}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**

 * @param {number} x1, 
 * @param {number} x2, 
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

  // 1. GÃ³c quÃ©t cá»§a cung (sweep = 4 * atan(bulge)), theta = giÃ¡ trá»‹ tuyá»‡t Ä‘á»‘i
  const sweep = 4 * Math.atan(bulge);
  const theta = Math.abs(sweep);

  // 2. BÃ¡n kÃ­nh
  const r = chord / (2 * Math.sin(theta / 2));

  // 3. GÃ³c cá»§a Ä‘Æ°á»ng tháº³ng ná»‘i p1 -> p2 (chord angle)
  const alpha = Math.atan2(dy, dx);

  // 4. GÃ³c Ä‘Æ°á»ng ná»‘i tá»« p1 Ä‘áº¿n tÃ¢m C
  const angle_p1_C = alpha + Math.sign(bulge) * (Math.PI / 2 - theta / 2);

  // 5. Tá»a Ä‘á»™ tÃ¢m
  const cx = x1 + r * Math.cos(angle_p1_C);
  const cy = y1 + r * Math.sin(angle_p1_C);

  // 6. GÃ³c xuáº¥t phÃ¡t tá»« tÃ¢m Ä‘áº¿n p1
  const startAngle = Math.atan2(y1 - cy, x1 - cx);

  // TÃ­nh chu vi cung thá»±c táº¿ Ä‘á»ƒ linh hoáº¡t sá»‘ Ä‘iá»ƒm
  const arcLength = r * theta;
  // Cá»© khoáº£ng 0.5mm Ä‘áº¿n 1.0mm thÃ¬ láº¥y 1 Ä‘iá»ƒm Ä‘á»ƒ trÃ¡nh quÃ¡ dÃ y Ä‘áº·c gÃ¢y "rÄƒng cÆ°a" áº£o
  const dynamicSegments = Math.max(2, Math.min(96, Math.ceil(arcLength / 0.5)));

  // 7. Rá»i ráº¡c hÃ³a cung trÃ²n (CHá»ˆ Láº¤Y ÄIá»‚M TRUNG GIAN)
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

  // Náº¿u khÃ´ng cÃ³ knot vector â†’ táº¡o uniform knot
  if (!knots || knots.length < n + degree + 1) {
    knots = [];
    const totalKnots = n + degree + 1;
    for (let i = 0; i < totalKnots; i++) {
      if (i <= degree) knots.push(0);
      else if (i >= totalKnots - degree - 1) knots.push(1);
      else knots.push((i - degree) / (n - degree));
    }
  } else {
    // Normalize knots vá» [0,1]
    const kMin = knots[0], kMax = knots[knots.length - 1];
    const kRange = kMax - kMin || 1;
    knots = knots.map(k => (k - kMin) / kRange);
  }

  function deBoor(t) {
    // TÃ¬m knot span
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 3. ARC â†’ Points
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. GOM LINE ENTITIES â†’ Closed Polygon Ring
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function lineEntitiesToPolygons(lines, tolerance = 0.5) {
  if (lines.length === 0) return [];

  const used = Array(lines.length).fill(false);
  const polygons = [];

  for (let start = 0; start < lines.length; start++) {
    if (used[start]) continue;

    // Bắt đầu một chain mới
    let chain = [{ x: lines[start].start.x, y: lines[start].start.y }];
    
    // Nếu seg đầu tiên là arc, thêm các điểm trung gian (pts của arcToPoints bao gồm cả đầu cuối, nên dùng slice)
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
          // Khớp điểm đầu: s -> (mid) -> e
          if (lines[i]._pts) {
             chain.push(...lines[i]._pts.slice(1, -1));
          }
          chain.push({ x: e.x, y: e.y });
          curEnd = e;
          used[i] = true;
          changed = true;
        } else if (dE < tolerance) {
          // Khớp điểm cuối: e -> (mid reversed) -> s
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
    }
  }
  return polygons;
}

function isClosedPointPath(points, tolerance = 0.5) {
  if (!points || points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) <= tolerance;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 5. PARSE DXF â†’ POLYGON LIST (chÃ­nh xÃ¡c)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Parse DXF text vÃ  tráº£ vá» máº£ng Polygon [{x,y}] chÃ­nh xÃ¡c tá»« file DXF
 * Má»—i entity khÃ©p kÃ­n (LWPOLYLINE closed, SPLINE, v.v.) â†’ 1 polygon
 *
 * @param {string} dxfText
 * @returns {Array<Array<{x,y}>>}
 */
function parseDxfDocument(dxfText) {
  const parser = new DxfParser();
  try {
    return parser.parseSync(dxfText);
  } catch (e) {
    throw new Error(`Lá»—i khi Ä‘á»c file DXF: ${e.message}`);
  }
}

export function parseDxfToPolygons(dxfText) {
  return parseDxfDocumentToPolygonAnalysis(parseDxfDocument(dxfText)).polygons;
}

function parseDxfDocumentToPolygons(dxf) {
  return parseDxfDocumentToPolygonAnalysis(dxf).polygons;
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

    // â”€â”€ LWPOLYLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (entity.type === 'LWPOLYLINE') {
      const verts = entity.vertices || [];
      if (verts.length < 2) continue;

      pts = [];
      for (let i = 0; i < verts.length; i++) {
        const cur  = verts[i];
        const next = verts[(i + 1) % verts.length];
        const bulge = cur.bulge || 0;
        const isLast = (i === verts.length - 1);

        // LuÃ´n thÃªm Ä‘iá»ƒm hiá»‡n táº¡i
        pts.push({ x: cur.x, y: cur.y });

        // Náº¿u khÃ´ng pháº£i Ä‘iá»ƒm cuá»‘i (hoáº·c closed), thÃªm arc points
        if (!isLast || entity.closed) {
          const arcPts = bulgeToArcPoints(cur.x, cur.y, next.x, next.y, bulge, 48);
          // arcPts giá» chá»‰ chá»©a cÃ¡c Ä‘iá»ƒm trung gian, nÃªn push toÃ n bá»™
          for (const p of arcPts) {
            pts.push(p);
          }
        }
      }

      // Náº¿u closed â†’ bá» Ä‘iá»ƒm trÃ¹ng láº·p cuá»‘i-Ä‘áº§u
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

    // â”€â”€ POLYLINE + VERTEX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ SPLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (entity.type === 'SPLINE') {
      const cps = (entity.controlPoints || []).map(v => ({ x: v.x, y: v.y }));
      const fps = (entity.fitPoints   || []).map(v => ({ x: v.x, y: v.y }));
      
      // Náº¿u spline cÃ³ Control Points, dÃ¹ng ná»™i suy B-Spline tiÃªu chuáº©n
      if (cps.length >= 2) {
        const degree = entity.degreeOfSplineCurve || 3;
        const knots  = entity.knotValues || null;
        pts = splineToPoints(cps, degree, knots, Math.max(32, cps.length * 4));
      } 
      // Náº¿u chá»‰ cÃ³ Fit Points (ráº¥t hay gáº·p khi user váº½ Spline tá»± do), Ä‘a pháº§n lÃ  Ä‘iá»ƒm Ä‘i qua sÃ¡t viá»n
      else if (fps.length >= 2) {
        pts = fps;
      } 
      else {
        continue;
      }
    }

    // â”€â”€ ARC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (entity.type === 'ARC') {
      if (entity.center) {
        // ARC lÃ  Ä‘Æ°á»ng há»Ÿ â†’ chá»‰ dÃ¹ng khi khÃ´ng cÃ³ entity khÃ¡c hoáº·c cáº§n gom
        pts = arcToPoints(
          entity.center.x, entity.center.y, entity.radius,
          entity.startAngle, entity.endAngle, 72
        );
        // KhÃ´ng close arc thÃ nh polygon riÃªng â†’ cá»™ng vÃ o line pool
        lineEntities.push({
          start: pts[0],
          end:   pts[pts.length - 1],
          type: 'arc',
          _pts: pts
        });
        pts = null; // KhÃ´ng táº¡o polygon trá»±c tiáº¿p
      }
    }

    // â”€â”€ CIRCLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (entity.type === 'CIRCLE') {
      if (entity.center) {
        pts = arcToPoints(entity.center.x, entity.center.y, entity.radius, 0, 360, 120);
      }
    }

    // â”€â”€ LINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Náº¿u cÃ³ pts há»£p lá»‡ vÃ  Ä‘á»§ Ä‘iá»ƒm â†’ thÃªm vÃ o polygon list
    if (pts && pts.length >= 3) {
      // Lá»c bá» cÃ¡c Ä‘iá»ƒm liÃªn tiáº¿p trÃ¹ng nhau (gÃ¢y lá»—i nÃ©t váº½ stroke dÃ y)
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
  if (lineEntities.length >= 3) {
    const linePolys = lineEntitiesToPolygons(lineEntities, 0.5);
    stitchedPolygonCount = linePolys.length;
    polygons.push(...linePolys);
  }

  // Post-process: flip y, simplify, normalize, round
  return {
    polygons: polygons
    .map(poly => poly.map(p => ({ x: p.x, y: -p.y })))   // flip Y
    .map(poly => simplifyPolygon(poly, 0.25))            // Ngưỡng 0.25mm nén số điểm li ti nhưng ko ảnh hưởng nesting (vì lưới check >= 1mm)
    .map(poly => roundPolygon(normalizeToOrigin(poly), 4)),
    analysis: {
      stitchedPolygonCount,
      openContourSegmentCount,
      lineEntityCount: lineEntities.length
    }
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 6. GÃN SIZE Tá»° Äá»˜NG
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function parseCadBufferToPolygons(buffer, fileName = 'drawing.dxf') {
  const extension = path.extname(fileName).toLowerCase();
  const dxfText = extension === '.dwg'
    ? await convertDwgBufferToDxfText(buffer, fileName)
    : buffer.toString('utf-8');
  const polygonAnalysis = parseDxfDocumentToPolygonAnalysis(parseDxfDocument(dxfText));
  return filterLikelyAuxiliaryPolygons(polygonAnalysis.polygons);
}

/**
 * GÃ¡n size tá»± Ä‘á»™ng cho danh sÃ¡ch polygon
 * Sáº¯p xáº¿p tá»« polygon cÃ³ diá»‡n tÃ­ch nhá» nháº¥t â†’ lá»›n nháº¥t â†’ gÃ¡n size tÄƒng dáº§n
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

  const sortedPolygons = [...polygons].sort((a, b) => area(a) - area(b));

  return sortedPolygons.map((polygon, index) => {
    const detected = detectedLabels[index];
    const bb = getBoundingBox(polygon);

    return {
      sizeName: detected.sizeName,
      sizeValue: detected.sizeValue,
      polygon,
      boundingBox: {
        width: parseFloat(bb.width.toFixed(2)),
        height: parseFloat(bb.height.toFixed(2))
      },
      area: parseFloat(area(polygon).toFixed(2)),
      pointCount: polygon.length
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
    ? polygons.filter((polygon) => Array.isArray(polygon) && polygon.length >= 3)
    : [];

  if (validPolygons.length <= 1) return validPolygons;

  const descriptors = validPolygons.map((polygon) => ({
    polygon,
    ...getPolygonBoundingMetrics(polygon)
  }));
  const auxiliaryCount = descriptors.filter((item) => isLikelyAuxiliaryMarker(item)).length;
  const mainPieceCount = descriptors.filter((item) => isLikelyMainPiece(item)).length;

  if (!auxiliaryCount || mainPieceCount < 3) {
    return validPolygons;
  }

  return descriptors
    .filter((item) => !isLikelyAuxiliaryMarker(item))
    .map((item) => item.polygon);
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
  const extension = path.extname(fileName).toLowerCase();
  const dxfText = extension === '.dwg'
    ? await convertDwgBufferToDxfText(buffer, fileName)
    : buffer.toString('utf-8');

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
  // Lá»c bá» polygon rá»—ng
  const valid = polygons.filter(p => p && p.length >= 3);

  // Sort theo diá»‡n tÃ­ch tá»« nhá» Ä‘áº¿n lá»›n
  const sorted = [...valid].sort((a, b) => area(a) - area(b));

  return sorted.map((polygon, index) => {
    const sizeValue = startSize + index * stepSize;
    const sizeName  = sizeValue.toFixed(1);
    const bb = getBoundingBox(polygon);

    return {
      sizeName,
      sizeValue,
      polygon,
      boundingBox: {
        width:  parseFloat(bb.width.toFixed(2)),
        height: parseFloat(bb.height.toFixed(2))
      },
      area:       parseFloat(area(polygon).toFixed(2)),
      pointCount: polygon.length
    };
  });
}

