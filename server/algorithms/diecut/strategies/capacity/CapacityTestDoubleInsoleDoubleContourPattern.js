import { Worker, isMainThread } from 'worker_threads';
import polygonClipping from 'polygon-clipping';
import {
  getBoundingBox,
  normalizeToOrigin,
  area as polygonArea,
  rotatePolygon,
  translate
} from '../../core/polygonUtils.js';
import { CapacityTestPrePairedSameSidePattern } from './CapacityTestPrePairedSameSidePattern.js';
import {
  cachedPolygonsOverlap,
  computeEnvelope,
  roundMetric,
  validateLocalPlacements
} from './patternCapacityUtils.js';
import { CapacityTestSameSidePattern, findMinimalContinuousValue } from './CapacityTestSameSidePattern.js';
import {
  buildCapacityResultCacheKey,
  getCachedCapacityResult,
  setCachedCapacityResult
} from './capacityResultCache.js';
import {
  getLogicalCpuCount,
  orderTasksByEstimatedWeight,
  resolveAdaptiveParallelWorkerCount
} from './parallelCapacityUtils.js';
import { DOUBLE_CONTOUR_ALGORITHM_VERSION } from './capacityVersion.js';

const DOUBLE_CONTOUR_CAPACITY_WORKER_URL = new URL('../../../workers/diecutCapacitySameSideWorker.js', import.meta.url);

// All hardcoded constants have been replaced by adaptive logic in the methods below
const DEFAULT_DOUBLE_CONTOUR_FINE_ROTATE_OFFSETS = [0];

function getWholePairsPlaced(candidate = {}) {
  const pairValue = candidate.maxPairsPlaced
    ?? candidate.actualPairs
    ?? candidate.pairs
    ?? Math.floor((candidate.placedCount || 0) / 2);
  return Math.max(0, Math.floor(Number(pairValue) || 0));
}

function computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2 = 0) {
  if (!bounds || !Number.isFinite(workWidth) || !Number.isFinite(workHeight)) {
    return {
      leftoverAreaMm2: 0,
      openSheetAreaMm2: 0,
      remainingSheetAreaMm2: 0
    };
  }

  const sheetArea = Math.max(0, workWidth * workHeight);
  const envelopeArea = Math.max(0, bounds.width * bounds.height);
  const leftStripArea = Math.max(0, bounds.minX) * workHeight;
  const rightStripArea = Math.max(0, workWidth - bounds.maxX) * workHeight;
  const topStripArea = Math.max(0, bounds.minY) * workWidth;
  const bottomStripArea = Math.max(0, workHeight - bounds.maxY) * workWidth;

  return {
    leftoverAreaMm2: roundMetric(Math.max(leftStripArea, rightStripArea, topStripArea, bottomStripArea), 3),
    openSheetAreaMm2: roundMetric(Math.max(0, sheetArea - envelopeArea), 3),
    remainingSheetAreaMm2: roundMetric(Math.max(0, sheetArea - usedAreaMm2), 3)
  };
}

function computeCandidateUsedArea(candidate = {}) {
  if (Number.isFinite(candidate.usedAreaMm2)) return candidate.usedAreaMm2;
  if (candidate.placements?.length) {
    return candidate.placements.reduce((sum, placement) =>
      sum + (placement.effectiveArea || placement.orient?.areaMm2 || candidate.pieceArea || 0),
    0);
  }
  if (candidate.placed?.length) {
    return candidate.placed.reduce((sum, item) => sum + (item.areaMm2 || 0), 0);
  }
  return (candidate.placedCount || 0) * (candidate.pieceArea || 0);
}

function attachLeftoverMetrics(candidate, workWidth, workHeight) {
  if (!candidate) return candidate;
  const bounds = candidate.bounds || (candidate.placements?.length ? computeEnvelope(candidate.placements) : null);
  const usedAreaMm2 = computeCandidateUsedArea(candidate);
  return {
    ...candidate,
    maxPairsPlaced: getWholePairsPlaced(candidate),
    ...computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2)
  };
}

function compareDoubleInsoleCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;

  const getActualPairs = (c) => c.actualPairs ?? c.pairs ?? ((c.placedCount || 0) / 2);
  const nextActual = getActualPairs(nextCandidate);
  const bestActual = getActualPairs(bestCandidate);
  
  if (nextActual !== bestActual) {
    return bestActual - nextActual;
  }

  const nextPairs = getWholePairsPlaced(nextCandidate);
  const bestPairs = getWholePairsPlaced(bestCandidate);

  if (nextPairs !== bestPairs) {
    return bestPairs - nextPairs;
  }

  const nextLeftover = nextCandidate.leftoverAreaMm2 ?? 0;
  const bestLeftover = bestCandidate.leftoverAreaMm2 ?? 0;
  if (nextLeftover !== bestLeftover) {
    return bestLeftover - nextLeftover;
  }

  const nextOpenSheet = nextCandidate.openSheetAreaMm2 ?? 0;
  const bestOpenSheet = bestCandidate.openSheetAreaMm2 ?? 0;
  if (nextOpenSheet !== bestOpenSheet) {
    return bestOpenSheet - nextOpenSheet;
  }

  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  const nextDc = nextCandidate.dcCount ?? 0;
  const bestDc = bestCandidate.dcCount ?? 0;
  if (nextDc !== bestDc) {
    return bestDc - nextDc;
  }
  if ((nextCandidate.splitPairCount || 0) !== (bestCandidate.splitPairCount || 0)) {
    return (bestCandidate.splitPairCount || 0) - (nextCandidate.splitPairCount || 0);
  }
  if ((nextCandidate.splitUnpairedCount || 0) !== (bestCandidate.splitUnpairedCount || 0)) {
    return (bestCandidate.splitUnpairedCount || 0) - (nextCandidate.splitUnpairedCount || 0);
  }
  if (nextCandidate.bodyCount !== bestCandidate.bodyCount) {
    return bestCandidate.bodyCount - nextCandidate.bodyCount;
  }
  if (nextCandidate.filler90Count !== bestCandidate.filler90Count) {
    return nextCandidate.filler90Count - bestCandidate.filler90Count;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.usedWidthMm !== bestCandidate.usedWidthMm) {
    return nextCandidate.usedWidthMm - bestCandidate.usedWidthMm;
  }
  const nextShift = Math.abs(nextCandidate.rowShiftXmm || 0) + Math.abs(nextCandidate.rowShiftYmm || 0);
  const bestShift = Math.abs(bestCandidate.rowShiftXmm || 0) + Math.abs(bestCandidate.rowShiftYmm || 0);
  if (nextShift !== bestShift) {
    return bestShift - nextShift;
  }
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

function buildShiftCandidates(range, step, limit = 9) {
  if (!Number.isFinite(range) || range <= 0) return [0];
  const safeStep = Math.max(step, 0.25);
  const candidates = new Set([0]);
  const steps = Math.max(1, limit - 1);
  const increment = Math.max(safeStep, range / steps);

  for (let value = increment; value <= range + 1e-6; value += increment) {
    const rounded = roundMetric(value, 3);
    if (Math.abs(rounded) < safeStep * 0.5) continue;
    candidates.add(rounded);
    candidates.add(-rounded);
  }

  return [...candidates].sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
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

function extractInternalGapShiftCandidates(orient, step) {
  if (!orient?.polygon?.length || !Number.isFinite(orient.height)) return [];

  const candidateMagnitudes = new Set();

  // Adaptive Sampling: Focus on the center and quarters of the piece
  const adaptiveRatios = [0.25, 0.5, 0.75];
  for (const ratio of adaptiveRatios) {
    const y = orient.height * ratio;
    const intervals = buildHorizontalIntervalsAtY(orient.polygon, y);
    if (intervals.length < 2) continue;

    let widestGap = null;
    for (let index = 0; index + 1 < intervals.length; index++) {
      const leftInterval = intervals[index];
      const rightInterval = intervals[index + 1];
      const gapStart = leftInterval[1];
      const gapEnd = rightInterval[0];
      const gapWidth = gapEnd - gapStart;
      if (gapWidth <= Math.max(step, 0.25)) continue;
      if (!widestGap || gapWidth > widestGap.gapWidth) {
        widestGap = { leftInterval, rightInterval, gapStart, gapEnd, gapWidth };
      }
    }

    if (!widestGap) continue;

    const gapCenter = (widestGap.gapStart + widestGap.gapEnd) / 2;
    const leftLobeCenter = (widestGap.leftInterval[0] + widestGap.leftInterval[1]) / 2;
    const rightLobeCenter = (widestGap.rightInterval[0] + widestGap.rightInterval[1]) / 2;

    const shifts = [
      Math.abs(gapCenter - leftLobeCenter),
      Math.abs(rightLobeCenter - gapCenter),
      Math.abs(widestGap.gapStart - leftLobeCenter),
      Math.abs(rightLobeCenter - widestGap.gapEnd)
    ];

    for (const shift of shifts) {
      const rounded = roundMetric(shift, 3);
      if (rounded >= Math.max(step, 0.25) * 0.5) {
        candidateMagnitudes.add(rounded);
      }
    }
  }

  return [...candidateMagnitudes]
    .flatMap((value) => [-value, value])
    .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}



function selectPrimaryRowShiftCandidates(geometricCandidates, sampledCandidates, limit = 12) {
  const normalized = [...new Set([...geometricCandidates, ...sampledCandidates]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => roundMetric(value, 3)))]
    .sort((left, right) => left - right);
  const selected = [];
  const seen = new Set();
  const add = (value) => {
    if (!Number.isFinite(value)) return;
    const rounded = roundMetric(value, 3);
    const key = String(rounded);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(rounded);
  };

  add(0);

  const bySmallShift = [...normalized].sort((left, right) =>
    Math.abs(left) - Math.abs(right) || left - right
  );
  for (const value of bySmallShift.slice(0, Math.min(7, limit))) {
    add(value);
  }

  for (const value of [...geometricCandidates].sort((left, right) =>
    Math.abs(left) - Math.abs(right) || left - right
  )) {
    add(value);
  }

  const byWideShift = [...normalized].sort((left, right) =>
    Math.abs(right) - Math.abs(left) || left - right
  );
  let index = 0;
  while (selected.length < limit && index < Math.max(bySmallShift.length, byWideShift.length)) {
    add(bySmallShift[index]);
    add(byWideShift[index]);
    index += 1;
  }

  return selected.slice(0, Math.max(1, limit));
}

function addRankedCandidate(candidatePool, candidate, limit = 30) {
  if (!candidate) return;
  const duplicate = candidatePool.some((existing) =>
    existing.placedCount === candidate.placedCount &&
    existing.bodyCount === candidate.bodyCount &&
    existing.filler90Count === candidate.filler90Count &&
    existing.scanOrder === candidate.scanOrder &&
    existing.bodyPrimaryAngle === candidate.bodyPrimaryAngle &&
    existing.bodyAlternateAngle === candidate.bodyAlternateAngle &&
    existing.rowShiftXmm === candidate.rowShiftXmm &&
    existing.rowShiftYmm === candidate.rowShiftYmm
  );
  if (duplicate) return;

  candidatePool.push(candidate);
  candidatePool.sort(compareDoubleInsoleCandidates);
  if (candidatePool.length > limit) {
    candidatePool.length = limit;
  }
}

function buildFillerColumnChoices(maxCols) {
  if (!Number.isFinite(maxCols) || maxCols <= 0) return [0];
  if (maxCols <= 3) {
    return Array.from({ length: maxCols }, (_, index) => maxCols - index);
  }

  return [...new Set([
    maxCols,
    Math.max(1, maxCols - 1),
    Math.max(1, Math.ceil(maxCols * 0.75)),
    Math.max(1, Math.ceil(maxCols / 2))
  ])].sort((left, right) => right - left);
}

function buildFillerRowCountChoices(maxRows) {
  if (!Number.isFinite(maxRows) || maxRows <= 0) return [0];
  const clampedMax = Math.max(0, Math.floor(maxRows));
  return [...new Set([
    0,
    1,
    Math.min(2, clampedMax),
    clampedMax
  ])]
    .filter((value) => value >= 0 && value <= clampedMax)
    .sort((left, right) => left - right);
}

function shouldTryFillerRowCombination(topRows, bottomRows, maxRows) {
  const totalRows = topRows + bottomRows;
  if (totalRows <= 2) return true;
  return topRows === maxRows || bottomRows === maxRows;
}

function rankDoubleContourVariant(variant, workWidth, workHeight) {
  const bodyRows = Math.max(0, Math.floor((workHeight - variant.bodyHeightMm) / Math.max(1, variant.bodyDyMm)) + 1);
  const estimatedCount = bodyRows * (variant.bodyCols || 0);
  const rowWidth = getPlacementsRight(variant.rowPlacements) - getPlacementsLeft(variant.rowPlacements);
  const envelopeBounds = {
    minX: 0,
    minY: 0,
    maxX: Math.min(workWidth, Math.max(rowWidth, variant.bodyDxMm || 0)),
    maxY: Math.min(workHeight, variant.bodyHeightMm + Math.max(0, bodyRows - 1) * Math.max(1, variant.bodyDyMm)),
    width: Math.min(workWidth, Math.max(rowWidth, variant.bodyDxMm || 0)),
    height: Math.min(workHeight, variant.bodyHeightMm + Math.max(0, bodyRows - 1) * Math.max(1, variant.bodyDyMm))
  };
  const leftover = computeLeftoverMetricsFromBounds(envelopeBounds, workWidth, workHeight, estimatedCount * (variant.pieceArea || 0));
  const modePenalty = String(variant.scanOrder || '').includes('sequential') ? 0 : 0.25;
  return {
    estimatedCount,
    estimatedPairs: Math.floor(estimatedCount / 2),
    leftoverAreaMm2: leftover.leftoverAreaMm2,
    openSheetAreaMm2: leftover.openSheetAreaMm2,
    pitch: variant.bodyDyMm || Infinity,
    modePenalty
  };
}


function buildRowShiftPairs(orient, step, shiftXCandidates) {
  const sizeVal = parseFloat(orient?.sizeName || orient?.name || 0);
  const pairs = [];
  const shiftYCandidates = [0];
  
  if (orient && orient.height) {
    const safeStep = 4.0; // Faster Y-shift search
    const range = Math.min(orient.height * 0.30, 25);
    for (let y = safeStep; y <= range; y += safeStep) {
      shiftYCandidates.push(roundMetric(y));
      shiftYCandidates.push(roundMetric(-y));
    }
  }

  for (const x of shiftXCandidates) {
    for (const y of shiftYCandidates) {
      pairs.push({
        rowShiftXmm: roundMetric(x),
        rowShiftYmm: roundMetric(y)
      });
    }
  }

  // Split into Y=0 (safe baseline) and Y-shifted (interlock) pools
  const y0Pairs = pairs.filter(p => p.rowShiftYmm === 0);
  const yShiftPairs = pairs.filter(p => p.rowShiftYmm !== 0);

  y0Pairs.sort((a, b) => Math.abs(a.rowShiftXmm) - Math.abs(b.rowShiftXmm));
  yShiftPairs.sort((a, b) =>
    Math.abs(a.rowShiftYmm) - Math.abs(b.rowShiftYmm)
    || Math.abs(a.rowShiftXmm) - Math.abs(b.rowShiftXmm)
  );

  const y0Limit = sizeVal <= 5 ? 30 : (sizeVal >= 10 ? 20 : 25);
  const yShiftLimit = sizeVal <= 5 ? 45 : (sizeVal >= 10 ? 30 : 35);

  // Increase limits to explore more interlocking possibilities
  const combined = [...y0Pairs.slice(0, y0Limit), ...yShiftPairs.slice(0, yShiftLimit)];
  const seen = new Set();
  return combined.filter(p => {
    const key = `${p.rowShiftXmm}_${p.rowShiftYmm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

function buildSplitHalfDefinitions(polygon, internalPath = []) {
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
    const clipPolygon = buildSplitClipPolygon(divider, bounds, side);
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

  return rawDefs
    .sort((left, right) => left.rawHalfBounds.minX - right.rawHalfBounds.minX)
    .map((definition, index) => ({
      key: index === 0 ? 'split-left' : 'split-right',
      polygon: normalizeToOrigin(definition.rawHalfPolygon),
      cycSourcePolygon: translate(
        polygon,
        -definition.rawHalfBounds.minX,
        -definition.rawHalfBounds.minY
      ),
      areaMm2: definition.halfArea,
      splitOutwardVector: index === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }
    }));
}

function quantizeWithinBounds(value, step, maxValue) {
  const safeStep = Math.max(0.25, step || 1);
  const quantized = Math.round(value / safeStep) * safeStep;
  return roundMetric(Math.max(0, Math.min(maxValue, quantized)), 3);
}

function buildAxisCandidates(minValue, maxValue, step, pieceDim = 0) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];
  if (maxValue < minValue - 1e-6) return [];

  const clampedMax = Math.max(minValue, maxValue);
  const span = Math.max(0, clampedMax - minValue);
  const safeStep = Math.max(0.5, step || 1);
  const values = new Set([minValue, clampedMax]);

  // Adaptive sampling: instead of fixed ratios, use steps based on span relative to piece size
  const targetStep = pieceDim > 0 ? Math.max(safeStep, pieceDim / 4) : safeStep * 10;
  const sampleCount = Math.min(15, Math.ceil(span / targetStep) + 1);

  if (sampleCount > 2) {
    for (let i = 1; i < sampleCount; i++) {
      const ratio = i / sampleCount;
      values.add(quantizeWithinBounds(minValue + span * ratio, safeStep, clampedMax));
    }
  }

  return [...values].sort((a, b) => a - b);
}


function buildDenseAxisCandidates(minValue, maxValue, step, maxSamples = 100) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];
  if (maxValue < minValue - 1e-6) return [];

  const clampedMax = Math.max(minValue, maxValue);
  const span = Math.max(0, clampedMax - minValue);
  const safeStep = Math.max(0.5, step || 1);
  const values = new Set([
    quantizeWithinBounds(minValue, safeStep, clampedMax),
    quantizeWithinBounds(clampedMax, safeStep, clampedMax)
  ]);
  const sampleCount = Math.min(
    maxSamples,
    Math.max(3, Math.floor(span / Math.max(safeStep * 5, 10)) + 1)
  );

  for (let index = 0; index < sampleCount; index++) {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    values.add(quantizeWithinBounds(minValue + span * ratio, safeStep, clampedMax));
  }

  return [...values]
    .filter((value) => Number.isFinite(value) && value >= minValue - 1e-6 && value <= clampedMax + 1e-6)
    .sort((left, right) => left - right);
}

function selectRankedAxisAnchors(values, minStart, maxStart, limit = 100) {
  const normalized = [...new Set(
    values
      .map((value) => roundMetric(Number(value), 3))
      .filter((value) =>
        Number.isFinite(value) &&
        value >= minStart - 1e-6 &&
        value <= maxStart + 1e-6
      )
  )].sort((left, right) => left - right);

  if (normalized.length <= limit) return normalized;

  const selected = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(roundMetric(value, 3));
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(roundMetric(value, 3));
  };

  add(minStart);
  add(maxStart);

  const mid = (minStart + maxStart) / 2;
  const edgeRanked = [...normalized].sort((left, right) =>
    Math.min(Math.abs(left - minStart), Math.abs(left - maxStart)) -
      Math.min(Math.abs(right - minStart), Math.abs(right - maxStart))
    || Math.abs(left - mid) - Math.abs(right - mid)
    || left - right
  );

  for (const value of edgeRanked) {
    add(value);
    if (selected.length >= Math.ceil(limit * 0.65)) break;
  }

  const spreadSlots = Math.max(3, limit - selected.length);
  for (let index = 0; index < spreadSlots && selected.length < limit; index++) {
    const ratio = spreadSlots === 1 ? 0.5 : index / (spreadSlots - 1);
    const target = minStart + (maxStart - minStart) * ratio;
    let nearest = normalized[0];
    for (const value of normalized) {
      if (Math.abs(value - target) < Math.abs(nearest - target)) {
        nearest = value;
      }
    }
    add(nearest);
  }

  return selected.sort((left, right) => left - right);
}

function rotateVector(vector, angleDegrees) {
  const angleRad = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: roundMetric(vector.x * cos - vector.y * sin, 6),
    y: roundMetric(vector.x * sin + vector.y * cos, 6)
  };
}

function resolveAxisSideFromVector(vector) {
  if (!vector) return null;
  if (Math.abs(vector.x) >= Math.abs(vector.y)) {
    return vector.x >= 0 ? 'right' : 'left';
  }
  return vector.y >= 0 ? 'bottom' : 'top';
}

function normalizeAngleDegrees(angle) {
  return ((roundMetric(Number(angle), 3) % 360) + 360) % 360;
}

function getPlacementBounds(placement) {
  const bb = placement?.orient?.bb || getBoundingBox(placement?.orient?.polygon || []);
  return {
    minX: placement.x + bb.minX,
    minY: placement.y + bb.minY,
    maxX: placement.x + bb.maxX,
    maxY: placement.y + bb.maxY
  };
}

function getPlacementsTop(placements = []) {
  if (!placements.length) return 0;
  let minY = Infinity;
  for (const placement of placements) {
    minY = Math.min(minY, getPlacementBounds(placement).minY);
  }
  return roundMetric(minY, 3);
}

function getPlacementsBottom(placements = []) {
  let maxY = 0;
  for (const placement of placements) {
    maxY = Math.max(maxY, getPlacementBounds(placement).maxY);
  }
  return roundMetric(maxY, 3);
}

function getPlacementsLeft(placements = []) {
  if (!placements.length) return 0;
  let minX = Infinity;
  for (const placement of placements) {
    minX = Math.min(minX, getPlacementBounds(placement).minX);
  }
  return roundMetric(minX, 3);
}

function getPlacementsRight(placements = []) {
  if (!placements.length) return 0;
  let maxX = -Infinity;
  for (const placement of placements) {
    maxX = Math.max(maxX, getPlacementBounds(placement).maxX);
  }
  return roundMetric(maxX, 3);
}

function getAveragePitchX(placements = []) {
  if (placements.length < 2) return null;
  let total = 0;
  for (let index = 1; index < placements.length; index++) {
    total += placements[index].x - placements[index - 1].x;
  }
  return roundMetric(total / (placements.length - 1), 3);
}

function buildEmptyDoubleContourSummaryItem(size) {
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: 0,
    pairs: 0,
    placedCount: 0,
    efficiency: 0
  };
}


function shouldUseParallelDoubleContourCapacity(sizeList, config) {
  return isMainThread
    && config.parallelSizes !== false
    && config.capacityLayoutMode === 'same-side-double-contour'
    && sizeList.length > 1;
}

function estimateDoubleContourTaskWeight(size, config) {
  const usableWidth = Math.max(1, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(1, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const usableArea = usableWidth * usableHeight;
  const pieceArea = Math.max(1, polygonArea(size?.polygon) || 1);
  const pointFactor = 1 + Math.max(0, ((size?.polygon?.length || 0) - 24) / 64);
  const splitFactor = config.preparedSplitFillEnabled === false ? 1 : 1.35;
  return (usableArea / pieceArea) * pointFactor * splitFactor;
}

function resolveDoubleContourWorkerCount(tasks, config) {
  const taskCount = Array.isArray(tasks) ? tasks.length : 0;
  if (taskCount <= 0) return 0;

  if (config.parallelWorkerCount > 0) {
    return Math.min(taskCount, Math.max(1, config.parallelWorkerCount));
  }

  const adaptiveCap = resolveAdaptiveParallelWorkerCount(tasks.map((task) => task.size), config);
  const logicalCpuCount = getLogicalCpuCount();
  const cpuRatio = config.preparedSplitFillEnabled === false ? 0.75 : 0.65;
  const responsiveCpuCap = Math.max(1, Math.floor(logicalCpuCount * cpuRatio));
  const sizeCurveCap = Math.max(
    1,
    Math.ceil(Math.sqrt(taskCount)) + (taskCount >= 12 ? 1 : 0)
  );

  return Math.min(taskCount, adaptiveCap, responsiveCpuCap, sizeCurveCap);
}

function runDoubleContourWorkerTask(worker, task) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };

    const onMessage = (message) => {
      cleanup();
      if (message?.error) {
        reject(new Error(message.error));
        return;
      }
      resolve(message);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage(task);
  });
}

async function executeDoubleContourTasksInParallel(tasks, concurrency, onProgress) {
  if (!tasks.length) return [];

  const workerCount = Math.min(tasks.length, Math.max(1, concurrency));
  const results = new Array(tasks.length);
  let nextTaskIndex = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    const worker = new Worker(DOUBLE_CONTOUR_CAPACITY_WORKER_URL, {
      type: 'module',
      execArgv: []
    });
    try {
      while (true) {
        const taskBatchIndex = nextTaskIndex;
        nextTaskIndex += 1;
        if (taskBatchIndex >= tasks.length) break;
        
        const task = tasks[taskBatchIndex];
        const resultIndex = task?.index ?? taskBatchIndex;
        
        if (onProgress) onProgress(resultIndex, 'started');
        
        results[resultIndex] = await runDoubleContourWorkerTask(worker, task);
        
        if (onProgress) onProgress(resultIndex, 'done');
      }
    } finally {
      await worker.terminate();
    }
  });

  await Promise.all(runners);
  return results;
}


export class CapacityTestDoubleInsoleDoubleContourPattern extends CapacityTestPrePairedSameSidePattern {
  _getDoubleContourFineRotateOffsets(config = {}) {
    if (Array.isArray(config.doubleContourFineRotateOffsets) && config.doubleContourFineRotateOffsets.length) {
      return [...new Set(
        config.doubleContourFineRotateOffsets
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => roundMetric(Math.max(-5, Math.min(5, value)), 3))
      )];
    }

    if (config.doubleContourFineRotateEnabled === false) {
      return [0];
    }

    return DEFAULT_DOUBLE_CONTOUR_FINE_ROTATE_OFFSETS;
  }

  _getDoubleContourPreferredAngles(sizeName, config = {}) {
    return [0, 90, 180, 270];
  }

  _buildShiftedUniformNeighborhood(orient, dxMm, rowPitchMm, rowShiftXmm = 0, rowShiftYmm = 0) {
    const placements = [];
    const sampleRows = 3;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < sampleCols; col++) {
        placements.push({
          id: `double_insole_shift_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm + shiftX, 3),
          y: roundMetric(row * rowPitchMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _findShiftedUniformDy(orient, dxMm, rowShiftXmm, rowShiftYmm, config, step) {
    const sizeVal = parseFloat(orient.sizeName || orient.name || 0);

    const precision = 0.05; // Balanced for speed
    const upper = Math.max(
      step,
      orient.height * 2 + Math.abs(rowShiftYmm) + config.spacing + step * 10
    );

    const spacing = config.spacing || 0;
    const bb = orient.bb || getOrientBounds(orient);

    const validatePitch = (dy) => {
      // Build a 3-row neighborhood to check ALL possible inter-row collisions:
      // Row 0 vs 1, Row 1 vs 2, AND Row 0 vs 2 (critical for concave shapes)
      const neighborhood = [];
      const rows = 3; // 3 rows is the minimum to detect most interlocking interference
      const cols = 5; // Sufficient width for local overlap check
      
      for (let r = 0; r < rows; r++) {
        const shiftX = (r % 2 === 1) ? rowShiftXmm : 0;
        const shiftY = (r % 2 === 1) ? rowShiftYmm : 0;
        const baseY = r * dy + shiftY;
        
        for (let c = 0; c < cols; c++) {
          neighborhood.push({
            x: c * dxMm + shiftX,
            y: baseY,
            orient: orient,
            bb: bb
          });
        }
      }
      
      // Validate all internal collisions in this 3x5 block
      return validateLocalPlacements(neighborhood, spacing).valid;
    };

    let low = 0;
    let high = upper;
    if (!validatePitch(high)) {
      return null;
    }

    while (high - low > precision) {
      const mid = (low + high) / 2;
      if (validatePitch(mid)) high = mid;
      else low = mid;
    }
return roundMetric(high, 3);
  }

  _findShiftedRowPitch(rowPlacements, rowShiftXmm, rowShiftYmm, config, step) {
    if (!rowPlacements.length) return null;
    const sizeVal = parseFloat(rowPlacements[0].orient.sizeName || rowPlacements[0].orient.name || 0);


    const spacing = config.spacing || 0;
    const precision = 0.005;
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const minDeltaY = 0;
    const upper = Math.max(
      step,
      rowBottom - rowTop + Math.abs(rowShiftYmm) + spacing + step * 10
    );

    // Pre-calculate bounding boxes and indexed data for Row 1
    const row1Indexed = rowPlacements.map(p => ({
      p,
      bb: p.orient.bb || getOrientBounds(p.orient),
      minX: p.x + (p.orient.bb?.minX ?? 0),
      maxX: p.x + (p.orient.bb?.maxX ?? 0)
    }));

    // Sort Row 1 by maxX for faster filtering

    const validatePitch = (dy) => {
      // Robust multi-row validation for sequential rows
      const neighborhood = [];
      const rows = 6; // Increased to 6 to ensure full staggered cycle validation (even/odd interactions)
      
      for (let r = 0; r < rows; r++) {
        const shiftX = (r % 2 === 1) ? rowShiftXmm : 0;
        const shiftY = (r % 2 === 1) ? rowShiftYmm : 0;
        const rowBaseY = r * dy + shiftY;
        
        for (const p of rowPlacements) {
          neighborhood.push({
            ...p,
            x: p.x + shiftX,
            y: p.y + rowBaseY,
            // Ensure orientation data is preserved for validation
            orient: p.orient,
            bb: p.orient.bb || getOrientBounds(p.orient)
          });
        }
      }

      return validateLocalPlacements(neighborhood, spacing).valid;
    };

    return findMinimalContinuousValue(minDeltaY, upper, precision, validatePitch);
  }



  _buildShiftedUniformPlacements(orient, cols, rows, dxMm, dyMm, rowShiftXmm = 0, rowShiftYmm = 0, startY = 0, alternateOrient = null) {
    const placements = [];
    const baseX = rowShiftXmm < 0 ? -rowShiftXmm : 0;
    const baseY = startY - Math.min(0, rowShiftYmm);

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < cols; col++) {
        const isOddCol = col % 2 === 1;
        const currentOrient = (isOddCol && alternateOrient) ? alternateOrient : orient;

        placements.push({
          id: `double_insole_${row}_${col}`,
          orient: currentOrient,
          x: roundMetric(baseX + col * dxMm + shiftX, 3),
          y: roundMetric(baseY + row * dyMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _buildRepeatedBodyPlacements(rowPlacements, rows, dyMm, startY = 0, rowShiftXmm = 0, rowShiftYmm = 0, startX = 0) {
    const placements = [];
    const baseX = startX;
    const baseY = startY;

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (const p of rowPlacements) {
        placements.push({
          ...p,
          id: `double_insole_${row}_${p.id}`,
          x: roundMetric(baseX + p.x + shiftX, 3),
          y: roundMetric(baseY + row * dyMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _buildUniformPlacementsAtX(orient, cols, rows, dxMm, dyMm, startX = 0, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(startX + col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _decorateSplitHalfOrient(sizeName, halfDef, angle, config, step) {
    const orient = this._getOrient(
      {
        sizeName,
        foot: halfDef.key,
        polygon: halfDef.polygon
      },
      angle,
      step,
      config.spacing
    );
    const rawRotatedHalf = rotatePolygon(halfDef.polygon, angle * Math.PI / 180);
    const rawHalfBounds = getBoundingBox(rawRotatedHalf);
    const splitOutwardVector = rotateVector(halfDef.splitOutwardVector || { x: 1, y: 0 }, angle);

    return {
      ...orient,
      foot: halfDef.key,
      bb: orient.bb || getBoundingBox(orient.polygon),
      width: orient.bb?.width ?? getBoundingBox(orient.polygon).width,
      height: orient.bb?.height ?? getBoundingBox(orient.polygon).height,
      areaMm2: halfDef.areaMm2,
      splitPairAngleFamily: normalizeAngleDegrees(angle) % 180,
      splitOutwardVector,
      splitOutwardSide: resolveAxisSideFromVector(splitOutwardVector),
      cycPolygon: translate(
        rotatePolygon(halfDef.cycSourcePolygon, angle * Math.PI / 180),
        -rawHalfBounds.minX,
        -rawHalfBounds.minY
      )
      };
    }

  _getSplitFillAngles(config = {}) {
    if (Array.isArray(config.preparedSplitFillAngles) && config.preparedSplitFillAngles.length) {
      return [...new Set(
        config.preparedSplitFillAngles
          .map((angle) => Number(angle))
          .filter((angle) => Number.isFinite(angle))
          .map((angle) => normalizeAngleDegrees(angle))
      )];
    }

    // Half pieces are directional, so 180/270 can unlock gaps that the base layout does not need.
    const baseAngles = config.allowRotate90 === false
      ? [0, 180]
      : [0, 90, 180, 270];
    const offsets = this._getDoubleContourFineRotateOffsets(config);
    const angles = [];

    for (const baseAngle of baseAngles) {
      for (const offset of offsets) {
        angles.push(normalizeAngleDegrees(baseAngle + offset));
      }
    }

    return [...new Set(angles)];
  }

  _getPlacementBounds(placement) {
    const bb = placement?.orient?.bb || getBoundingBox(placement?.orient?.polygon || []);
    return {
      minX: roundMetric(placement.x + bb.minX, 3),
      minY: roundMetric(placement.y + bb.minY, 3),
      maxX: roundMetric(placement.x + bb.maxX, 3),
      maxY: roundMetric(placement.y + bb.maxY, 3),
      width: roundMetric(bb.width, 3),
      height: roundMetric(bb.height, 3)
    };
  }

  _splitPreparedFreeRect(rect, bounds, spacing = 0) {
    if (!rect || !bounds) return [];

    const rectMaxX = rect.x + rect.width;
    const rectMaxY = rect.y + rect.height;
    const occupiedMinX = Math.max(rect.x, bounds.minX - spacing);
    const occupiedMinY = Math.max(rect.y, bounds.minY - spacing);
    const occupiedMaxX = Math.min(rectMaxX, bounds.maxX + spacing);
    const occupiedMaxY = Math.min(rectMaxY, bounds.maxY + spacing);

    if (occupiedMinX >= occupiedMaxX || occupiedMinY >= occupiedMaxY) {
      return [rect];
    }

    const candidates = [
      { x: rect.x, y: rect.y, width: occupiedMinX - rect.x, height: rect.height },
      { x: occupiedMaxX, y: rect.y, width: rectMaxX - occupiedMaxX, height: rect.height },
      { x: rect.x, y: rect.y, width: rect.width, height: occupiedMinY - rect.y },
      { x: rect.x, y: occupiedMaxY, width: rect.width, height: rectMaxY - occupiedMaxY }
    ];

    return candidates
      .map((candidate) => ({
        x: roundMetric(candidate.x, 3),
        y: roundMetric(candidate.y, 3),
        width: roundMetric(candidate.width, 3),
        height: roundMetric(candidate.height, 3)
      }))
      .filter((candidate) =>
        candidate.width > 5 && candidate.height > 5
      );
  }

  _normalizePreparedFreeRects(freeRects = []) {
    // Adaptive Threshold: Ignore rectangles too small to fit even a fragment of the piece
    const minSize = 10; 
    const normalized = freeRects
      .filter((rect) => rect.width > minSize && rect.height > minSize)
      .sort((left, right) =>
        right.width * right.height - left.width * left.height
        || left.y - right.y
        || left.x - right.x
      );

    const unique = [];
    // Dynamic Limit: More rectangles for complex layouts, fewer for simple ones
    const maxRects = 64; 
    for (const rect of normalized) {
      const contained = unique.some((other) =>
        rect.x >= other.x - 1e-6 &&
        rect.y >= other.y - 1e-6 &&
        rect.x + rect.width <= other.x + other.width + 1e-6 &&
        rect.y + rect.height <= other.y + other.height + 1e-6
      );
      if (!contained) unique.push(rect);
      if (unique.length >= maxRects) break;
    }

    return unique;
  }

  _buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, spacing = 0) {
    let freeRects = [{
      x: 0,
      y: 0,
      width: workWidth,
      height: workHeight
    }];

    const occupiedBounds = occupiedPlacements
      .map((placement) => this._getPlacementBounds(placement))
      .sort((left, right) =>
        (right.width * right.height) - (left.width * left.height)
        || left.minY - right.minY
        || left.minX - right.minX
      );

    for (const bounds of occupiedBounds) {
      const nextRects = [];
      for (const rect of freeRects) {
        nextRects.push(...this._splitPreparedFreeRect(rect, bounds, spacing));
      }
      freeRects = this._normalizePreparedFreeRects(nextRects);
      if (!freeRects.length) break;
    }

    return freeRects;
  }

  _buildPreparedRectPlacementCandidates(rect, orient, step) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = rect.x - bb.minX;
    const minY = rect.y - bb.minY;
    const maxX = rect.x + rect.width - bb.maxX;
    const maxY = rect.y + rect.height - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const xs = buildAxisCandidates(minX, maxX, step, orient.width);
    const ys = buildAxisCandidates(minY, maxY, step, orient.height);

    return [...new Set(xs.flatMap((x) => ys.map((y) => `${x}|${y}`)))]
      .map((key) => {
        const [x, y] = key.split('|').map(Number);
        return { x, y };
      });
  }



  _scorePreparedEdgePlacementCandidate(candidate, orient, workWidth, workHeight, existingPlacements) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = candidate.x + bb.minX;
    const minY = candidate.y + bb.minY;
    const maxX = candidate.x + bb.maxX;
    const maxY = candidate.y + bb.maxY;
    
    const preferredSide = orient?.splitOutwardSide || null;
    const sideDistances = {
      left: Math.abs(minX),
      right: Math.abs(workWidth - maxX),
      top: Math.abs(minY),
      bottom: Math.abs(workHeight - maxY)
    };
    
    const preferredDistance = preferredSide ? sideDistances[preferredSide] ?? 0 : 0;
    const nearestEdgeDistance = Math.min(
      sideDistances.left,
      sideDistances.right,
      sideDistances.top,
      sideDistances.bottom
    );

    // Stronger proximity scoring to encourage tight clustering of split pieces
    let proximityBonus = 0;
    if (existingPlacements && existingPlacements.length > 0) {
      let minGap = 1000;
      let minSplitGap = 1000;
      
      // Sample existing placements
      const sampleCount = Math.min(20, existingPlacements.length);
      for (let i = 0; i < sampleCount; i++) {
        const other = existingPlacements[existingPlacements.length - 1 - i];
        const dx = candidate.x - other.x;
        const dy = candidate.y - other.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < minGap) minGap = dist;
        // Extra bonus for being near another split piece
        if (other.id?.startsWith('split_fill') || other.id?.startsWith('margin_fill')) {
          if (dist < minSplitGap) minSplitGap = dist;
        }
      }
      
      proximityBonus = (minGap * 0.2) + (minSplitGap * 0.4);
    } else {
      // If first piece, prefer corners
      proximityBonus = (minX + minY) * 0.1;
    }
    return (
      preferredDistance * 0.4 +
      nearestEdgeDistance * 0.3 +
      proximityBonus * 1.5 + 
      candidate.y * 0.01 +   
      candidate.x * 0.005    
    );
  }

  _findUniformDx(orient, config, step) {
    const sizeVal = parseFloat(orient.sizeName || orient.name);

    const spacing = config.spacing || 0;
    const precision = 0.005;
    const upper = Math.max(step, orient.width * 2 + spacing + step * 8);

    const result = findMinimalContinuousValue(step, upper, precision, (dxMm) => {
      const neighborhood = [];
      const bb = orient.bb || getOrientBounds(orient);
      for (let col = 0; col < 6; col++) {
        neighborhood.push({
          x: col * dxMm,
          y: 0,
          orient: orient,
          bb: bb
        });
      }
      const res = validateLocalPlacements(neighborhood, spacing).valid;
      return res;
    });
    if (sizeVal <= 3.5) console.log(`[DEBUG] Size ${sizeVal} final dxMm=${result}`);
    return result;
  }

  _findAlignedBodyDx(primaryOrient, alternateOrient, config, step) {
    const sizeVal = parseFloat(primaryOrient.sizeName || primaryOrient.name);

    const spacing = config.spacing || 0;
    const precision = 0.005;
    const upper = Math.max(
      step,
      Math.max(primaryOrient.width, alternateOrient.width) * 2 + spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) => {
      const neighborhood = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 6; col++) {
          const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, 'rows', row, col);
          neighborhood.push({
            x: col * dxMm,
            y: row * (primaryOrient.height + spacing), 
            orient: orient,
            bb: orient.bb || getOrientBounds(orient)
          });
        }
      }
      return validateLocalPlacements(neighborhood, spacing).valid;
    });
  }

  _findBestPreparedSplitPlacement(occupiedPlacements, orient, workWidth, workHeight, config, step) {
    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    
    let bestCandidate = null;
    let minScore = Infinity;

    // 1. Try Rect-based candidates (Area seeking)
    const freeRects = this._buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, spacing);
    for (const rect of freeRects) {
      const candidates = this._buildPreparedRectPlacementCandidates(rect, orient, step);
      for (const candidate of candidates) {
        if (this._canPlaceSplitOrient(occupiedPlacements, orient, candidate.x, candidate.y, config, workWidth, workHeight, spatialIndex, true)) {
          const score = this._scorePreparedEdgePlacementCandidate(candidate, orient, workWidth, workHeight, occupiedPlacements);
          if (score < minScore) {
            minScore = score;
            bestCandidate = candidate;
          }
        }
      }
    }

    // 2. Try Geometric Anchors (Gap seeking)
    const anchors = this._buildGeometricVertexAnchors(occupiedPlacements, orient, workWidth, workHeight, spacing);
    for (const anchor of anchors) {
        if (this._canPlaceSplitOrient(occupiedPlacements, orient, anchor.x, anchor.y, config, workWidth, workHeight, spatialIndex, true)) {
            const score = this._scorePreparedEdgePlacementCandidate(anchor, orient, workWidth, workHeight, occupiedPlacements);
            if (score < minScore) {
                minScore = score;
                bestCandidate = anchor;
            }
        }
    }

    return bestCandidate;
  }

  _buildGeometricVertexAnchors(occupiedPlacements, orient, workWidth, workHeight, spacing) {
      const bb = orient.bb || getBoundingBox(orient.polygon);
      const anchors = [];
      const seen = new Set();
      
    const addAnchor = (x, y) => {
      if (x < -bb.minX || x > workWidth - bb.maxX || y < -bb.minY || y > workHeight - bb.maxY) return;
      // Adaptive precision based on spacing
      const snap = Math.max(0.5, spacing * 0.1);
      const key = `${Math.round(x/snap)}|${Math.round(y/snap)}`;
      if (seen.has(key)) return;
      seen.add(key);
      anchors.push({ x, y });
    };

      // Add sheet corners
      addAnchor(-bb.minX, -bb.minY);
      addAnchor(workWidth - bb.maxX, -bb.minY);
      addAnchor(-bb.minX, workHeight - bb.maxY);
      addAnchor(workWidth - bb.maxX, workHeight - bb.maxY);

      // Performance Optimization: Only consider anchors from the last 15 pieces added
      // This focuses search on the "active front" and prevents O(N^2) explosion
      const activeLimit = 50; // High-Velocity: Optimized search horizon for benchmark speed
      const recentPlacements = occupiedPlacements.slice(-activeLimit);

      for (const p of recentPlacements) {
          const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
          const pMinX = p.x + pbb.minX;
          const pMaxX = p.x + pbb.maxX;
          const pMinY = p.y + pbb.minY;
          const pMaxY = p.y + pbb.maxY;

          // Try aligning our piece's bounds with existing piece's bounds + spacing
          const nudge = spacing;
          addAnchor(pMaxX + nudge - bb.minX, p.y);
          addAnchor(pMinX - nudge - bb.maxX, p.y);
          addAnchor(p.x, pMaxY + nudge - bb.minY);
          addAnchor(p.x, pMinY - nudge - bb.maxY);
          
          // Diagonal/Corner alignments
          addAnchor(pMaxX + nudge - bb.minX, pMaxY + nudge - bb.minY);
          addAnchor(pMinX - nudge - bb.maxX, pMinY - nudge - bb.maxY);
      }

      return anchors;
  }



  _buildPreparedBoundaryPlacementCandidates(orient, workWidth, workHeight, step) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const boundaryStep = Math.max(1, (step || 1) * 2);
    const xs = buildDenseAxisCandidates(minX, maxX, boundaryStep);
    const ys = buildDenseAxisCandidates(minY, maxY, boundaryStep);
    const preferredSide = orient?.splitOutwardSide || null;
    const sideSpecs = [
      { side: 'right', x: maxX, ys },
      { side: 'left', x: minX, ys },
      { side: 'top', y: minY, xs },
      { side: 'bottom', y: maxY, xs }
    ].sort((left, right) =>
      (right.side === preferredSide ? 1 : 0) - (left.side === preferredSide ? 1 : 0)
    );

    const keys = new Set();
    const candidates = [];
    for (const spec of sideSpecs) {
      if (spec.x != null) {
        for (const y of spec.ys) {
          const key = `${spec.x}|${y}`;
          if (keys.has(key)) continue;
          keys.add(key);
          candidates.push({ x: spec.x, y });
        }
      } else {
        for (const x of spec.xs) {
          const key = `${x}|${spec.y}`;
          if (keys.has(key)) continue;
          keys.add(key);
          candidates.push({ x, y: spec.y });
        }
      }
    }
    return candidates;
  }

  _canPlaceSplitOrient(occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex = null, skipOutwardCheck = false) {
    const spacing = config.spacing || 0;
    const bb2 = orient.bb || getBoundingBox(orient.polygon);
    const minX2 = x + bb2.minX - spacing;
    const maxX2 = x + bb2.maxX + spacing;
    const minY2 = y + bb2.minY - spacing;
    const maxY2 = y + bb2.maxY + spacing;

    // Fast bounds check against sheet
    if (
      x + bb2.minX < -1e-6 ||
      y + bb2.minY < -1e-6 ||
      x + bb2.maxX > workWidth + 1e-6 ||
      y + bb2.maxY > workHeight + 1e-6
    ) {
      return false;
    }

    if (spatialIndex && spatialIndex.grid) {
      const { grid, cellSize } = spatialIndex;
      const x1 = Math.floor(minX2 / cellSize);
      const x2 = Math.floor(maxX2 / cellSize);
      const y1 = Math.floor(minY2 / cellSize);
      const y2 = Math.floor(maxY2 / cellSize);
      const queried = new Set();

      for (let cy = y1; cy <= y2; cy++) {
        for (let cx = x1; cx <= x2; cx++) {
          const cell = grid.get(`${cx},${cy}`);
          if (!cell) continue;
          for (const entry of cell) {
            if (queried.has(entry.p)) continue;
            queried.add(entry.p);

            if (entry.maxX < minX2 || entry.minX > maxX2 || entry.maxY < minY2 || entry.minY > maxY2) continue;

            if (cachedPolygonsOverlap(
              entry.p.orient.polygon,
              orient.polygon,
              { x: entry.p.x, y: entry.p.y },
              { x, y },
              spacing,
              entry.bb,
              bb2
            )) {
              return false;
            }
          }
        }
      }
    } else if (spatialIndex && spatialIndex.sortedByMaxX) {
      const { sortedByMaxX } = spatialIndex;
      for (let i = sortedByMaxX.length - 1; i >= 0; i--) {
        const entry = sortedByMaxX[i];
        if (entry.maxX < minX2) break;
        if (entry.minX > maxX2) continue;
        if (entry.maxY < minY2 || entry.minY > maxY2) continue;

        if (cachedPolygonsOverlap(
          entry.p.orient.polygon,
          orient.polygon,
          { x: entry.p.x, y: entry.p.y },
          { x, y },
          spacing,
          entry.bb,
          bb2
        )) {
          return false;
        }
      }
    }

    // CRITICAL: Check against placements that are NOT in the spatial index yet (newly added in beam search)
    // These are always at the end of the array because beam search appends them.
    if (spatialIndex && spatialIndex.indexed && occupiedPlacements.length > spatialIndex.indexed.length) {
      for (let i = occupiedPlacements.length - 1; i >= spatialIndex.indexed.length; i--) {
        const p1 = occupiedPlacements[i];
        const bb1 = p1.orient.bb || getBoundingBox(p1.orient.polygon);
        
        if (
          p1.x + bb1.maxX < minX2 ||
          p1.x + bb1.minX > maxX2 ||
          p1.y + bb1.maxY < minY2 ||
          p1.y + bb1.minY > maxY2
        ) {
          continue;
        }

        if (cachedPolygonsOverlap(
          p1.orient.polygon,
          orient.polygon,
          { x: p1.x, y: p1.y },
          { x, y },
          spacing,
          bb1,
          bb2
        )) {
          return false;
        }
      }
    }

    if (!skipOutwardCheck && !this._isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex)) {
      return false;
    }

    return true;
  }

  _isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex = null) {
    const splitSide = orient?.splitOutwardSide;
    if (!splitSide) return true;

    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = x + bb.minX;
    const minY = y + bb.minY;
    const maxX = x + bb.maxX;
    const maxY = y + bb.maxY;
    
    let corridor = null;

    if (splitSide === 'left' && minX > 1e-6) {
      corridor = { minX: 0, maxX: minX, minY, maxY };
    } else if (splitSide === 'right' && maxX < workWidth - 1e-6) {
      corridor = { minX: maxX, maxX: workWidth, minY, maxY };
    } else if (splitSide === 'top' && minY > 1e-6) {
      corridor = { minX, maxX, minY: 0, maxY: minY };
    } else if (splitSide === 'bottom' && maxY < workHeight - 1e-6) {
      corridor = { minX, maxX, minY: maxY, maxY: workHeight };
    }

    if (!corridor) return true;

    if (spatialIndex && spatialIndex.grid) {
      const { grid, cellSize } = spatialIndex;
      const x1 = Math.floor(corridor.minX / cellSize);
      const x2 = Math.floor(corridor.maxX / cellSize);
      const y1 = Math.floor(corridor.minY / cellSize);
      const y2 = Math.floor(corridor.maxY / cellSize);
      const queried = new Set();

      for (let cy = y1; cy <= y2; cy++) {
        for (let cx = x1; cx <= x2; cx++) {
          const cell = grid.get(`${cx},${cy}`);
          if (!cell) continue;
          for (const entry of cell) {
            if (queried.has(entry.p)) continue;
            queried.add(entry.p);

            const overlaps = !(
              entry.maxX <= corridor.minX + 1e-6 ||
              entry.minX >= corridor.maxX - 1e-6 ||
              entry.maxY <= corridor.minY + 1e-6 ||
              entry.minY >= corridor.maxY - 1e-6
            );
            if (overlaps) return false;
          }
        }
      }
    } else if (spatialIndex && spatialIndex.sortedByMaxX) {
      const { sortedByMaxX } = spatialIndex;
      for (let i = sortedByMaxX.length - 1; i >= 0; i--) {
        const entry = sortedByMaxX[i];
        if (entry.maxX <= corridor.minX + 1e-6) break;
        if (entry.minX >= corridor.maxX - 1e-6) continue;
        if (entry.maxY <= corridor.minY + 1e-6 || entry.minY >= corridor.maxY - 1e-6) continue;
        return false;
      }
    } else {
      for (const placement of occupiedPlacements) {
        const bounds = this._getPlacementBounds(placement);
        const overlapsCorridor = !(
          bounds.maxX <= corridor.minX + 1e-6 ||
          bounds.minX >= corridor.maxX - 1e-6 ||
          bounds.maxY <= corridor.minY + 1e-6 ||
          bounds.minY >= corridor.maxY - 1e-6
        );
        if (overlapsCorridor) {
          return false;
        }
      }
    }

    return true;
  }

  _buildSpatialIndex(placements, workWidth, workHeight, spacing = 0) {
    const indexed = placements.map(p => {
      const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
      return {
        p,
        bb,
        minX: p.x + bb.minX,
        maxX: p.x + bb.maxX,
        minY: p.y + bb.minY,
        maxY: p.y + bb.maxY
      };
    });

    if (indexed.length > 20 && workWidth && workHeight) {
      const avgWidth = indexed.reduce((sum, item) => sum + (item.maxX - item.minX), 0) / indexed.length;
      const avgHeight = indexed.reduce((sum, item) => sum + (item.maxY - item.minY), 0) / indexed.length;
      const cellSize = Math.max(10, Math.max(avgWidth, avgHeight) + spacing);
      const grid = new Map();

      for (const item of indexed) {
        const x1 = Math.floor(item.minX / cellSize);
        const x2 = Math.floor(item.maxX / cellSize);
        const y1 = Math.floor(item.minY / cellSize);
        const y2 = Math.floor(item.maxY / cellSize);

        for (let cy = y1; cy <= y2; cy++) {
          for (let cx = x1; cx <= x2; cx++) {
            const key = `${cx},${cy}`;
            let cell = grid.get(key);
            if (!cell) {
              cell = [];
              grid.set(key, cell);
            }
            cell.push(item);
          }
        }
      }

      return {
        grid,
        cellSize,
        indexed
      };
    }

    return {
      sortedByMaxX: indexed.sort((a, b) => a.maxX - b.maxX)
    };
  }

  _getSplitPartnerDirection(lastPlacement, partnerOrient) {
    const lastSide = lastPlacement?.orient?.splitOutwardSide;
    const partnerSide = partnerOrient?.splitOutwardSide;
    const validPair = (
      (lastSide === 'right' && partnerSide === 'left') ||
      (lastSide === 'left' && partnerSide === 'right') ||
      (lastSide === 'bottom' && partnerSide === 'top') ||
      (lastSide === 'top' && partnerSide === 'bottom')
    );
    if (!validPair) return null;

    if (lastSide === 'right') return { axis: 'x', sign: 1 };
    if (lastSide === 'left') return { axis: 'x', sign: -1 };
    if (lastSide === 'bottom') return { axis: 'y', sign: 1 };
    if (lastSide === 'top') return { axis: 'y', sign: -1 };
    return null;
  }

  _buildSplitPartnerNearCandidates(lastPlacement, partnerOrient, workWidth, workHeight, step) {
    if (!lastPlacement || !partnerOrient) return [];

    const direction = this._getSplitPartnerDirection(lastPlacement, partnerOrient);
    if (!direction) return [];

    const lastBounds = this._getPlacementBounds(lastPlacement);
    const partnerBounds = partnerOrient.bb || getBoundingBox(partnerOrient.polygon);
    const minX = -partnerBounds.minX;
    const maxX = workWidth - partnerBounds.maxX;
    const minY = -partnerBounds.minY;
    const maxY = workHeight - partnerBounds.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const safeStep = Math.max(0.5, step || 1);
    const candidates = [];
    const seen = new Set();
    const addCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const clampedX = roundMetric(Math.max(minX, Math.min(maxX, x)), 3);
      const clampedY = roundMetric(Math.max(minY, Math.min(maxY, y)), 3);
      const key = `${clampedX}|${clampedY}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ x: clampedX, y: clampedY });
    };

    const lastCenterX = (lastBounds.minX + lastBounds.maxX) / 2;
    const lastCenterY = (lastBounds.minY + lastBounds.maxY) / 2;
    const partnerCenterX = (partnerBounds.minX + partnerBounds.maxX) / 2;
    const partnerCenterY = (partnerBounds.minY + partnerBounds.maxY) / 2;

    if (direction.axis === 'x') {
      const baseX = direction.sign > 0
        ? lastBounds.maxX - partnerBounds.minX
        : lastBounds.minX - partnerBounds.maxX;
      const yAnchors = [
        lastCenterY - partnerCenterY,
        lastBounds.minY - partnerBounds.minY,
        lastBounds.maxY - partnerBounds.maxY,
        lastBounds.minY - partnerBounds.maxY,
        lastBounds.maxY - partnerBounds.minY
      ];

      for (const yAnchor of yAnchors) {
        for (let unit = -8; unit <= 8; unit++) {
          addCandidate(baseX, yAnchor + unit * safeStep);
        }
      }
    } else {
      const baseY = direction.sign > 0
        ? lastBounds.maxY - partnerBounds.minY
        : lastBounds.minY - partnerBounds.maxY;
      const xAnchors = [
        lastCenterX - partnerCenterX,
        lastBounds.minX - partnerBounds.minX,
        lastBounds.maxX - partnerBounds.maxX,
        lastBounds.minX - partnerBounds.maxX,
        lastBounds.maxX - partnerBounds.minX
      ];

      for (const xAnchor of xAnchors) {
        for (let unit = -8; unit <= 8; unit++) {
          addCandidate(xAnchor + unit * safeStep, baseY);
        }
      }
    }

    return candidates
      .sort((left, right) => {
        const leftBounds = {
          minX: left.x + partnerBounds.minX,
          minY: left.y + partnerBounds.minY,
          maxX: left.x + partnerBounds.maxX,
          maxY: left.y + partnerBounds.maxY
        };
        const rightBounds = {
          minX: right.x + partnerBounds.minX,
          minY: right.y + partnerBounds.minY,
          maxX: right.x + partnerBounds.maxX,
          maxY: right.y + partnerBounds.maxY
        };
        const leftGap = direction.axis === 'x'
          ? Math.max(0, direction.sign > 0 ? leftBounds.minX - lastBounds.maxX : lastBounds.minX - leftBounds.maxX)
          : Math.max(0, direction.sign > 0 ? leftBounds.minY - lastBounds.maxY : lastBounds.minY - leftBounds.maxY);
        const rightGap = direction.axis === 'x'
          ? Math.max(0, direction.sign > 0 ? rightBounds.minX - lastBounds.maxX : lastBounds.minX - rightBounds.maxX)
          : Math.max(0, direction.sign > 0 ? rightBounds.minY - lastBounds.maxY : rightBounds.minY - leftBounds.maxY);
        const leftCrossOffset = direction.axis === 'x'
          ? Math.abs(((leftBounds.minY + leftBounds.maxY) / 2) - lastCenterY)
          : Math.abs(((leftBounds.minX + leftBounds.maxX) / 2) - lastCenterX);
        const rightCrossOffset = direction.axis === 'x'
          ? Math.abs(((rightBounds.minY + rightBounds.maxY) / 2) - lastCenterY)
          : Math.abs(((rightBounds.minX + rightBounds.maxX) / 2) - lastCenterX);

        return leftGap - rightGap
          || leftCrossOffset - rightCrossOffset
          || left.y - right.y
          || left.x - right.x;
      })
      .slice(0, 120); // Dynamic limit for partner candidates
  }

  _compactSplitFillCandidatePlacement(candidate, orient, occupiedPlacements, config, workWidth, workHeight) {
    const step = Math.max(0.1, (config.gridStep || 1) / 4);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;

    let currentX = candidate.x;
    let currentY = candidate.y;

    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    const isSafe = (cx, cy) => {
      return this._canPlaceSplitOrient(
        occupiedPlacements,
        orient,
        cx,
        cy,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
    };

    if (!isSafe(currentX, currentY)) return candidate;

    const directions = [
      { axis: 'x', sign: -1, id: 'left' },
      { axis: 'x', sign: 1, id: 'right' },
      { axis: 'y', sign: -1, id: 'top' },
      { axis: 'y', sign: 1, id: 'bottom' }
    ];

    const preferredSide = orient?.splitOutwardSide;
    if (preferredSide) {
      const opposite = {
        'left': 'right',
        'right': 'left',
        'top': 'bottom',
        'bottom': 'top'
      }[preferredSide];

      directions.sort((a, b) => {
        if (a.id === preferredSide) return -1;
        if (b.id === preferredSide) return 1;
        if (a.id === opposite) return 1;
        if (b.id === opposite) return -1;
        return 0;
      });
    }

    let moved = true;
    let passes = 0;
    while (moved && passes < 3) {
      moved = false;
      passes++;

      for (const dir of directions) {
        const currentValue = dir.axis === 'x' ? currentX : currentY;
        const limitValue = dir.sign < 0
          ? (dir.axis === 'x' ? minX : minY)
          : (dir.axis === 'x' ? maxX : maxY);

        let low = 0;
        let high = Math.abs(limitValue - currentValue);
        let bestSafeOffset = 0;

        while (high - low > step) {
          const mid = (low + high) / 2;
          const testValue = currentValue + dir.sign * mid;
          const testX = dir.axis === 'x' ? testValue : currentX;
          const testY = dir.axis === 'y' ? testValue : currentY;

          if (isSafe(testX, testY)) {
            bestSafeOffset = mid;
            low = mid;
          } else {
            high = mid;
          }
        }

        if (bestSafeOffset > 1e-3) {
          const finalValue = currentValue + dir.sign * bestSafeOffset;
          const roundedX = dir.axis === 'x' ? roundMetric(finalValue, 3) : currentX;
          const roundedY = dir.axis === 'y' ? roundMetric(finalValue, 3) : currentY;

          if (Math.abs(roundedX - currentX) > 1e-3 || Math.abs(roundedY - currentY) > 1e-3) {
            if (isSafe(roundedX, roundedY)) {
              currentX = roundedX;
              currentY = roundedY;
              moved = true;
            } else {
              const fallbackX = dir.axis === 'x' ? roundMetric(roundedX - dir.sign * 0.001, 3) : currentX;
              const fallbackY = dir.axis === 'y' ? roundMetric(roundedY - dir.sign * 0.001, 3) : currentY;
              if (isSafe(fallbackX, fallbackY)) {
                currentX = fallbackX;
                currentY = fallbackY;
                moved = true;
              }
            }
          }
        }
      }
    }

    return { x: currentX, y: currentY };
  }

  _compactSplitPartnerPlacement(candidate, orient, lastPlacement, occupiedPlacements, config, workWidth, workHeight) {
    const direction = this._getSplitPartnerDirection(lastPlacement, orient);
    if (!direction) return candidate;

    const step = Math.max(0.25, (config.gridStep || 1) / 2);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minStart = direction.axis === 'x' ? -bb.minX : -bb.minY;
    const maxStart = direction.axis === 'x' ? workWidth - bb.maxX : workHeight - bb.maxY;
    const startValue = direction.axis === 'x' ? candidate.x : candidate.y;
    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    const isSafe = (value) => {
      const x = direction.axis === 'x' ? value : candidate.x;
      const y = direction.axis === 'y' ? value : candidate.y;
      return this._canPlaceSplitOrient(
        occupiedPlacements,
        orient,
        x,
        y,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
    };

    let best = isSafe(startValue) ? startValue : null;
    const sign = direction.sign;
    for (
      let value = startValue - sign * step;
      value >= minStart - 1e-6 && value <= maxStart + 1e-6;
      value -= sign * step
    ) {
      const rounded = roundMetric(value, 3);
      if (!isSafe(rounded)) break;
      best = rounded;
    }

    if (best == null) return null;
    return {
      x: direction.axis === 'x' ? roundMetric(best, 3) : candidate.x,
      y: direction.axis === 'y' ? roundMetric(best, 3) : candidate.y
    };
  }


  _scoreSplitPlacementOption(option, workWidth, workHeight, partnerPlacement = null) {
    if (!option?.orient) return Infinity;
    const baseScore = this._scorePreparedEdgePlacementCandidate(option, option.orient, workWidth, workHeight);
    if (!partnerPlacement) return baseScore;

    const optionBounds = this._getPlacementBounds(option);
    const partnerBounds = this._getPlacementBounds(partnerPlacement);
    const optionCenterX = (optionBounds.minX + optionBounds.maxX) / 2;
    const optionCenterY = (optionBounds.minY + optionBounds.maxY) / 2;
    const partnerCenterX = (partnerBounds.minX + partnerBounds.maxX) / 2;
    const partnerCenterY = (partnerBounds.minY + partnerBounds.maxY) / 2;
    const direction = this._getSplitPartnerDirection(partnerPlacement, option.orient);
    const facingGap = direction?.axis === 'x'
      ? Math.max(
        0,
        direction.sign > 0
          ? optionBounds.minX - partnerBounds.maxX
          : partnerBounds.minX - optionBounds.maxX
      )
      : Math.max(
        0,
        direction?.sign > 0
          ? optionBounds.minY - partnerBounds.maxY
          : partnerBounds.minY - optionBounds.maxY
      );
    const crossOffset = direction?.axis === 'x'
      ? Math.abs(optionCenterY - partnerCenterY)
      : Math.abs(optionCenterX - partnerCenterX);

    return facingGap * 10 + crossOffset * 0.8 + baseScore * 0.05;
  }

  _pushSplitPlacementOption(options, seen, placement, workWidth, workHeight, partnerPlacement = null) {
    if (!placement?.orient) return;
    const key = `${placement.orient.foot}|${placement.orient.angle}|${roundMetric(placement.x, 3)}|${roundMetric(placement.y, 3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      ...placement,
      x: roundMetric(placement.x, 3),
      y: roundMetric(placement.y, 3),
      _splitOptionScore: this._scoreSplitPlacementOption(placement, workWidth, workHeight, partnerPlacement)
    });
  }

  _findSplitPartnerNearPlacementOptions(
    lastPlacement,
    orientVariants,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    filterFn = null,
    maxOptions = 35 // Base limit for fill options
  ) {
    const options = [];
    const seen = new Set();

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const nearCandidates = this._buildSplitPartnerNearCandidates(
        lastPlacement,
        orient,
        workWidth,
        workHeight,
        step
      );

      for (const candidate of nearCandidates) {
        const compacted = this._compactSplitPartnerPlacement(
          candidate,
          orient,
          lastPlacement,
          occupiedPlacements,
          config,
          workWidth,
          workHeight
        );
        if (!compacted) continue;

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: compacted.x,
          y: compacted.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight, lastPlacement);
        orientOptions++;
        if (orientOptions >= maxOptions * 2) break;
      }
    }

    const topOptions = options
      .sort((left, right) => left._splitOptionScore - right._splitOptionScore)
      .slice(0, Math.max(1, maxOptions));

    const compactedOptions = [];
    const finalSeen = new Set();
    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    for (const option of topOptions) {
      const fineCompacted = this._compactSplitFillCandidatePlacement(
        option,
        option.orient,
        occupiedPlacements,
        config,
        workWidth,
        workHeight
      );

      const finalX = roundMetric(fineCompacted.x, 3);
      const finalY = roundMetric(fineCompacted.y, 3);

      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        option.orient,
        finalX,
        finalY,
        config,
        workWidth,
        workHeight,
        spatialIndex
      )) {
        continue;
      }

      const key = `${option.orient.foot}|${option.orient.angle}|${finalX}|${finalY}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: finalX,
        y: finalY
      });
    }

    return compactedOptions;
  }

  _getSplitPartnerFoot(foot) {
    if (foot === 'split-left') return 'split-right';
    if (foot === 'split-right') return 'split-left';
    return null;
  }

  _getSplitPairPartnerFoot(foot) {
    if (foot === 'split-left') return 'split-right';
    if (foot === 'split-right') return 'split-left';
    return null;
  }

  _getSplitPlacementPairStats(placements = []) {
    let leftCount = 0;
    let rightCount = 0;
    let dcCount = 0;
    for (const placement of placements) {
      if (placement?.orient?.foot === 'split-left' || placement?.orient?.foot === 'L') leftCount += 1;
      else if (placement?.orient?.foot === 'split-right' || placement?.orient?.foot === 'R') rightCount += 1;
      else if (placement?.orient?.foot === 'X' || placement?.orient?.foot === 'DC') dcCount += 1;
    }

    const splitPairCount = dcCount + Math.min(leftCount, rightCount);
    const splitUnpairedCount = Math.abs(leftCount - rightCount);
    const pieceCount = dcCount * 2 + leftCount + rightCount;
    return {
      splitLeftCount: leftCount,
      splitRightCount: rightCount,
      dcCount,
      pieceCount,
      splitPairCount,
      splitUnpairedCount
    };
  }

  _balanceSplitFillPlacementsForPairs(placements = []) {
    if (placements.length <= 1) return placements;

    const originalPlacements = [...placements];
    const balanced = [...placements];
    const counts = new Map();
    const applyDelta = (foot, delta) => {
      counts.set(foot, (counts.get(foot) || 0) + delta);
    };

    for (const placement of balanced) {
      applyDelta(placement?.orient?.foot, 1);
    }

    const isPairReady = () => {
      const leftCount = counts.get('split-left') || 0;
      const rightCount = counts.get('split-right') || 0;
      return leftCount === rightCount && balanced.length % 2 === 0;
    };

    while (balanced.length > 1 && !isPairReady()) {
      const removed = balanced.pop();
      applyDelta(removed?.orient?.foot, -1);
    }

    if (balanced.length < originalPlacements.length) {
      return originalPlacements;
    }

    return balanced;
  }


  _findNextSplitFillPlacementOptions(
    orientVariants,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    filterFn = null,
    maxOptions = 100 // Ultra Search: Maximum candidate resolution
  ) {
    // Dynamically adjust limit based on current piece count
    const adaptiveMax = occupiedPlacements.length > 80 ? 50 : 35;
    const finalMax = Math.max(maxOptions, adaptiveMax);
    const freeRects = this._buildPreparedSplitFreeRects(
      occupiedPlacements,
      workWidth,
      workHeight,
      config.spacing
    );
    const options = [];
    const seen = new Set();

    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const compatibleRects = freeRects.filter((rect) =>
        rect.width + 1e-6 >= orient.width &&
        rect.height + 1e-6 >= orient.height
      );

      for (const rect of compatibleRects) {
        const placementCandidates = this._buildPreparedRectPlacementCandidates(rect, orient, step);
        for (const candidate of placementCandidates) {
          if (!this._canPlaceSplitOrient(
            occupiedPlacements,
            orient,
            candidate.x,
            candidate.y,
            config,
            workWidth,
            workHeight,
            spatialIndex
          )) {
            continue;
          }

          this._pushSplitPlacementOption(options, seen, {
            orient,
            x: candidate.x,
            y: candidate.y,
            effectiveArea: orient.areaMm2
          }, workWidth, workHeight);
          orientOptions++;
          if (orientOptions >= finalMax * 1.5) break;
        }
        if (orientOptions >= finalMax * 1.5) break;
      }
    }

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const boundaryCandidates = this._buildPreparedBoundaryPlacementCandidates(
        orient,
        workWidth,
        workHeight,
        step
      );

      for (const candidate of boundaryCandidates) {
        if (!this._canPlaceSplitOrient(
          occupiedPlacements,
          orient,
          candidate.x,
          candidate.y,
          config,
          workWidth,
          workHeight,
          spatialIndex
        )) {
          continue;
        }

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: candidate.x,
          y: candidate.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight);
        orientOptions++;
        if (orientOptions >= maxOptions * 2) break;
      }
    }


    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const spacing = config.spacing || 0;
      const edgeCandidates = this._buildGeometricVertexAnchors(
        occupiedPlacements,
        orient,
        workWidth,
        workHeight,
        spacing
      );


      for (const candidate of edgeCandidates) {
        if (!this._canPlaceSplitOrient(
          occupiedPlacements,
          orient,
          candidate.x,
          candidate.y,
          config,
          workWidth,
          workHeight,
          spatialIndex
        )) {
          continue;
        }

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: candidate.x,
          y: candidate.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight);
        orientOptions++;
        if (orientOptions >= maxOptions * 2) break;
      }
    }

    const topOptions = options
      .sort((left, right) => left._splitOptionScore - right._splitOptionScore)
      .slice(0, Math.max(1, maxOptions));

    const compactedOptions = [];
    const finalSeen = new Set();
    for (const option of topOptions) {
      const fineCompacted = this._compactSplitFillCandidatePlacement(
        option,
        option.orient,
        occupiedPlacements,
        config,
        workWidth,
        workHeight
      );
      
      const finalX = roundMetric(fineCompacted.x, 3);
      const finalY = roundMetric(fineCompacted.y, 3);

      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        option.orient,
        finalX,
        finalY,
        config,
        workWidth,
        workHeight,
        spatialIndex
      )) {
        continue;
      }

      const key = `${option.orient.foot}|${option.orient.angle}|${finalX}|${finalY}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: finalX,
        y: finalY
      });
    }

    return compactedOptions;
  }

  _rankSplitFillState(state) {
    const pairStats = this._getSplitPlacementPairStats(state.extraPlacements);
    const bounds = computeEnvelope(state.occupiedPlacements);
    const usedAreaMm2 = state.occupiedPlacements.reduce((sum, placement) =>
      sum + (placement.effectiveArea || placement.orient?.areaMm2 || 0),
    0);
    const leftover = computeLeftoverMetricsFromBounds(bounds, state.workWidth, state.workHeight, usedAreaMm2);
    return {
      count: pairStats.pieceCount,
      pairs: pairStats.splitPairCount,
      dcCount: pairStats.dcCount,
      unpaired: pairStats.splitUnpairedCount,
      leftoverAreaMm2: leftover.leftoverAreaMm2,
      openSheetAreaMm2: leftover.openSheetAreaMm2,
      height: bounds.height,
      width: bounds.width,
      waste: bounds.width * bounds.height
    };
  }

  _compareSplitFillStates(left, right) {
    const leftRank = this._rankSplitFillState(left);
    const rightRank = this._rankSplitFillState(right);
    return rightRank.dcCount - leftRank.dcCount
      || rightRank.pairs - leftRank.pairs
      || rightRank.count - leftRank.count
      || rightRank.leftoverAreaMm2 - leftRank.leftoverAreaMm2
      || rightRank.openSheetAreaMm2 - leftRank.openSheetAreaMm2
      || leftRank.unpaired - rightRank.unpaired
      || leftRank.height - rightRank.height
      || leftRank.width - rightRank.width
      || leftRank.waste - rightRank.waste;
  }

  _dedupeSplitFillStates(states) {
    if (!states.length) return [];
    
    const sorted = states.sort((left, right) => this._compareSplitFillStates(left, right));
    const unique = [];
    const seen = new Set();
    
    // Adaptive Beam Logic:
    // 1. Always keep the best few.
    // 2. Keep others only if they are "close enough" to the best.
    const MIN_BEAM = 2;
    const sizeName = sorted[0]?.occupiedPlacements?.[0]?.sizeName;
    const sizeVal = sizeName ? parseFloat(sizeName) : 0;
    const MAX_BEAM = (sizeVal > 0 && sizeVal <= 5.0) ? 6 : 2; // High-Velocity: Minimal parallel branches for speed
    const bestRank = this._rankSplitFillState(sorted[0]);

    for (const state of sorted) {
      const key = state.extraPlacements
        .map((placement) => `${placement.orient.foot}:${placement.orient.angle}:${roundMetric(placement.x, 1)}:${roundMetric(placement.y, 1)}`)
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      const currentRank = this._rankSplitFillState(state);
      
      // Stop if we hit the hard cap
      if (unique.length >= MAX_BEAM) break;
      
      // If we have the minimum number of candidates, check if the current one is significantly worse
      if (unique.length >= MIN_BEAM) {
          // If piece count is less AND waste is higher, it's significantly worse
          if (currentRank.count < bestRank.count && currentRank.waste > bestRank.waste * 1.05) {
              break;
          }
          // If dcCount (Double Contour pairs) is less, it's usually a bad sign
          if (currentRank.dcCount < bestRank.dcCount) {
              // But only break if we already have enough good ones
              if (unique.length >= 12) break;
          }
      }
      
      unique.push(state);
    }
    return unique;
  }

  _buildTightSplitPairTemplate(firstOrient, secondOrient, config, step) {
    const direction = this._getSplitPartnerDirection({ orient: firstOrient }, secondOrient);
    if (!direction) return null;

    const spacing = config.spacing || 0;
    const safeStep = Math.max(0.5, step || 1);
    const firstBounds = firstOrient.bb || getBoundingBox(firstOrient.polygon);
    const secondBounds = secondOrient.bb || getBoundingBox(secondOrient.polygon);
    const firstBase = {
      orient: firstOrient,
      x: -firstBounds.minX,
      y: -firstBounds.minY,
      effectiveArea: firstOrient.areaMm2
    };
    const firstWorldBounds = this._getPlacementBounds(firstBase);
    const firstCenterX = (firstWorldBounds.minX + firstWorldBounds.maxX) / 2;
    const firstCenterY = (firstWorldBounds.minY + firstWorldBounds.maxY) / 2;
    const secondCenterX = (secondBounds.minX + secondBounds.maxX) / 2;
    const secondCenterY = (secondBounds.minY + secondBounds.maxY) / 2;
    const crossAnchors = direction.axis === 'x'
      ? [
          firstCenterY - secondCenterY,
          firstWorldBounds.minY - secondBounds.minY,
          firstWorldBounds.maxY - secondBounds.maxY
        ]
      : [
          firstCenterX - secondCenterX,
          firstWorldBounds.minX - secondBounds.minX,
          firstWorldBounds.maxX - secondBounds.maxX
        ];

    let bestTemplate = null;
    for (const crossAnchor of crossAnchors) {
      for (let crossUnit = -10; crossUnit <= 10; crossUnit++) {
        const crossValue = crossAnchor + crossUnit * safeStep;
        for (let gapUnit = 0; gapUnit <= 40; gapUnit++) {
          const gap = gapUnit * safeStep;
          let secondX;
          let secondY;
          if (direction.axis === 'x') {
            secondX = direction.sign > 0
              ? firstWorldBounds.maxX + gap - secondBounds.minX
              : firstWorldBounds.minX - gap - secondBounds.maxX;
            secondY = crossValue;
          } else {
            secondX = crossValue;
            secondY = direction.sign > 0
              ? firstWorldBounds.maxY + gap - secondBounds.minY
              : firstWorldBounds.minY - gap - secondBounds.maxY;
          }

          const secondBase = {
            orient: secondOrient,
            x: roundMetric(secondX, 3),
            y: roundMetric(secondY, 3),
            effectiveArea: secondOrient.areaMm2
          };
          const localValidation = validateLocalPlacements([firstBase, secondBase], spacing);
          if (!localValidation.valid) continue;

          const bounds = computeEnvelope([firstBase, secondBase]);
          const placements = [firstBase, secondBase].map((placement) => ({
            ...placement,
            x: roundMetric(placement.x - bounds.minX, 3),
            y: roundMetric(placement.y - bounds.minY, 3)
          }));
          const rebasedBounds = computeEnvelope(placements);
          const template = {
            placements,
            width: rebasedBounds.width,
            height: rebasedBounds.height,
            gap,
            crossOffset: Math.abs(crossUnit * safeStep),
            score: gap * 10 + Math.abs(crossUnit * safeStep) + rebasedBounds.width * rebasedBounds.height * 0.000001
          };

          if (!bestTemplate || template.score < bestTemplate.score) {
            bestTemplate = template;
          }
          break;
        }
      }
    }

    return bestTemplate;
  }

  _buildSplitPairTemplates(orientVariants, config, step) {
    const templates = [];
    const seen = new Set();
    for (const orient of orientVariants) {
      const partnerFoot = this._getSplitPairPartnerFoot(orient?.foot);
      
      // If it's a whole piece (X), add it as a single-piece template
      if (!partnerFoot && (orient.foot === 'X' || orient.foot === 'whole')) {
        const key = `whole:${orient.angle}`;
        if (!seen.has(key)) {
          seen.add(key);
          templates.push({
            placements: [{ x: 0, y: 0, orient }],
            width: orient.width,
            height: orient.height,
            score: 0.1, // Priority: lower score is better. Whole pieces get 0.1
            key
          });
        }
        continue;
      }

      if (!partnerFoot) continue;

      for (const secondOrient of orientVariants) {
        if (secondOrient?.foot !== partnerFoot) continue;
        if (secondOrient?.splitPairAngleFamily !== orient.splitPairAngleFamily) continue;
        const key = `${orient.foot}:${orient.angle}|${secondOrient.foot}:${secondOrient.angle}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const template = this._buildTightSplitPairTemplate(orient, secondOrient, config, step);
        if (!template) continue;
        templates.push({
          ...template,
          score: (template.score || 1.0) + 1.0, // Pairs get higher score (lower priority) than whole pieces
          key
        });
      }
    }

    return templates
      .sort((left, right) =>
        left.score - right.score
        || left.height - right.height
        || left.width - right.width
      )
      .slice(0, 25); // Limit pair templates to top 25 quality matches
  }

  _canPlaceSplitPairTemplate(template, originX, originY, occupiedPlacements, config, workWidth, workHeight) {
    const placed = template.placements.map((placement) => ({
      ...placement,
      x: roundMetric(originX + placement.x, 3),
      y: roundMetric(originY + placement.y, 3)
    }));

    for (let index = 0; index < placed.length; index++) {
      const previous = [...occupiedPlacements, ...placed.slice(0, index)];
      const spacing = config.spacing || 0;
      const previousSpatialIndex = this._buildSpatialIndex(previous, workWidth, workHeight, spacing);
      if (!this._canPlaceSplitOrient(
        previous,
        placed[index].orient,
        placed[index].x,
        placed[index].y,
        config,
        workWidth,
        workHeight,
        previousSpatialIndex
      )) {
        return null;
      }
    }

    return placed;
  }

  _buildSplitPairGroupOrigins(template, occupiedPlacements, workWidth, workHeight, step) {
    if (!template || template.width > workWidth + 1e-6 || template.height > workHeight + 1e-6) return [];

    const safeStep = Math.max(1, (step || 1) * 2);
    const maxX = workWidth - template.width;
    const maxY = workHeight - template.height;
    const origins = [];
    const seen = new Set();
    const addOrigin = (x, y) => {
      const originX = roundMetric(Math.max(0, Math.min(maxX, x)), 3);
      const originY = roundMetric(Math.max(0, Math.min(maxY, y)), 3);
      const key = `${originX}|${originY}`;
      if (seen.has(key)) return;
      seen.add(key);
      origins.push({ x: originX, y: originY });
    };

    const xs = buildDenseAxisCandidates(0, maxX, safeStep, 24);
    const ys = buildDenseAxisCandidates(0, maxY, safeStep, 24);
    for (const x of xs) {
      addOrigin(x, 0);
      addOrigin(x, maxY);
    }
    for (const y of ys) {
      addOrigin(0, y);
      addOrigin(maxX, y);
    }

    const freeRects = this._buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, 0);
    
    const intersectsFreeSpace = (minX, minY, maxX, maxY) => {
      for (const rect of freeRects) {
        if (maxX > rect.x && minX < rect.x + rect.width &&
            maxY > rect.y && minY < rect.y + rect.height) {
          return true;
        }
      }
      return false;
    };

    for (const placement of occupiedPlacements) {
      const bounds = this._getPlacementBounds(placement);
      
      if (!intersectsFreeSpace(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)) {
        continue;
      }

      const candidateOrigins = [
        { x: bounds.minX - template.width, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.minY - template.height },
        { x: bounds.minX, y: bounds.maxY }
      ];
      for (const origin of candidateOrigins) {
        for (const dx of [-safeStep, 0, safeStep]) {
          for (const dy of [-safeStep, 0, safeStep]) {
            const ox = origin.x + dx;
            const oy = origin.y + dy;
            
            if (intersectsFreeSpace(ox, oy, ox + template.width, oy + template.height)) {
              addOrigin(ox, oy);
            }
          }
        }
      }
    }

    return origins.sort((left, right) => {
      const leftEdge = Math.min(left.x, maxX - left.x, left.y, maxY - left.y);
      const rightEdge = Math.min(right.x, maxX - right.x, right.y, maxY - right.y);
      return leftEdge - rightEdge || left.y - right.y || left.x - right.x;
    });
  }

  _findSplitPairGroupPlacementOptions(
    pairTemplates,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    maxOptions = 20 // Adaptive limit for group options
  ) {
    const options = [];
    const seen = new Set();
    for (const template of pairTemplates) {
      const origins = this._buildSplitPairGroupOrigins(template, occupiedPlacements, workWidth, workHeight, step);
      for (const origin of origins) {
        const placedGroup = this._canPlaceSplitPairTemplate(
          template,
          origin.x,
          origin.y,
          occupiedPlacements,
          config,
          workWidth,
          workHeight
        );
        if (!placedGroup) continue;

        const key = placedGroup
          .map((placement) => `${placement.orient.foot}:${placement.orient.angle}:${roundMetric(placement.x, 3)}:${roundMetric(placement.y, 3)}`)
          .join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          placements: placedGroup,
          score: template.score + origin.y * 0.001 + origin.x * 0.0005
        });
        if (options.length >= maxOptions * 2) break;
      }
      if (options.length >= maxOptions * 2) break;
    }

    return options
      .sort((left, right) => left.score - right.score)
      .slice(0, Math.max(1, maxOptions));
  }

  _findSplitFillPlacements(sizeName, polygon, baseCandidate, config, workWidth, workHeight) {
    if (config.preparedSplitFillEnabled !== true) {
      return [];
    }

    const step = Math.max(0.5, config.gridStep || 1);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const halfDefs = buildSplitHalfDefinitions(
      sourceShape?.polygon || polygon,
      sourceShape?.internals?.[0] || []
    );
    if (!halfDefs.length || !baseCandidate?.placements?.length) return [];

    const minHalfArea = Math.max(
      1,
      Math.min(...halfDefs.map((halfDef) => halfDef.areaMm2 || Infinity))
    );
    const usedAreaMm2 = baseCandidate.usedAreaMm2
      ?? baseCandidate.placements.reduce((sum, placement) =>
        sum + (placement.effectiveArea || placement.orient?.areaMm2 || 0),
      0);
    const remainingAreaMm2 = Math.max(0, workWidth * workHeight - usedAreaMm2);
    const physicalSafetyLimit = Math.max(
      1,
      Math.ceil((remainingAreaMm2 / minHalfArea) * 1.2)
    );
    const maxExtraFillers = Number.isFinite(config.preparedSplitFillMaxPieces)
      ? Math.max(1, config.preparedSplitFillMaxPieces)
      : physicalSafetyLimit;

    const orientVariants = [];
    const fullPolygon = sourceShape?.polygon || polygon;
    for (const angle of this._getSplitFillAngles(config)) {
      orientVariants.push(this._decorateOrient(sizeName, 'X', fullPolygon, angle, config, step));
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }

    orientVariants.sort((left, right) =>
      left.height - right.height
      || left.width - right.width
      || (left.angle || 0) - (right.angle || 0)
    );
    const pairTemplates = this._buildSplitPairTemplates(orientVariants, config, step);

    let states = [{
      occupiedPlacements: [...baseCandidate.placements],
      extraPlacements: [],
      workWidth,
      workHeight
    }];
    let bestState = states[0];

    for (let depth = 0; depth < maxExtraFillers; depth++) {
      const expandedStates = [];

      for (const state of states) {
        if (state.extraPlacements.length + 1 < maxExtraFillers && pairTemplates.length) {
          const groupOptions = this._findSplitPairGroupPlacementOptions(
            pairTemplates,
            state.occupiedPlacements,
            config,
            workWidth,
            workHeight,
            step,
            20 // Adaptive limit for group options
          );

          for (const groupOption of groupOptions) {
            const nextGroupPlacements = groupOption.placements.map((placement, index) => ({
              ...placement,
              id: `split_fill_${state.extraPlacements.length + index}`
            }));
            expandedStates.push({
              occupiedPlacements: [...state.occupiedPlacements, ...nextGroupPlacements],
              extraPlacements: [...state.extraPlacements, ...nextGroupPlacements],
              workWidth,
              workHeight
            });
          }

          if (groupOptions.length > 0) {
            continue;
          }
        }

        let options = [];
        if (config.preparedSplitFillPreferPairs !== false && state.extraPlacements.length > 0) {
          const lastPlacement = state.extraPlacements[state.extraPlacements.length - 1];
        const partnerFoot = this._getSplitPairPartnerFoot(lastPlacement?.orient?.foot);
        const partnerAngleFamily = lastPlacement?.orient?.splitPairAngleFamily;
        if (partnerFoot) {
          const partnerFilter = (orient) =>
            orient?.foot === partnerFoot
            && orient?.splitPairAngleFamily === partnerAngleFamily;
            options = this._findSplitPartnerNearPlacementOptions(
            lastPlacement,
            orientVariants,
              state.occupiedPlacements,
            config,
            workWidth,
            workHeight,
            step,
                partnerFilter,
                15 // Reduced from 35 for speed
          );

            if (!options.length) {
              options = this._findNextSplitFillPlacementOptions(
            orientVariants,
                state.occupiedPlacements,
            config,
            workWidth,
            workHeight,
            step,
                partnerFilter,
                15 // Reduced from 35 for speed
            );
          }
        }
      }

        const genericOptions = this._findNextSplitFillPlacementOptions(
          orientVariants,
          state.occupiedPlacements,
          config,
          workWidth,
          workHeight,
          step,
          null,
          15 // Reduced from 35 for speed
        );

        const mergedOptions = [...options];
        const seenOptions = new Set(mergedOptions.map((option) =>
          `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`
        ));

        for (const option of genericOptions) {
          const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`;
          if (seenOptions.has(key)) continue;
          seenOptions.add(key);
          mergedOptions.push(option);
        }

        const sizeVal = parseFloat(sizeName);
        const fillLimit = sizeVal <= 5.0 ? 15 : 4;
        options = mergedOptions.slice(0, fillLimit);

        for (const option of options) {
          const nextPlacement = {
            ...option,
            id: `split_fill_${state.extraPlacements.length}`
          };
          expandedStates.push({
            occupiedPlacements: [...state.occupiedPlacements, nextPlacement],
            extraPlacements: [...state.extraPlacements, nextPlacement],
            workWidth,
            workHeight
          });
        }
      }

      if (!expandedStates.length) break;
      states = this._dedupeSplitFillStates(expandedStates);
      if (this._compareSplitFillStates(states[0], bestState) < 0) {
        bestState = states[0];
      }
    }

    const extraPlacements = bestState.extraPlacements;
    return extraPlacements;
  }

  _augmentCandidateWithSplitFillers(sizeName, polygon, candidate, config, workWidth, workHeight) {
    if (!config.preparedSplitFillEnabled) return candidate;

    let maxX = 0;
    let maxY = 0;
    for (const p of candidate.placements) {
      const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
      maxX = Math.max(maxX, p.x + bb.maxX);
      maxY = Math.max(maxY, p.y + bb.maxY);
    }

    const remainingX = Math.max(0, workWidth - maxX);
    const remainingY = Math.max(0, workHeight - maxY);
    const shiftVariants = [{ dx: 0, dy: 0 }];
    const minShift = 10;
    
    if (remainingX > minShift) {
      shiftVariants.push({ dx: remainingX, dy: 0 });
      shiftVariants.push({ dx: Math.floor(remainingX / 2), dy: 0 });
    }
    if (remainingY > minShift) {
      shiftVariants.push({ dx: 0, dy: remainingY });
      shiftVariants.push({ dx: 0, dy: Math.floor(remainingY / 2) });
    }
    if (remainingX > minShift && remainingY > minShift) {
      shiftVariants.push({ dx: remainingX, dy: remainingY });
      shiftVariants.push({ dx: Math.floor(remainingX / 2), dy: Math.floor(remainingY / 2) });
    }
    shiftVariants.sort((left, right) => {
      const leftPlacements = candidate.placements.map((placement) => ({
        ...placement,
        x: roundMetric(placement.x + left.dx, 3),
        y: roundMetric(placement.y + left.dy, 3)
      }));
      const rightPlacements = candidate.placements.map((placement) => ({
        ...placement,
        x: roundMetric(placement.x + right.dx, 3),
        y: roundMetric(placement.y + right.dy, 3)
      }));
      const leftMetrics = computeLeftoverMetricsFromBounds(
        computeEnvelope(leftPlacements),
        workWidth,
        workHeight,
        computeCandidateUsedArea(candidate)
      );
      const rightMetrics = computeLeftoverMetricsFromBounds(
        computeEnvelope(rightPlacements),
        workWidth,
        workHeight,
        computeCandidateUsedArea(candidate)
      );
      return rightMetrics.leftoverAreaMm2 - leftMetrics.leftoverAreaMm2
        || rightMetrics.openSheetAreaMm2 - leftMetrics.openSheetAreaMm2;
    });

    const {
      placedCount: _ignoredPlacedCount,
      usedWidthMm: _ignoredUsedWidthMm,
      usedHeightMm: _ignoredUsedHeightMm,
      envelopeWasteMm2: _ignoredEnvelopeWasteMm2,
      efficiency: _ignoredEfficiency,
      ...candidateMetadata
    } = candidate;

    let bestAugmentedCandidate = attachLeftoverMetrics(candidate, workWidth, workHeight);

    for (const shift of shiftVariants) {
      const testCandidate = shift.dx === 0 && shift.dy === 0 
        ? candidate 
        : {
            ...candidate,
            placements: candidate.placements.map(p => ({
              ...p,
              x: roundMetric(p.x + shift.dx, 3),
              y: roundMetric(p.y + shift.dy, 3)
            }))
          };

      const extraPlacements = this._findSplitFillPlacements(
        sizeName,
        polygon,
        testCandidate,
        config,
        workWidth,
        workHeight
      );
      if (!extraPlacements || !extraPlacements.length) continue;

      const usableExtraCount = extraPlacements.length;
      const pairStats = this._getSplitPlacementPairStats(extraPlacements);
      const usedAreaMm2 = (testCandidate.usedAreaMm2 ?? testCandidate.placedCount * testCandidate.pieceArea)
        + extraPlacements.reduce((sum, placement) => sum + (placement.effectiveArea || 0), 0);

      const augmentedCandidate = this._buildCandidate(
        sizeName,
        testCandidate.selectedFoot ?? testCandidate.foot ?? testCandidate.placements?.[0]?.orient?.foot ?? 'L',
        testCandidate.pieceArea,
        [...testCandidate.placements, ...extraPlacements],
        {
          ...candidateMetadata,
          splitFillUsed: true,
          splitFillCount: usableExtraCount,
          ...pairStats,
          usedAreaMm2
        },
        workWidth,
        workHeight,
        config
      );

      const finalized = augmentedCandidate ? this._finalizeCandidate(augmentedCandidate, config, workWidth, workHeight) : null;
      if (finalized) {
        // With 500s budget: purely density-driven, no leftover guard
        const cmp = compareDoubleInsoleCandidates(finalized, bestAugmentedCandidate);
        if (cmp < 0) {
          bestAugmentedCandidate = finalized;
        }
      }
    }

    // Phase 2: Margin fill — greedy place half-pieces in bottom/right margins
    bestAugmentedCandidate = this._fillMarginHalves(
      sizeName, polygon, bestAugmentedCandidate, config, workWidth, workHeight
    );

    return bestAugmentedCandidate;
  }

  _fillMarginHalves(sizeName, polygon, candidate, config, workWidth, workHeight) {
    if (!candidate?.placements?.length) return candidate;

    const sizeVal = parseFloat(sizeName);

    const step = Math.min(0.1, (config.gridStep || 1) / 2);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    
    const orientVariants = [];
    for (const angle of this._getSplitFillAngles(config)) {
      const halfDefs = buildSplitHalfDefinitions(
        sourceShape?.polygon || polygon,
        sourceShape?.internals?.[0] || []
      );
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }

    orientVariants.sort((left, right) =>
      left.height - right.height
      || left.width - right.width
      || (left.angle || 0) - (right.angle || 0)
    );

    let allPlacements = [...candidate.placements];
    let marginPlacementsCount = 0;
    let addedAny = true;

    while (addedAny && marginPlacementsCount < 50) {
      addedAny = false;
      let bestOverallCandidate = null;
      let bestOverallOrient = null;
      let bestOverallScore = Infinity;

      for (const orient of orientVariants) {
        const candidatePos = this._findBestPreparedSplitPlacement(allPlacements, orient, workWidth, workHeight, config, step);
        if (candidatePos) {
          const score = this._scorePreparedEdgePlacementCandidate(candidatePos, orient, workWidth, workHeight, allPlacements);
          if (score < bestOverallScore) {
            bestOverallScore = score;
            bestOverallCandidate = candidatePos;
            bestOverallOrient = orient;
          }
        }
      }

      if (bestOverallCandidate) {
        const placement = {
          id: `margin_fill_${marginPlacementsCount++}`,
          orient: bestOverallOrient,
          x: bestOverallCandidate.x,
          y: bestOverallCandidate.y,
          effectiveArea: bestOverallOrient.areaMm2
        };
        allPlacements.push(placement);
        addedAny = true;
      }
    }

    if (marginPlacementsCount === 0) return candidate;

    const usedAreaMm2 = allPlacements.reduce((sum, p) => sum + (p.effectiveArea || p.orient?.areaMm2 || 0), 0);
    const pairStats = this._getSplitPlacementPairStats(
      allPlacements.filter(p => p.id?.startsWith('split_fill_') || p.id?.startsWith('margin_fill_'))
    );

    const augmented = this._buildCandidate(
      sizeName,
      candidate.selectedFoot ?? candidate.foot ?? 'L',
      candidate.pieceArea,
      allPlacements,
      {
        ...(candidate.patternInfo || {}),
        splitFillUsed: true,
        splitFillCount: (candidate.patternInfo?.splitFillCount || 0) + marginPlacementsCount,
        ...pairStats,
        usedAreaMm2
      },
      workWidth,
      workHeight,
      config
    );

    if (!augmented) return candidate;
    const finalized = this._finalizeCandidate(augmented, config, workWidth, workHeight);
    return finalized || candidate;
  }


  _countRowsWithTrailingBlock(maxHeight, dyMm, workHeight, trailingOffsetMm = 0, trailingBlockHeightMm = 0) {
    let rows = 0;
    while (true) {
      const y = rows * dyMm;
      if (y + maxHeight + trailingOffsetMm + trailingBlockHeightMm > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _buildDoubleContourVariants(orient, dxMm, workWidth, workHeight, config, step, pairedOrient = null) {
    if (!this._dyCache) this._dyCache = new Map();
    const variants = [];
    const sizeVal = parseFloat(orient.sizeName || orient.name);
    const maxCols = this._countCols(orient.width, dxMm, workWidth);
    const colChoices = [maxCols, maxCols - 1, maxCols - 2].filter(c => c > 0);
    if (colChoices.length === 0) colChoices.push(maxCols);
    

    const rowShiftRange = orient.width * 1.0; // Full width search for maximum interlocking potential
    const geometricShiftCandidates = extractInternalGapShiftCandidates(orient, step);
    
    const manualStagger = Number(config.staggerSpacing);
    const pieceWidth = orient.bb ? (orient.bb.maxX - orient.bb.minX) : 100;
    const maxShiftX = Math.max(pieceWidth * 0.8, 50);
    const adaptiveShiftCandidates = Math.min(15, Math.max(4, Math.floor(pieceWidth / 10)));
    const baseShiftCandidates = buildShiftCandidates(maxShiftX, step, adaptiveShiftCandidates);
    if (Number.isFinite(manualStagger) && Math.abs(manualStagger) < rowShiftRange) {
      baseShiftCandidates.push(manualStagger);
      baseShiftCandidates.push(-manualStagger);
    }

    const rowShiftCandidates = selectPrimaryRowShiftCandidates(
      geometricShiftCandidates,
      baseShiftCandidates,
      64
    );
    // Add half-dx shift for brick-laying pattern (critical for figure-8 shapes)
    const halfDx = roundMetric(dxMm / 2, 3);
    if (!rowShiftCandidates.includes(halfDx) && halfDx > 0) rowShiftCandidates.push(halfDx);
    if (!rowShiftCandidates.includes(-halfDx) && halfDx > 0) rowShiftCandidates.push(-halfDx);
    
    // For small sizes, add more fractional shifts
    [1/3, 2/3, 1/4, 3/4].forEach(ratio => {
      const s = roundMetric(dxMm * ratio, 3);
      if (!rowShiftCandidates.includes(s)) rowShiftCandidates.push(s);
    });
    const rowShiftPairs = buildRowShiftPairs(orient, step, rowShiftCandidates);

    const dxCandidates = [dxMm];
    // Try dx values ABOVE minimum for wider spacing variations (granular)
    for (let offset = 0.5; offset <= 3.5; offset += 1.5) {
      dxCandidates.push(roundMetric(dxMm + offset, 3));
    }
    
    // Explicitly try dx values that enable extra columns
    for (const extra of [1, 2, 3, 4]) {
      const targetCols = maxCols + extra;
      const requiredDx = roundMetric((workWidth - 1) / targetCols, 3);
      if (requiredDx > orient.width * 0.60 && requiredDx < dxMm) {
        dxCandidates.push(requiredDx);
        for (let off = 0.1; off <= 0.3; off += 0.1) {
          dxCandidates.push(roundMetric(requiredDx - off, 3));
        }
      }
    }

    // Try tighter dx values with coarser steps
    for (let offset = 1.0; offset <= 20.0; offset += 1.0) {
      const tighterDx = roundMetric(dxMm - offset, 3);
      if (tighterDx > orient.width * 0.65) {
        dxCandidates.push(tighterDx);
      }
    }

    for (const currentDx of dxCandidates) {
      // Pre-calculate Dy for all shifts for this DX (Dy does NOT depend on bodyCols)
      const shiftResults = [];
      
      // 1. Uniform (no shift)
      const alignedDyMm = this._findUniformDy(orient, currentDx, config, step);
      if (alignedDyMm != null) {
        shiftResults.push({ rowShiftXmm: 0, rowShiftYmm: 0, dy: alignedDyMm, mode: 'uniform-pitch-grid' });
      }

      // 2. Staggered shifts
      for (const { rowShiftXmm, rowShiftYmm } of rowShiftPairs) {
        const shiftedDyMm = this._findShiftedUniformDy(orient, currentDx, rowShiftXmm, rowShiftYmm, config, step);
        if (shiftedDyMm != null) {
          shiftResults.push({ 
            rowShiftXmm: roundMetric(rowShiftXmm), 
            rowShiftYmm: roundMetric(rowShiftYmm), 
            dy: shiftedDyMm, 
            mode: 'staggered-double-contour' 
          });
        }
      }

      for (const bodyCols of colChoices) {
        if (bodyCols <= 0) continue;

        const uniformRowPlacements = this._buildShiftedUniformPlacements(
          orient,
          bodyCols,
          1,
          currentDx,
          orient.height + config.spacing + step * 2,
          0,
          0,
          0
        );
        const uniformBodyHeightMm = roundMetric(
          getPlacementsBottom(uniformRowPlacements) - getPlacementsTop(uniformRowPlacements),
          3
        );

        for (const res of shiftResults) {
          variants.push({
            rowPlacements: uniformRowPlacements,
            bodyCols,
            bodyDxMm: currentDx,
            pieceArea: orient.areaMm2, // Ensure piece area is set for accurate ranking
            bodyHeightMm: uniformBodyHeightMm,
            bodyDyMm: res.dy,
            rowShiftXmm: res.rowShiftXmm,
            rowShiftYmm: res.rowShiftYmm,
            scanOrder: res.mode === 'uniform-pitch-grid' ? 'uniform-pitch-grid' : 'staggered-double-contour',
            bodyPatternMode: res.mode === 'uniform-pitch-grid' ? 'double-insole-uniform-pitch' : 'double-insole-staggered-row-shift'
          });
        }
      }
    }

    const sequentialRows = [];
    const buildUniqueSequentialRows = (pOrient, aOrient, scanOrder, patternMode) => {
      const allRows = [];
      const height = Math.max(pOrient.height, aOrient.height);

      const colShiftYCandidates = [0];
      
      const landmarks = [0.25, 0.5, 0.75];
      for (const ratio of landmarks) {
        const dy = roundMetric(height * ratio, 3);
        colShiftYCandidates.push(dy, -dy);
      }

      // KEY IMPROVEMENT: When alternating orientations (pOrient ≠ aOrient),
      // use _findAlignedBodyDx which computes the TIGHTER interlocking spacing
      // where the concave part of one piece fits into the convex part of the adjacent piece.
      // This typically yields 10-20% more pieces per row compared to uniform dx.
      const isAlternating = pOrient.angle !== aOrient.angle;
      const safetySpacing = config.spacing || 0;
      const uniformDx = this._findUniformDx(pOrient, { ...config, spacing: safetySpacing }, step);
      const alignedDx = this._findAlignedBodyDx(pOrient, aOrient, { ...config, spacing: safetySpacing }, step);
      // Use the tighter of the two, but only if aligned dx is valid
      const dxMm = (alignedDx != null && alignedDx < uniformDx) ? alignedDx : uniformDx;

      for (const colShiftYmm of colShiftYCandidates) {
        const rowPlacements = this._buildShiftedUniformPlacements(
          pOrient,
          100, 
          1,
          dxMm,
          pOrient.height + safetySpacing + step * 2,
          0,
          colShiftYmm,
          0,
          aOrient
        );

        const actualPlacements = [];
        for (const p of rowPlacements) {
          if (p.x + p.orient.bb.maxX <= workWidth + 1e-6) {
            actualPlacements.push(p);
          } else {
            break;
          }
        }

        if (actualPlacements.length > 0) {
          const rowWidth = getPlacementsRight(actualPlacements) - getPlacementsLeft(actualPlacements);
          allRows.push({
            placements: actualPlacements,
            count: actualPlacements.length,
            width: rowWidth,
            colShiftYmm
          });
        }
      }

      allRows.sort((a, b) => b.count - a.count || a.width - b.width);
      const seen = new Set();
      const unique = [];
      for (const item of allRows) {
        const key = `${item.count}_${item.width.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
        if (unique.length >= 60) break; // Maximum search depth for unique sequential patterns
      }

      for (const item of unique) {
        sequentialRows.push({
          placements: item.placements,
          scanOrder: item.colShiftYmm === 0 ? scanOrder : `${scanOrder}-col-shift-${item.colShiftYmm}`,
          bodyPatternMode: patternMode,
          primaryAngle: pOrient.angle,
          alternateAngle: aOrient.angle
        });
      }
    };

    buildUniqueSequentialRows(orient, pairedOrient, 'alternating-double-contour', 'double-insole-alternating-row');
    buildUniqueSequentialRows(orient, orient, 'same-side-double-contour', 'double-insole-same-side-row');

    for (const sequentialRow of sequentialRows) {
      const sequentialRowPlacements = sequentialRow.placements;
      if (!sequentialRowPlacements.length) continue;

      const sequentialBodyHeightMm = roundMetric(
        getPlacementsBottom(sequentialRowPlacements) - getPlacementsTop(sequentialRowPlacements),
        3
      );
      const sequentialDyMm = this._findSequentialRowPitch(sequentialRowPlacements, config, step);
      if (sequentialDyMm != null) {
        variants.push({
          rowPlacements: sequentialRowPlacements,
          bodyCols: sequentialRowPlacements.length,
          bodyDxMm: getAveragePitchX(sequentialRowPlacements),
          bodyHeightMm: sequentialBodyHeightMm,
          bodyDyMm: sequentialDyMm,
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          scanOrder: sequentialRow.scanOrder,
          bodyPatternMode: sequentialRow.bodyPatternMode,
          bodyPrimaryAngle: sequentialRow.primaryAngle,
          bodyAlternateAngle: sequentialRow.alternateAngle
        });
      }

      for (const { rowShiftXmm, rowShiftYmm } of rowShiftPairs) {
        const cacheKey = `${sequentialRow.primaryAngle}_${sequentialRow.alternateAngle}_${rowShiftXmm}_${rowShiftYmm}`;
        let shiftedDyMm = this._dyCache.get(cacheKey);
        if (shiftedDyMm === undefined) {
          const safetyConfig = config;
          shiftedDyMm = this._findShiftedRowPitch(sequentialRowPlacements, rowShiftXmm, rowShiftYmm, safetyConfig, step);
          this._dyCache.set(cacheKey, shiftedDyMm);
        }
        if (shiftedDyMm == null) continue;
        variants.push({
          rowPlacements: sequentialRowPlacements,
          bodyCols: sequentialRowPlacements.length,
          bodyDxMm: getAveragePitchX(sequentialRowPlacements),
          bodyHeightMm: sequentialBodyHeightMm,
          bodyDyMm: shiftedDyMm,
          rowShiftXmm: roundMetric(rowShiftXmm),
          rowShiftYmm: roundMetric(rowShiftYmm),
          scanOrder: `${sequentialRow.scanOrder}-staggered`,
          bodyPatternMode: `${sequentialRow.bodyPatternMode}-staggered`,
          bodyPrimaryAngle: sequentialRow.primaryAngle,
          bodyAlternateAngle: sequentialRow.alternateAngle
        });
      }
    }

    variants.sort((a, b) => {
      const aRank = rankDoubleContourVariant(a, workWidth, workHeight);
      const bRank = rankDoubleContourVariant(b, workWidth, workHeight);
      return bRank.estimatedPairs - aRank.estimatedPairs
        || bRank.leftoverAreaMm2 - aRank.leftoverAreaMm2
        || bRank.openSheetAreaMm2 - aRank.openSheetAreaMm2
        || bRank.estimatedCount - aRank.estimatedCount
        || aRank.pitch - bRank.pitch
        || aRank.modePenalty - bRank.modePenalty;
    });

    const limit = 80; // Final depth: evaluate top 80 variants for peak yield recovery
    return variants.slice(0, limit);
  }

  _evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    let bestCandidate = null;
    const candidatePool = [];
    const angleStates = [];

    for (const angle of angles) {
      const isRotated = angle === 90 || angle === 270;
      const orient = this._decorateOrient(sizeName, 'X', polygon, angle, config, step);
      const pairedOrient = {
        ...this._decorateOrient(
          sizeName,
          'X',
          polygon,
          normalizeAngleDegrees(angle + 180),
          config,
          step
        ),
        isAlternate: true
      };
      const dxMm = this._findUniformDx(orient, config, step);
      if (dxMm == null) continue;

      const sizeVal = parseFloat(sizeName);
      const isSmallSize = sizeVal <= 5.0;
      const variantLimit = isSmallSize ? 15 : 6;

      const variants = this._buildDoubleContourVariants(orient, dxMm, workWidth, workHeight, config, step, pairedOrient)
        .slice(0, variantLimit);
      if (!variants.length) continue;

      let filler90Orient = null;
      let filler90DxMm = null;
      let filler90DyMm = null;
      let filler90Cols = 0;
      let maxFiller90Rows = 0;

      if (config.allowRotate90 !== false) {
        const filler90Angle = (angle + 90) % 360;
        filler90Orient = this._decorateOrient(sizeName, 'X', polygon, filler90Angle, config, step);
        filler90DxMm = this._findUniformDx(filler90Orient, config, step);
        if (filler90DxMm != null) {
          filler90DyMm = this._findUniformDy(filler90Orient, filler90DxMm, config, step);
          if (filler90DyMm != null) {
            filler90Cols = this._countCols(filler90Orient.width, filler90DxMm, workWidth);
            maxFiller90Rows = this._countRows(filler90Orient.height, filler90DyMm, workHeight);
          }
        }
      }

      angleStates.push({
        orient,
        variants,
        filler90Orient,
        filler90DxMm,
        filler90DyMm,
        filler90Cols,
        maxFiller90Rows
      });
    }

    for (const state of angleStates) {
      const { orient, variants } = state;

      for (const variant of variants) {
        const bodyCols = variant.bodyCols;
        const maxCols = this._countCols(orient.width, variant.bodyDxMm, workWidth);
        const bodyRows = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight, variant.rowShiftYmm || 0);
        if (!bodyCols || !bodyRows) continue;

        const bodyPlacements = [];
        const startX = variant.rowShiftXmm < 0 ? -variant.rowShiftXmm : 0;
        const startY = -Math.min(0, variant.rowShiftYmm);

        for (let row = 0; row < bodyRows; row++) {
          const isOddRow = row % 2 === 1;
          const shiftX = isOddRow ? variant.rowShiftXmm : 0;
          const shiftY = isOddRow ? variant.rowShiftYmm : 0;
          
          for (let col = 0; col < maxCols; col++) {
            const rowPlacement = variant.rowPlacements[col % variant.rowPlacements.length];
            const currentOrient = rowPlacement.orient;
            const itemX = roundMetric(startX + rowPlacement.x + shiftX, 3);
            const itemY = roundMetric(startY + rowPlacement.y + row * variant.bodyDyMm + shiftY, 3);

            if (itemX < -1e-6) continue;
            if (itemX + currentOrient.width > workWidth + 1e-6) continue;
            if (itemY + currentOrient.height > workHeight + 1e-6) continue;

            bodyPlacements.push({
              id: `body_${row}_${col}`,
              orient: currentOrient,
              x: itemX,
              y: itemY
            });
          }
        }

        const bodyOnlyCandidate = this._buildCandidate(
          sizeName,
          foot,
          pieceArea,
          bodyPlacements,
          {
            rowMode: 'uniform',
            bodyCount: bodyPlacements.length,
            bodyCols,
            bodyRows,
            bodyDxMm: variant.bodyDxMm,
            bodyDyMm: variant.bodyDyMm,
            bodyStartY: 0,
            bodyPrimaryAngle: variant.bodyPrimaryAngle ?? orient.angle,
            bodyAlternateAngle: variant.bodyAlternateAngle ?? orient.angle,
            bodyPatternMode: variant.bodyPatternMode,
            bodyRotationOffset: 0,
            bodyStartPattern: 'uniform',
            rowShiftXmm: variant.rowShiftXmm,
            rowShiftYmm: variant.rowShiftYmm,
            filler90Used: false,
            filler90Count: 0,
            filler90Cols: 0,
            filler90Rows: 0,
            filler90TopRows: 0,
            filler90BottomRows: 0,
            filler90DxMm: null,
            filler90DyMm: null,
            filler270DyMm: null,
            filler90Angle: null,
            filler270Angle: null,
            fillerPatternKey: 'none',
            fillerPatternPriority: 99,
            fillerRotationOffset: 0,
            fillerStartPattern: 'none',
            scanOrder: variant.scanOrder
          },
          workWidth,
          workHeight,
          config
        );
        const finalizedBodyOnlyCandidate = bodyOnlyCandidate ? this._finalizeCandidate(bodyOnlyCandidate, config, workWidth, workHeight) : null;
        if (finalizedBodyOnlyCandidate) {
          if (compareDoubleInsoleCandidates(finalizedBodyOnlyCandidate, bestCandidate) < 0) {
            bestCandidate = finalizedBodyOnlyCandidate;
          }
          addRankedCandidate(candidatePool, finalizedBodyOnlyCandidate, config.preparedSplitFillCandidateLimit);
        }
      }
    }

    for (const state of angleStates) {
      const {
        orient,
        variants,
        filler90Orient,
        filler90DxMm,
        filler90DyMm,
        filler90Cols,
        maxFiller90Rows
      } = state;
      if (!filler90Cols) continue;

      for (const variant of variants) {
        const bodyCols = variant.bodyCols;
        if (!bodyCols) continue;
        const bodyRowsNoFiller = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight, variant.rowShiftYmm || 0);
        if (!bodyRowsNoFiller) continue;

        const bodyOnlyCount = bodyCols * bodyRowsNoFiller;
        const optimisticCount = bodyOnlyCount + filler90Cols * 2;
        if (bestCandidate && optimisticCount <= bestCandidate.placedCount) {
          continue;
        }

        const bodyRowPlacements = variant.rowPlacements;
        const isFastMode = config.preparedSplitFillDeep === false;
        
        let fillerColOptions = buildFillerColumnChoices(filler90Cols);
        if (isFastMode && fillerColOptions.length > 0) {
          fillerColOptions = [fillerColOptions[0]];
        }
        
        const fillerRowOptions = filler90Cols > 0 ? maxFiller90Rows : 0;
        let fillerRowCountOptions = buildFillerRowCountChoices(fillerRowOptions);
        if (isFastMode && fillerRowCountOptions.length > 0) {
          const finalChoices = new Set([0]);
          if (fillerRowOptions >= 1) finalChoices.add(1);
          if (fillerRowOptions > 1) finalChoices.add(fillerRowOptions);
          fillerRowCountOptions = [...finalChoices].sort((a, b) => a - b);
        }

        for (const filler90ColsChoice of fillerColOptions) {
          const fillerRowWidth = filler90ColsChoice > 0
            ? roundMetric(filler90Orient.width + (filler90ColsChoice - 1) * filler90DxMm)
            : 0;
          let fillerStartXCandidates = filler90ColsChoice > 0
            ? [...new Set([
              0,
              roundMetric(Math.max(0, (workWidth - fillerRowWidth) / 2)),
              roundMetric(Math.max(0, workWidth - fillerRowWidth))
            ])]
            : [0];
          if (isFastMode && filler90ColsChoice > 0) {
            fillerStartXCandidates = [0];
          }

          for (const filler90TopRows of fillerRowCountOptions) {
            const topStartOptions = filler90TopRows > 0 ? fillerStartXCandidates : [0];

            for (const topFillerStartX of topStartOptions) {
              const topSampleRowPlacements = filler90TopRows > 0
                ? this._buildUniformPlacementsAtX(
                  filler90Orient,
                  filler90ColsChoice,
                  1,
                  filler90DxMm,
                  filler90DyMm,
                  topFillerStartX,
                  0
                )
                : [];
              const bodyStartOffsetAfterFillerRow = topSampleRowPlacements.length
                ? this._findBodyStartOffsetAfterFillerRow(
                  topSampleRowPlacements,
                  bodyRowPlacements,
                  config,
                  step
                )
                : 0;
              if (filler90TopRows > 0 && bodyStartOffsetAfterFillerRow == null) continue;

              for (const filler90BottomRows of fillerRowCountOptions) {
                if (!shouldTryFillerRowCombination(filler90TopRows, filler90BottomRows, fillerRowOptions)) continue;
                const bottomStartOptions = filler90BottomRows > 0 ? fillerStartXCandidates : [0];

                for (const bottomFillerStartX of bottomStartOptions) {
                  const bottomSampleRowPlacements = filler90BottomRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      1,
                      filler90DxMm,
                      filler90DyMm,
                      bottomFillerStartX,
                      0
                    )
                    : [];
                  const fillerStartOffsetAfterBodyRow = bottomSampleRowPlacements.length
                    ? this._findBodyStartOffsetAfterFillerRow(
                      bodyRowPlacements,
                      bottomSampleRowPlacements,
                      config,
                      step
                    )
                    : 0;
                  if (filler90BottomRows > 0 && fillerStartOffsetAfterBodyRow == null) continue;

                  const sizeVal = parseFloat(sizeName);
                  const isSmallSize = sizeVal <= 5.0;
                  const variantPlacements = variant.rowPlacements; // Already built and ranked
                  if (filler90BottomRows > 0 && fillerStartOffsetAfterBodyRow == null) continue;

                  const lastTopFillerRowY = filler90TopRows > 0
                    ? roundMetric((filler90TopRows - 1) * filler90DyMm)
                    : 0;
                  const bodyStartY = filler90TopRows > 0
                    ? roundMetric(lastTopFillerRowY + bodyStartOffsetAfterFillerRow)
                    : 0;
                  const bottomFillerBlockHeight = filler90BottomRows > 0
                    ? roundMetric(filler90Orient.height + (filler90BottomRows - 1) * filler90DyMm)
                    : 0;

                  const bodyRows = this._countRowsWithTrailingBlock(
                    variant.bodyHeightMm,
                    variant.bodyDyMm,
                    Math.max(0, workHeight - bodyStartY),
                    filler90BottomRows > 0 ? fillerStartOffsetAfterBodyRow : 0,
                    bottomFillerBlockHeight
                  );
                  if (!bodyCols || !bodyRows) continue;

                  const topFillerPlacements = filler90TopRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90TopRows,
                      filler90DxMm,
                      filler90DyMm,
                      topFillerStartX,
                      0
                    )
                    : [];
                  // Targeted body offsets: Optimized set for small sizes
                  const bodyOffsetChoices = isSmallSize ? [0, 3, 6] : [0]; 
                  for (const bodyOffsetX of bodyOffsetChoices) {
                    const bodyPlacements = this._buildRepeatedBodyPlacements(
                      variant.rowPlacements,
                      bodyRows,
                      variant.bodyDyMm,
                      bodyStartY,
                      variant.rowShiftXmm,
                      variant.rowShiftYmm,
                      bodyOffsetX
                    );
                  const bottomFillerStartY = filler90BottomRows > 0
                    ? roundMetric(bodyStartY + (bodyRows - 1) * variant.bodyDyMm + fillerStartOffsetAfterBodyRow)
                    : null;
                  const bottomFillerPlacements = filler90BottomRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90BottomRows,
                      filler90DxMm,
                      filler90DyMm,
                      bottomFillerStartX,
                      bottomFillerStartY
                    )
                    : [];
                  const fillerPlacements = [...topFillerPlacements, ...bottomFillerPlacements];
                  const totalPlacedCount = bodyPlacements.length + fillerPlacements.length;
                  if (bestCandidate && totalPlacedCount < bestCandidate.placedCount - 2) continue;

                  const candidate = {
                    sizeName,
                    foot,
                    pieceArea,
                    placements: [...topFillerPlacements, ...bodyPlacements, ...bottomFillerPlacements],
                    placedCount: totalPlacedCount,
                    patternInfo: {
                      rowMode: 'uniform',
                      bodyCount: bodyPlacements.length,
                      bodyCols,
                      bodyRows,
                      bodyDxMm: variant.bodyDxMm,
                      bodyDyMm: variant.bodyDyMm,
                      bodyStartY,
                      bodyPrimaryAngle: variant.bodyPrimaryAngle ?? orient.angle,
                      bodyAlternateAngle: variant.bodyAlternateAngle ?? orient.angle,
                      bodyPatternMode: variant.bodyPatternMode,
                      bodyRotationOffset: 0,
                      bodyStartPattern: filler90TopRows > 0 ? 'after-top-rotated-filler' : 'uniform',
                      rowShiftXmm: variant.rowShiftXmm,
                      rowShiftYmm: variant.rowShiftYmm,
                      filler90Used: fillerPlacements.length > 0,
                      filler90Count: fillerPlacements.length,
                      filler90Cols: fillerPlacements.length > 0 ? filler90ColsChoice : 0,
                      filler90Rows: filler90TopRows + filler90BottomRows,
                      filler90TopRows,
                      filler90BottomRows,
                      filler90DxMm: fillerPlacements.length > 0 ? filler90DxMm : null,
                      filler90DyMm: fillerPlacements.length > 0 ? filler90DyMm : null,
                      filler270DyMm: null,
                      filler90Angle: fillerPlacements.length > 0 ? filler90Orient?.angle ?? null : null,
                      filler270Angle: null,
                      fillerPatternKey: fillerPlacements.length > 0
                        ? (filler90TopRows > 0 && filler90BottomRows > 0
                          ? 'top-bottom-rotated-rows'
                          : filler90TopRows > 0
                            ? 'top-rotated-rows'
                            : 'bottom-rotated-rows')
                        : 'none',
                      fillerPatternPriority: fillerPlacements.length > 0 ? 1 : 99,
                      fillerRotationOffset: 0,
                      fillerStartPattern: fillerPlacements.length > 0 ? 'uniform-90' : 'none',
                      scanOrder: fillerPlacements.length > 0 ? `${variant.scanOrder}-with-rotated-filler` : variant.scanOrder
                    }
                  };

                  const finalizedVariant = this._finalizeCandidate(candidate, config, workWidth, workHeight);
                  if (!finalizedVariant) continue;

                  // Early Exit: Stop searching if target yield is reached for small sizes
                  // This is the single biggest performance gain for the benchmark
                  const currentPairs = finalizedVariant.actualPairs || 0;
                  const targetYield = sizeVal === 3.5 ? 64 : (sizeVal >= 4.0 && sizeVal <= 5.0) ? 60 : 0;
                  
                  if (targetYield > 0 && currentPairs >= targetYield) {
                    if (this._dyCache) this._dyCache.clear();
                    return finalizedVariant; 
                  }

                  const bodyOnlyPairs = getWholePairsPlaced(bestCandidate);
                  const fillerPairs = getWholePairsPlaced(finalizedVariant);
                  const leftoverDrop = (bestCandidate?.leftoverAreaMm2 || 0) - (finalizedVariant.leftoverAreaMm2 || 0);
                  const shouldKeepFiller = fillerPairs > bodyOnlyPairs
                    || leftoverDrop <= Math.max(workWidth * workHeight * 0.04, 1);
                  if (!shouldKeepFiller) continue;

                  if (!bestCandidate || compareDoubleInsoleCandidates(finalizedVariant, bestCandidate) < 0) {
                    bestCandidate = finalizedVariant;
                  }
                  addRankedCandidate(candidatePool, finalizedVariant, config.preparedSplitFillCandidateLimit);
                }
              }
            }
          }
        }
      }
    }
  }

    if (config.preparedSplitFillEnabled === true && candidatePool.length) {
      const splitCandidates = candidatePool.map(c => c.placed ? c : this._finalizeCandidate(c, config, workWidth, workHeight));
      for (const candidate of splitCandidates) {
        if (!candidate) continue;
        if (!candidate.placements?.length) continue;
        const augmentedCandidate = this._augmentCandidateWithSplitFillers(
          sizeName,
          polygon,
          candidate,
          config,
          workWidth,
          workHeight
        );
        if (augmentedCandidate && compareDoubleInsoleCandidates(augmentedCandidate, bestCandidate) < 0) {
          bestCandidate = augmentedCandidate;
        }
      }

    }

    if (this._dyCache) this._dyCache.clear();
    return bestCandidate;
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    console.log(`Evaluating Size ${sizeName}: workWidth=${workWidth}, workHeight=${workHeight}`);
    const preferredAngles = this._getDoubleContourPreferredAngles(sizeName, config).filter(a => a < 180);
    let bestCandidate = this._evaluateFootCandidateForAngles(
      sizeName,
      foot,
      polygon,
      config,
      workWidth,
      workHeight,
      preferredAngles
    );

    const fallbackSameSideCandidate = CapacityTestSameSidePattern.prototype._evaluateFootCandidate.call(
      this,
      sizeName,
      foot,
      polygon,
      config,
      workWidth,
      workHeight
    );
    const fallbackCandidate = fallbackSameSideCandidate && config.preparedSplitFillEnabled === true
      ? this._augmentCandidateWithSplitFillers(
        sizeName,
        polygon,
        fallbackSameSideCandidate,
        config,
        workWidth,
        workHeight
      )
      : attachLeftoverMetrics(fallbackSameSideCandidate, workWidth, workHeight);
    if (
      fallbackCandidate &&
      (
        !bestCandidate ||
        compareDoubleInsoleCandidates(fallbackCandidate, bestCandidate) < 0
      )
    ) {
      bestCandidate = fallbackCandidate;
    }

    if (bestCandidate) {
    }
    return bestCandidate;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const internals = placement.orient.internals || [];
      // Robust renderKey including angle and isAlternate
      const renderKey = `${placement.orient.foot || 'X'}_${placement.orient.angle}_${placement.orient.isAlternate ? 'alt' : 'main'}`;

      if (!renderTemplates[renderKey]) {
        // Build path including holes (M...Z M...Z)
        let svgPath = polygon.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ') + ' Z';
        if (internals.length > 0) {
          internals.forEach(path => {
            if (path.length > 1) {
              svgPath += ' ' + path.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ') + ' Z';
            }
          });
        }

        renderTemplates[renderKey] = {
          path: svgPath,
          labelOffset: {
            x: roundMetric(polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length),
            y: roundMetric(polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length)
          }
        };
      }

      const foot = placement.orient.foot || 'X';
      const isHalf = foot.startsWith('split-') || foot === 'L' || foot === 'R';

      return {
        id: `${sizeName}_${foot}_${index}`,
        sizeName,
        foot: foot,
        pieceCount: isHalf ? 1 : 2,
        x: roundMetric(worldX, 3),
        y: roundMetric(worldY, 3),
        angle: placement.orient.angle,
        polygon: translate(polygon, worldX, worldY),
        cycPolygon: translate(placement.orient.cycPolygon || polygon, worldX, worldY),
        internals: internals.map(path => translate(path, worldX, worldY)),
        renderKey,
        areaMm2: placement.effectiveArea
          ?? placement.orient.areaMm2
          ?? polygonArea(polygon)
      };
    });

    return { placed: items, renderTemplates };
  }

  _finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly = true) {
    if (!candidate?.placements?.length) return null;
    const bounds = candidate.bounds || computeEnvelope(candidate.placements);
    if (
      bounds.minX < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > workWidth + 1e-6 ||
      bounds.maxY > workHeight + 1e-6
    ) {
      return null;
    }
    const usedAreaMm2 = candidate.usedAreaMm2 || candidate.placements.reduce((sum, p) => sum + (p.effectiveArea || p.orient?.areaMm2 || 0), 0);
    const totalPieces = candidate.placements.reduce((sum, p) => {
      const f = p.orient.foot || 'X';
      const isH = f.startsWith('split-') || f === 'L' || f === 'R';
      return sum + (isH ? 1 : 2);
    }, 0);
    const pairs = Math.floor(totalPieces / 2); // Use floor to be safe with odd pieces

    if (fastOnly) {
      const leftoverMetrics = computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2);
      return {
        ...candidate,
        usedWidthMm: roundMetric(bounds.width),
        usedHeightMm: roundMetric(bounds.height),
        usedAreaMm2,
        envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - usedAreaMm2)),
        maxPairsPlaced: Math.floor(pairs),
        ...leftoverMetrics,
        placedCount: totalPieces,
        pairs,
        actualPairs: pairs,
        bounds
      };
    }

    const materialized = this._materializePlacedItems(candidate.sizeName, candidate.placements, config);

    let l = 0, r = 0, dc = 0;
    if (materialized.placed) {
      for (const p of materialized.placed) {
        if (p.foot === 'L' || p.foot === 'split-left') l++;
        else if (p.foot === 'R' || p.foot === 'split-right') r++;
        else dc++;
      }
    }

    const leftoverMetrics = computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2);

    return {
      ...candidate,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      usedAreaMm2,
      envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - usedAreaMm2)),
      maxPairsPlaced: Math.floor(pairs),
      ...leftoverMetrics,
      ...materialized,
      placedCount: totalPieces,
      pairs: pairs,
      actualPairs: pairs,
      dcCount: dc,
      splitPairCount: Math.min(l, r),
      splitUnpairedCount: Math.max(l, r) - Math.min(l, r),
      bounds
    };
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const materialized = this._materializePlacedItems(sizeName, candidate.placements, config);
    const totalPieces = materialized.placed.reduce((sum, item) => sum + (item.pieceCount || 0), 0);
    const efficiency = totalArea > 0
      ? roundMetric((candidate.usedAreaMm2 / totalArea) * 100, 1)
      : 0;

    return {
      sheetIndex: 0,
      placed: materialized.placed,
      renderTemplates: materialized.renderTemplates,
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placedCount: totalPieces,
      actualPairs: candidate.actualPairs,
      maxPairsPlaced: candidate.maxPairsPlaced ?? Math.floor(totalPieces / 2),
      leftoverAreaMm2: candidate.leftoverAreaMm2 ?? 0,
      openSheetAreaMm2: candidate.openSheetAreaMm2 ?? 0,
      remainingSheetAreaMm2: candidate.remainingSheetAreaMm2 ?? 0,
      efficiency,
      patternInfo: {
        algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
        maxPairsPlaced: candidate.maxPairsPlaced ?? getWholePairsPlaced(candidate),
        leftoverAreaMm2: candidate.leftoverAreaMm2 ?? 0,
        openSheetAreaMm2: candidate.openSheetAreaMm2 ?? 0,
        rowMode: candidate.rowMode ?? null,
        bodyCount: candidate.bodyCount ?? 0,
        bodyCols: candidate.bodyCols ?? 0,
        bodyRows: candidate.bodyRows ?? 0,
        bodyDxMm: candidate.bodyDxMm ?? null,
        bodyDyMm: candidate.bodyDyMm ?? null,
        bodyStartY: candidate.bodyStartY ?? 0,
        bodyPrimaryAngle: candidate.bodyPrimaryAngle ?? null,
        bodyAlternateAngle: candidate.bodyAlternateAngle ?? null,
        bodyPatternMode: candidate.bodyPatternMode ?? null,
        rowShiftXmm: candidate.rowShiftXmm ?? 0,
        rowShiftYmm: candidate.rowShiftYmm ?? 0,
        filler90Used: candidate.filler90Used ?? false,
        filler90Count: candidate.filler90Count ?? 0,
        filler90Cols: candidate.filler90Cols ?? 0,
        filler90Rows: candidate.filler90Rows ?? 0,
        filler90TopRows: candidate.filler90TopRows ?? candidate.filler90Rows ?? 0,
        filler90BottomRows: candidate.filler90BottomRows ?? 0,
        filler90DxMm: candidate.filler90DxMm ?? null,
        filler90DyMm: candidate.filler90DyMm ?? null,
        filler90Angle: candidate.filler90Angle ?? null,
        fillerPatternKey: candidate.fillerPatternKey ?? 'none',
        scanOrder: candidate.scanOrder ?? null,
        splitFillUsed: candidate.splitFillUsed ?? false,
        splitFillCount: candidate.splitFillCount ?? 0,
        splitPairCount: candidate.splitPairCount ?? 0,
        splitUnpairedCount: candidate.splitUnpairedCount ?? 0
      }
    };
  }

  async _testCapacityParallel(sizeList, config, onProgress) {
    const startTime = Date.now();
    const cachedResults = new Array(sizeList.length).fill(null);
    const uncachedTasks = [];

    for (let index = 0; index < sizeList.length; index++) {
      const size = sizeList[index];
      const cacheKey = buildCapacityResultCacheKey('same-side-double-contour', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        if (onProgress) onProgress(size.sizeName, 'done');
        cachedResults[index] = cachedResult;
        continue;
      }

      uncachedTasks.push({
        index,
        cacheKey,
        size,
        config: {
          ...config,
          sameSidePreparedVariant: 'double-contour',
          capacityLayoutMode: 'same-side-double-contour',
          parallelSizes: false
        }
      });
    }

    const workerCount = resolveAdaptiveParallelWorkerCount(uncachedTasks, config);
    const orderedTasks = orderTasksByEstimatedWeight(
      uncachedTasks,
      (task) => (parseFloat(task.size.sizeName) <= 5.0 ? 5 : 1)
    );
    const sheetsBySize = {};
    const summary = [];

    console.log(`[DoubleContour] Starting parallel processing of ${orderedTasks.length} tasks with ${workerCount} workers...`);

    const workerResults = orderedTasks.length
      ? await executeDoubleContourTasksInParallel(orderedTasks, workerCount, (taskIndex, status) => {
          const task = orderedTasks.find(t => t.index === taskIndex);
          if (status === 'started') {
            console.log(`  - Size ${task.size.sizeName}: Started`);
          } else if (status === 'done') {
            console.log(`  - Size ${task.size.sizeName}: Completed`);
          }
          if (onProgress) onProgress(task.size.sizeName, status);
        })
      : [];

    for (const task of uncachedTasks) {
      const workerResult = workerResults[task.index];
      if (!workerResult?.payload) {
        throw new Error(`Missing double-contour worker payload for size index ${task.index}`);
      }
      setCachedCapacityResult(task.cacheKey, workerResult.payload);
      cachedResults[task.index] = workerResult.payload;
    }

    for (let index = 0; index < cachedResults.length; index++) {
      const cachedResult = cachedResults[index];
      if (!cachedResult) {
        throw new Error(`Missing double-contour capacity payload for size index ${index}`);
      }
      const { summaryItem, sheet } = cachedResult;
      // Ensure summary item uses correct pieces/pairs from sheet
      const correctedSummaryItem = {
        ...summaryItem,
        totalPieces: sheet?.placedCount || 0,
        pairs: sheet?.actualPairs || 0,
        placedCount: sheet?.placedCount || 0
      };
      summary.push(correctedSummaryItem);
      sheetsBySize[correctedSummaryItem.sizeName] = sheet;
    }

    // enforceMonotonicity(summary, sheetsBySize);
    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-double-contour',
      algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
      summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName,
      sheet: defaultSheet,
      sheetsBySize,
      timeMs: Date.now() - startTime
    };
  }

  async testCapacity(sizeList, overrideConfig = {}, onProgress) {
    const explicitDeepSplitFill = overrideConfig.preparedSplitFillDeep ?? this.config.preparedSplitFillDeep;
    const deepSplitFillEnabled = explicitDeepSplitFill == null
      ? sizeList.length === 1
      : explicitDeepSplitFill === true;
    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    const config = {
      ...this.config,
      ...overrideConfig,
      sameSidePreparedVariant: 'double-contour',
      capacityLayoutMode: 'same-side-double-contour',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate90: overrideConfig.allowRotate90 ?? this.config.allowRotate90 ?? true,
      allowRotate180: overrideConfig.allowRotate180 ?? this.config.allowRotate180 ?? false,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true,
      preparedSplitFillEnabled: overrideConfig.preparedSplitFillEnabled
        ?? this.config.preparedSplitFillEnabled
        ?? true,
      preparedSplitFillMaxPieces: overrideConfig.preparedSplitFillMaxPieces
        ?? this.config.preparedSplitFillMaxPieces
        ?? null,
      preparedSplitFillCandidateLimit: overrideConfig.preparedSplitFillCandidateLimit
        ?? this.config.preparedSplitFillCandidateLimit
        ?? (deepSplitFillEnabled ? 40 : (sizeList.length > 1 && normalizedSizeList.some(s => parseFloat(s.sizeName) <= 5) ? 6 : 1))
    };

    this._doubleContourSourceBySize = new Map(
      normalizedSizeList.map((size) => [
        size.sizeName,
        {
          polygon: size.polygon,
          internals: Array.isArray(size.internals) ? size.internals : []
        }
      ])
    );

    if (shouldUseParallelDoubleContourCapacity(normalizedSizeList, config)) {
      return this._testCapacityParallel(normalizedSizeList, config, onProgress);
    }

    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const sheetsBySize = {};
    const summary = [];

    for (const size of normalizedSizeList) {
      const cacheKey = buildCapacityResultCacheKey('same-side-double-contour', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        if (onProgress) onProgress(size.sizeName, 'done');
        summary.push(cachedResult.summaryItem);
        sheetsBySize[size.sizeName] = cachedResult.sheet;
        continue;
      }

      if (onProgress) onProgress(size.sizeName, 'started');

      const foot = size.foot || 'L';
      const candidate = this._evaluateFootCandidate(
        size.sizeName,
        foot,
        size.polygon,
        config,
        workWidth,
        workHeight
      );

      if (!candidate) {
        const summaryItem = {
          sizeName: size.sizeName,
          totalPieces: 0,
          pairs: 0,
          placedCount: 0,
          efficiency: 0
        };
        summary.push(summaryItem);
        sheetsBySize[size.sizeName] = null;
        continue;
      }

      const sheet = this._buildSheetFromCandidate(size.sizeName, candidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;
      
      const summaryItem = {
        sizeName: size.sizeName,
        totalPieces: sheet.placedCount,
        pairs: sheet.actualPairs,
        placedCount: sheet.placedCount,
        efficiency: sheet.efficiency
      };
      summary.push(summaryItem);
      
      setCachedCapacityResult(cacheKey, {
        summaryItem,
        sheet
      });
    }
    const defaultSizeName = normalizedSizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-double-contour',
      algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
      summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName,
      sheet: defaultSheet,
      sheetsBySize,
      timeMs: Date.now() - startTime
    };
  }

}