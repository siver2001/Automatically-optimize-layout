import polygonClipping from 'polygon-clipping';
import {
  getBoundingBox,
  normalizeToOrigin,
  area as polygonArea,
  translate
} from '../../core/polygonUtils.js';
import { roundMetric } from './patternCapacityUtils.js';

function toClipRing(points = []) {
  return points.map((point) => [point.x, point.y]);
}

function fromClipRing(ring = []) {
  if (!Array.isArray(ring) || !ring.length) return [];
  const points = ring.map(([x, y]) => ({ x, y }));
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) <= 1e-6 && Math.abs(first.y - last.y) <= 1e-6) {
      points.pop();
    }
  }
  return points;
}

function getLargestClipResultPolygon(result = []) {
  let bestPolygon = null;
  let bestArea = 0;

  for (const polygon of result || []) {
    for (const ring of polygon || []) {
      const points = fromClipRing(ring);
      const ringArea = polygonArea(points);
      if (ringArea > bestArea) {
        bestArea = ringArea;
        bestPolygon = points;
      }
    }
  }

  return bestPolygon;
}

function buildHorizontalIntervalsAtY(polygon, y) {
  const intersections = [];
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const crosses = (current.y <= y && next.y > y) || (next.y <= y && current.y > y);
    if (!crosses) continue;
    const ratio = (y - current.y) / (next.y - current.y);
    intersections.push(current.x + ratio * (next.x - current.x));
  }

  intersections.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]]);
  }
  return intervals;
}

function buildDividerFromInternalGaps(polygon) {
  const bounds = getBoundingBox(polygon);
  const points = [];

  for (let stepIndex = 1; stepIndex <= 24; stepIndex++) {
    const ratio = stepIndex / 25;
    const y = bounds.minY + bounds.height * ratio;
    const intervals = buildHorizontalIntervalsAtY(polygon, y);
    if (intervals.length < 2) continue;

    let widestGap = null;
    for (let index = 0; index + 1 < intervals.length; index++) {
      const gapStart = intervals[index][1];
      const gapEnd = intervals[index + 1][0];
      const gapWidth = gapEnd - gapStart;
      if (gapWidth <= 0.5) continue;
      if (!widestGap || gapWidth > widestGap.gapWidth) {
        widestGap = { gapStart, gapEnd, gapWidth };
      }
    }

    if (!widestGap) continue;
    points.push({
      x: roundMetric((widestGap.gapStart + widestGap.gapEnd) / 2, 4),
      y: roundMetric(y, 4)
    });
  }

  if (points.length < 4) return null;

  const pad = Math.max(10, Math.max(bounds.width, bounds.height) * 0.05);
  return [
    { x: points[0].x, y: roundMetric(bounds.minY - pad, 4) },
    ...points,
    { x: points[points.length - 1].x, y: roundMetric(bounds.maxY + pad, 4) }
  ];
}

function buildDividerFromInternalPath(polygon, internalPath = []) {
  if (!Array.isArray(internalPath) || internalPath.length < 2) return null;

  const bounds = getBoundingBox(polygon);
  const sortedPoints = [...internalPath]
    .map((point) => ({
      x: roundMetric(point.x, 4),
      y: roundMetric(point.y, 4)
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const pad = Math.max(10, Math.max(bounds.width, bounds.height) * 0.05);
  return [
    { x: sortedPoints[0].x, y: roundMetric(bounds.minY - pad, 4) },
    ...sortedPoints,
    { x: sortedPoints[sortedPoints.length - 1].x, y: roundMetric(bounds.maxY + pad, 4) }
  ];
}

function buildSplitClipPolygon(divider, bounds, side) {
  if (!divider?.length) return null;
  const pad = Math.max(20, Math.max(bounds.width, bounds.height) * 0.25);
  const minX = bounds.minX - pad;
  const maxX = bounds.maxX + pad;
  const minY = bounds.minY - pad;
  const maxY = bounds.maxY + pad;

  if (side === 'left') {
    return [
      { x: minX, y: minY },
      { x: divider[0].x, y: minY },
      ...divider,
      { x: minX, y: maxY }
    ];
  }

  return [
    { x: divider[0].x, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: divider[divider.length - 1].x, y: maxY },
    ...[...divider].reverse()
  ];
}

function getPolygonCentroid(pts) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

export function buildSplitHalfDefinitions(polygon, internalPath = []) {
  const dividerPath = buildDividerFromInternalPath(polygon, internalPath);
  const dividerGap = buildDividerFromInternalGaps(polygon);
  const divider = dividerPath || dividerGap;
  
  if (!divider) {
    return [];
  }

  const bounds = getBoundingBox(polygon);
  const fullPolygonClip = [[toClipRing(polygon)]];
  const fullArea = Math.max(1, polygonArea(polygon));
  const rawDefs = [];

  for (const side of ['left', 'right']) {
    // Trừ đi 1mm vào mặt cắt cho cả hai nửa (Lùi về bên trái 1mm cho miếng trái, lùi về bên phải 1mm cho miếng phải)
    const shiftedDivider = divider.map((point) => ({
      x: side === 'left' ? point.x - 1.0 : point.x + 1.0,
      y: point.y
    }));

    const clipPolygon = buildSplitClipPolygon(shiftedDivider, bounds, side);
    if (!clipPolygon?.length) continue;

    const clipped = polygonClipping.intersection(fullPolygonClip, [[toClipRing(clipPolygon)]]);
    const rawHalfPolygon = getLargestClipResultPolygon(clipped);
    if (!rawHalfPolygon?.length) continue;

    const halfArea = polygonArea(rawHalfPolygon);
    const areaRatio = halfArea / fullArea;
    if (areaRatio <= 0.15 || areaRatio >= 0.85) {
      continue;
    }

    const rawHalfBounds = getBoundingBox(rawHalfPolygon);
    rawDefs.push({
      key: side,
      rawHalfBounds,
      rawHalfPolygon,
      halfArea
    });
  }

  if (rawDefs.length !== 2) {
    return [];
  }

  const cWhole = getPolygonCentroid(polygon);

  return rawDefs
    .sort((left, right) => left.rawHalfBounds.minX - right.rawHalfBounds.minX)
    .map((definition, index) => {
      const cHalf = getPolygonCentroid(definition.rawHalfPolygon);
      const vecX = cWhole.x - cHalf.x;
      const vecY = cWhole.y - cHalf.y;
      const len = Math.hypot(vecX, vecY) || 1;
      return {
        key: index === 0 ? 'split-left' : 'split-right',
        polygon: normalizeToOrigin(definition.rawHalfPolygon),
        cycSourcePolygon: translate(
          polygon,
          -definition.rawHalfBounds.minX,
          -definition.rawHalfBounds.minY
        ),
        areaMm2: definition.halfArea,
        splitOutwardVector: { x: vecX / len, y: vecY / len }
      };
    });
}
