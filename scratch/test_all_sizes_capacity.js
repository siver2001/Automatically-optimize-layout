import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

// --- Copied from frontend DieCutNestingBoard.js ---
function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)
    return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    ),
  );
  const px = a.x + t * dx,
    py = a.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

function orientation(a, b, c) {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, c.x) - 1e-9 <= b.x &&
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    Math.min(a.y, c.y) - 1e-9 <= b.y &&
    b.y <= Math.max(a.y, c.y) + 1e-9
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1),
    o2 = orientation(a1, a2, b2),
    o3 = orientation(b1, b2, a1),
    o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y,
      xj = polygon[j].x,
      yj = polygon[j].y;
    const hit =
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function getPolygonBounds(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function parseRelativeSvgPath(pathData) {
  if (!pathData || typeof pathData !== "string") return [];
  const matches = [
    ...pathData.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
  ];
  return matches.map((match) => ({
    x: Number.parseFloat(match[1]),
    y: Number.parseFloat(match[2]),
  }));
}

function translatePolygon(points = [], offsetX = 0, offsetY = 0) {
  return points.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY,
  }));
}

function resolvePlacedItemPolygon(item = {}, templates = {}) {
  if (Array.isArray(item?.polygon) && item.polygon.length > 0) {
    return item.polygon;
  }
  const template = item?.renderKey ? templates[item.renderKey] : null;
  const relativePolygon = parseRelativeSvgPath(template?.path || item?.renderPath);
  if (!relativePolygon.length) return [];
  return translatePolygon(relativePolygon, item?.x || 0, item?.y || 0);
}

// Fixed version of polygonDistance
function polygonDistanceFixed(a = [], b = []) {
  if (!a.length || !b.length) return 1 / 0;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i],
      a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j],
        b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
    }
  }
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let min = 1 / 0;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i],
      a2 = a[(i + 1) % a.length];
    for (const pt of b) min = Math.min(min, pointToSegmentDistance(pt, a1, a2));
  }
  for (let i = 0; i < b.length; i++) {
    const b1 = b[i],
      b2 = b[(i + 1) % b.length]; // Correct loop index 'i'
    for (const pt of a) min = Math.min(min, pointToSegmentDistance(pt, b1, b2));
  }
  return min;
}

function buildSheetValidation(sheet, spacing, tolerance = 1e-6) {
  const invalid = new Set();
  const rawItems = sheet?.placed || [];
  const templates = sheet?.renderTemplates || {};
  
  const items = rawItems.map(item => ({
    ...item,
    polygon: resolvePlacedItemPolygon(item, templates)
  }));
  
  const gap = Math.max(0, Number(spacing) || 0);
  const boundsMap = new Map(
    items.map((i) => [i.id, getPolygonBounds(i.polygon || [])]),
  );
  
  for (const item of items) {
    const b = boundsMap.get(item.id);
    if (!b) continue;
    if (
      b.minX < -1e-6 ||
      b.minY < -1e-6 ||
      b.maxX > (sheet.sheetWidth || 0) + 1e-6 ||
      b.maxY > (sheet.sheetHeight || 0) + 1e-6
    )
      invalid.add(item.id);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const aa = items[i],
        bb = items[j],
        ab = boundsMap.get(aa.id),
        bb2 = boundsMap.get(bb.id);
      if (!ab || !bb2) continue;
      if (
        ab.maxX + gap <= bb2.minX ||
        bb2.maxX + gap <= ab.minX ||
        ab.maxY + gap <= bb2.minY ||
        bb2.maxY + gap <= ab.minY
      )
        continue;
      
      if (polygonDistanceFixed(aa.polygon || [], bb.polygon || []) + tolerance < gap) {
        invalid.add(aa.id);
        invalid.add(bb.id);
      }
    }
  }
  return { invalidItemIds: invalid, invalidCount: invalid.size };
}

// Parse baseline capacity_results.txt
function parseBaselineResults() {
  const baseline = {};
  const content = fs.readFileSync('capacity_results.txt', 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/Size:\s*([\d\.]+)\s*\|\s*Pairs:\s*([\d\.]+)/);
    if (match) {
      baseline[match[1]] = parseFloat(match[2]);
    }
  }
  return baseline;
}

async function run() {
  const baseline = parseBaselineResults();
  console.log('Baseline results parsed:', baseline);

  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const sortedSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`\nStarting nesting and validation for all ${sortedSizes.length} sizes...`);

  // Run capacity test for all sizes sequentially to bypass parallel cache interference
  const res = await engine.testCapacity(sortedSizes, { ...config, parallelSizes: false });

  console.log('\n-----------------------------------------------------------------------------------------------');
  console.log('| Size | Baseline Pairs | New Pairs | Diff | Old Error (1e-6) | New Error (0.02) | Result |');
  console.log('-----------------------------------------------------------------------------------------------');

  let failedCount = 0;
  let totalOriginalPairs = 0;
  let totalNewPairs = 0;

  for (const sizeInfo of sortedSizes) {
    const sizeName = sizeInfo.sizeName;
    const sheet = res.sheetsBySize[sizeName];
    
    // Calculate new pairs based on actual placed count
    // For double contour, placedCount = number of pieces. Pairs = placedCount / 2
    const placedCount = sheet?.placedCount ?? sheet?.placed?.length ?? 0;
    const newPairs = placedCount / 2;

    const basePairs = baseline[sizeName] || 0;
    const diff = newPairs - basePairs;

    totalOriginalPairs += basePairs;
    totalNewPairs += newPairs;

    // Simulate compacting by stripping polygon property
    const compactSheet = {
      ...sheet,
      placed: (sheet?.placed || []).map(item => {
        const { polygon, ...rest } = item;
        return rest;
      })
    };

    // Validate with old tolerance 1e-6
    const valOld = buildSheetValidation(compactSheet, config.spacing, 1e-6);
    // Validate with new tolerance 0.02
    const valNew = buildSheetValidation(compactSheet, config.spacing, 0.02);

    let resultStatus = 'PASS';
    if (diff < 0) {
      resultStatus = 'FAIL_QTY_REDUCED';
      failedCount++;
    } else if (valNew.invalidCount > 0) {
      resultStatus = 'FAIL_OVERLAP';
      failedCount++;
    }

    console.log(
      `| ${sizeName.padEnd(4)} | ` +
      `${String(basePairs).padEnd(14)} | ` +
      `${String(newPairs).padEnd(9)} | ` +
      `${(diff >= 0 ? '+' : '') + diff}`.padEnd(4) + ' | ' +
      `${valOld.invalidCount}`.padEnd(16) + ' | ' +
      `${valNew.invalidCount}`.padEnd(16) + ' | ' +
      `${resultStatus.padEnd(16)} |`
    );
  }
  
  console.log('-----------------------------------------------------------------------------------------------');
  console.log(`Total Baseline Pairs: ${totalOriginalPairs}`);
  console.log(`Total New Pairs: ${totalNewPairs}`);
  console.log(`Total fails: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\n[VERIFICATION FAILED] One or more sizes failed validation or saw a reduction in pairs.');
    process.exit(1);
  } else {
    console.log('\n[VERIFICATION PASSED] All sizes passed! No reductions in quantity and zero overlap warnings.');
  }
}

run().catch(console.error);
