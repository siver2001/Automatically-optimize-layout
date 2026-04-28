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
import { CapacityTestSameSidePattern } from './CapacityTestSameSidePattern.js';
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

const MAX_SHIFT_CANDIDATES = 9;
const MAX_ROW_SHIFT_PAIR_CANDIDATES = 24;
const SHIFT_SCAN_LIMIT = 9;
const INTERNAL_GAP_SAMPLE_RATIOS = [0.08, 0.12, 0.16, 0.22, 0.28, 0.34, 0.66, 0.72, 0.78, 0.84, 0.9];
const MAX_SPLIT_FILL_SAFETY_MULTIPLIER = 1.25;
const MIN_SPLIT_HALF_AREA_RATIO = 0.18;
const MAX_SPLIT_HALF_AREA_RATIO = 0.82;
const MIN_SPLIT_FREE_RECT_SIZE = 18;
const MAX_SPLIT_FREE_RECTS = 12;
const SPLIT_EDGE_NUDGE_UNITS = [-2, -1, 0, 1, 2];
const SPLIT_RECT_SAMPLE_RATIOS = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1];
const MAX_SPLIT_AXIS_SAMPLES = 7;
const MAX_SPLIT_BOUNDARY_AXIS_SAMPLES = 40;
const MAX_SPLIT_EDGE_ANCHORS_PER_AXIS = 36;
const MAX_SPLIT_EDGE_PLACEMENT_CANDIDATES = 260;
const MAX_SPLIT_PARTNER_NEAR_CANDIDATES = 80;
const MAX_SPLIT_FILL_BEAM_WIDTH = 4;
const MAX_SPLIT_FILL_OPTIONS_PER_STATE = 12;
const MAX_SPLIT_PAIR_GROUP_OPTIONS_PER_STATE = 8;
const MAX_SPLIT_PAIR_TEMPLATES = 18;
const MAX_DOUBLE_CONTOUR_VARIANTS_PER_ANGLE = 14;
const DEFAULT_DOUBLE_CONTOUR_FINE_ROTATE_OFFSETS = [0];
const MAX_SPLIT_AUGMENT_CANDIDATES = 3;
const DEEP_SPLIT_AUGMENT_CANDIDATES = 3;

function compareDoubleInsoleCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  const nextPairs = Math.floor(Math.max(0, nextCandidate.placedCount - (nextCandidate.splitFillCount || 0)) / 2)
    + (nextCandidate.splitPairCount || 0);
  const bestPairs = Math.floor(Math.max(0, bestCandidate.placedCount - (bestCandidate.splitFillCount || 0)) / 2)
    + (bestCandidate.splitPairCount || 0);
  if (nextPairs !== bestPairs) {
    return bestPairs - nextPairs;
  }
  if ((nextCandidate.splitPairCount || 0) !== (bestCandidate.splitPairCount || 0)) {
    return (bestCandidate.splitPairCount || 0) - (nextCandidate.splitPairCount || 0);
  }
  if ((nextCandidate.splitUnpairedCount || 0) !== (bestCandidate.splitUnpairedCount || 0)) {
    return (nextCandidate.splitUnpairedCount || 0) - (bestCandidate.splitUnpairedCount || 0);
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

  for (const ratio of INTERNAL_GAP_SAMPLE_RATIOS) {
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

function mergeShiftCandidateLists(primaryCandidates, secondaryCandidates) {
  const merged = new Set();
  for (const value of [...primaryCandidates, ...secondaryCandidates]) {
    if (Number.isFinite(value)) {
      merged.add(roundMetric(value, 3));
    }
  }
  return [...merged].sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

function limitShiftCandidates(candidates, limit = 7) {
  return [...candidates]
    .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
    .slice(0, Math.max(1, limit));
}

function selectPrimaryRowShiftCandidates(geometricCandidates, sampledCandidates, limit = MAX_SHIFT_CANDIDATES) {
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

function addRankedCandidate(candidatePool, candidate, limit = MAX_SPLIT_AUGMENT_CANDIDATES) {
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

function rankDoubleContourVariant(variant, workHeight) {
  const bodyRows = Math.max(0, Math.floor((workHeight - variant.bodyHeightMm) / Math.max(1, variant.bodyDyMm)) + 1);
  const estimatedCount = bodyRows * (variant.bodyCols || 0);
  const modePenalty = String(variant.scanOrder || '').includes('sequential') ? 0 : 0.25;
  return {
    estimatedCount,
    pitch: variant.bodyDyMm || Infinity,
    modePenalty
  };
}

function limitDoubleContourVariants(variants, workHeight, limit = MAX_DOUBLE_CONTOUR_VARIANTS_PER_ANGLE) {
  return [...variants]
    .sort((left, right) => {
      const leftRank = rankDoubleContourVariant(left, workHeight);
      const rightRank = rankDoubleContourVariant(right, workHeight);
      return rightRank.estimatedCount - leftRank.estimatedCount
        || leftRank.pitch - rightRank.pitch
        || leftRank.modePenalty - rightRank.modePenalty
        || Math.abs(left.rowShiftYmm || 0) - Math.abs(right.rowShiftYmm || 0)
        || Math.abs(left.rowShiftXmm || 0) - Math.abs(right.rowShiftXmm || 0);
    })
    .slice(0, Math.max(1, limit));
}

function buildRowShiftPairs(orient, step, primaryShiftCandidates) {
  const shiftYRange = Math.max(0, (orient?.height || 0) * 0.22);
  const yCandidates = selectPrimaryRowShiftCandidates(
    [],
    buildShiftCandidates(shiftYRange, step, 7),
    7
  );
  const xRank = new Map(primaryShiftCandidates.map((value, index) => [roundMetric(value, 3), index]));
  const pairs = [];

  for (const rowShiftXmm of primaryShiftCandidates) {
    for (const rowShiftYmm of yCandidates) {
      if (
        Math.abs(rowShiftXmm) < Math.max(step, 0.25) * 0.5 &&
        Math.abs(rowShiftYmm) < Math.max(step, 0.25) * 0.5
      ) {
        continue;
      }

      pairs.push({
        rowShiftXmm: roundMetric(rowShiftXmm, 3),
        rowShiftYmm: roundMetric(rowShiftYmm, 3)
      });
    }
  }

  return pairs
    .sort((left, right) =>
      (left.rowShiftYmm === 0 ? 0 : 1) - (right.rowShiftYmm === 0 ? 0 : 1)
      || (xRank.get(left.rowShiftXmm) ?? 999) - (xRank.get(right.rowShiftXmm) ?? 999)
      || Math.abs(left.rowShiftYmm) - Math.abs(right.rowShiftYmm)
      || left.rowShiftYmm - right.rowShiftYmm
    )
    .slice(0, MAX_ROW_SHIFT_PAIR_CANDIDATES);
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
  const divider = buildDividerFromInternalPath(polygon, internalPath)
    || buildDividerFromInternalGaps(polygon);
  if (!divider) return [];

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
    if (areaRatio <= MIN_SPLIT_HALF_AREA_RATIO || areaRatio >= MAX_SPLIT_HALF_AREA_RATIO) {
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

  if (rawDefs.length !== 2) return [];

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

function buildAxisCandidates(minValue, maxValue, step) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];
  if (maxValue < minValue - 1e-6) return [];

  const clampedMax = Math.max(minValue, maxValue);
  const span = Math.max(0, clampedMax - minValue);
  const safeStep = Math.max(0.5, step || 1);
  const values = new Set();

  for (const ratio of SPLIT_RECT_SAMPLE_RATIOS) {
    const raw = minValue + span * ratio;
    values.add(quantizeWithinBounds(raw, safeStep, clampedMax));
  }

  if (span > safeStep * 1.5) {
    const sampleCount = Math.min(
      MAX_SPLIT_AXIS_SAMPLES,
      Math.max(3, Math.floor(span / Math.max(safeStep * 4, 8)) + 1)
    );

    for (let index = 0; index < sampleCount; index++) {
      const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
      const raw = minValue + span * ratio;
      values.add(quantizeWithinBounds(raw, safeStep, clampedMax));
    }
  }

  return [...values]
    .filter((value) => Number.isFinite(value) && value >= minValue - 1e-6 && value <= clampedMax + 1e-6)
    .sort((left, right) => left - right);
}

function buildDenseAxisCandidates(minValue, maxValue, step, maxSamples = MAX_SPLIT_BOUNDARY_AXIS_SAMPLES) {
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

function selectRankedAxisAnchors(values, minStart, maxStart, limit = MAX_SPLIT_EDGE_ANCHORS_PER_AXIS) {
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

function buildDoubleContourSummaryItem(size, sheet) {
  if (!sheet) return buildEmptyDoubleContourSummaryItem(size);
  const info = sheet.patternInfo || {};
  const splitFillCount = info.splitFillCount || 0;
  const splitPairCount = info.splitPairCount || 0;
  const fullPieceCount = Math.max(0, sheet.placedCount - splitFillCount);

  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: sheet.placedCount,
    pairs: Math.floor(fullPieceCount / 2) + splitPairCount,
    placedCount: sheet.placedCount,
    efficiency: sheet.efficiency,
    splitFillCount,
    splitPairCount,
    splitUnpairedCount: info.splitUnpairedCount || 0
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
  const cpuRatio = config.preparedSplitFillEnabled === false ? 0.75 : 0.55;
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

async function executeDoubleContourTasksInParallel(tasks, concurrency) {
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
        const taskIndex = nextTaskIndex;
        nextTaskIndex += 1;
        if (taskIndex >= tasks.length) break;
        const task = tasks[taskIndex];
        const resultIndex = task?.index ?? taskIndex;
        results[resultIndex] = await runDoubleContourWorkerTask(worker, task);
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

  _getDoubleContourPreferredAngles(config = {}) {
    if (Array.isArray(config.doubleContourPreferredAngles) && config.doubleContourPreferredAngles.length) {
      return [...new Set(
        config.doubleContourPreferredAngles
          .map((angle) => Number(angle))
          .filter((angle) => Number.isFinite(angle))
          .map((angle) => normalizeAngleDegrees(angle))
      )];
    }

    const offsets = this._getDoubleContourFineRotateOffsets(config);
    const preferredAngles = [];
    const baseAngles = config.allowRotate90 === false
      ? [0]
      : [0, 90];
    for (const baseAngle of baseAngles) {
      for (const offset of offsets) {
        preferredAngles.push(normalizeAngleDegrees(baseAngle + offset));
      }
    }
    return [...new Set(preferredAngles)];
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
    const precision = Math.min(step, 0.05);
    const upper = Math.max(
      step,
      orient.height * 2 + Math.abs(rowShiftYmm) + config.spacing + step * 10
    );

    let low = 0;
    let high = upper;
    if (!validateLocalPlacements(
      this._buildShiftedUniformNeighborhood(orient, dxMm, high, rowShiftXmm, rowShiftYmm),
      config.spacing
    ).valid) {
      return null;
    }

    while (high - low > precision) {
      const mid = (low + high) / 2;
      const valid = validateLocalPlacements(
        this._buildShiftedUniformNeighborhood(orient, dxMm, mid, rowShiftXmm, rowShiftYmm),
        config.spacing
      ).valid;
      if (valid) high = mid;
      else low = mid;
    }

    return roundMetric(high, 3);
  }

  _buildShiftedUniformPlacements(orient, cols, rows, dxMm, dyMm, rowShiftXmm = 0, rowShiftYmm = 0, startY = 0) {
    const placements = [];
    const baseX = rowShiftXmm < 0 ? -rowShiftXmm : 0;
    const baseY = startY - Math.min(0, rowShiftYmm);

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `double_insole_${row}_${col}`,
          orient,
          x: roundMetric(baseX + col * dxMm + shiftX, 3),
          y: roundMetric(baseY + startY + row * dyMm + shiftY, 3)
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
        candidate.width > MIN_SPLIT_FREE_RECT_SIZE && candidate.height > MIN_SPLIT_FREE_RECT_SIZE
      );
  }

  _normalizePreparedFreeRects(freeRects = []) {
    const normalized = freeRects
      .filter((rect) => rect.width > MIN_SPLIT_FREE_RECT_SIZE && rect.height > MIN_SPLIT_FREE_RECT_SIZE)
      .sort((left, right) =>
        right.width * right.height - left.width * left.height
        || left.y - right.y
        || left.x - right.x
      );

    const unique = [];
    for (const rect of normalized) {
      const contained = unique.some((other) =>
        rect.x >= other.x - 1e-6 &&
        rect.y >= other.y - 1e-6 &&
        rect.x + rect.width <= other.x + other.width + 1e-6 &&
        rect.y + rect.height <= other.y + other.height + 1e-6
      );
      if (!contained) unique.push(rect);
      if (unique.length >= MAX_SPLIT_FREE_RECTS) break;
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

    const xs = buildAxisCandidates(minX, maxX, step);
    const ys = buildAxisCandidates(minY, maxY, step);

    return [...new Set(xs.flatMap((x) => ys.map((y) => `${x}|${y}`)))]
      .map((key) => {
        const [x, y] = key.split('|').map(Number);
        return { x, y };
      });
  }

  _buildPreparedEdgeAnchors(occupiedPlacements, orient, axis, workLimit, step) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minStart = axis === 'x' ? -bb.minX : -bb.minY;
    const maxStart = axis === 'x'
      ? workLimit - bb.maxX
      : workLimit - bb.maxY;
    const anchors = new Set([
      roundMetric(minStart, 3),
      roundMetric(maxStart, 3)
    ]);

    for (const placement of occupiedPlacements) {
      const bounds = this._getPlacementBounds(placement);
      const min = axis === 'x' ? bounds.minX : bounds.minY;
      const max = axis === 'x' ? bounds.maxX : bounds.maxY;
      const center = (min + max) / 2;
      const orientMin = axis === 'x' ? bb.minX : bb.minY;
      const orientMax = axis === 'x' ? bb.maxX : bb.maxY;
      const orientCenter = (orientMin + orientMax) / 2;

      const baseValues = [
        min - orientMax,
        min - orientMin,
        max - orientMax,
        max - orientMin,
        center - orientCenter
      ];

      for (const baseValue of baseValues) {
        for (const unit of SPLIT_EDGE_NUDGE_UNITS) {
          const nudged = baseValue + unit * Math.max(0.5, step);
          anchors.add(roundMetric(Math.max(minStart, Math.min(maxStart, nudged)), 3));
        }
      }
    }

    return selectRankedAxisAnchors([...anchors], minStart, maxStart);
  }

  _scorePreparedEdgePlacementCandidate(candidate, orient, workWidth, workHeight) {
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

    return (
      preferredDistance * 0.6 +
      nearestEdgeDistance * 0.25 +
      candidate.y * 0.001 +
      candidate.x * 0.0005
    );
  }

  _buildPreparedEdgePlacementCandidates(occupiedPlacements, orient, workWidth, workHeight, step) {
    const xAnchors = this._buildPreparedEdgeAnchors(
      occupiedPlacements,
      orient,
      'x',
      workWidth,
      step
    );
    const yAnchors = this._buildPreparedEdgeAnchors(
      occupiedPlacements,
      orient,
      'y',
      workHeight,
      step
    );
    const candidates = [];
    const seen = new Set();
    const addCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const key = `${roundMetric(x, 3)}|${roundMetric(y, 3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        x: roundMetric(x, 3),
        y: roundMetric(y, 3)
      });
    };

    for (const x of xAnchors) {
      addCandidate(x, yAnchors[0]);
      addCandidate(x, yAnchors[yAnchors.length - 1]);
    }

    for (const y of yAnchors) {
      addCandidate(xAnchors[0], y);
      addCandidate(xAnchors[xAnchors.length - 1], y);
    }

    const xLimit = Math.min(xAnchors.length, 18);
    const yLimit = Math.min(yAnchors.length, 18);
    for (let yi = 0; yi < yLimit; yi++) {
      for (let xi = 0; xi < xLimit; xi++) {
        addCandidate(xAnchors[xi], yAnchors[yi]);
      }
    }

    return candidates
      .sort((left, right) =>
        this._scorePreparedEdgePlacementCandidate(left, orient, workWidth, workHeight) -
          this._scorePreparedEdgePlacementCandidate(right, orient, workWidth, workHeight)
      )
      .slice(0, MAX_SPLIT_EDGE_PLACEMENT_CANDIDATES);
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

  _isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight) {
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

    return true;
  }

  _canPlaceSplitOrient(orient, x, y, occupiedPlacements, workWidth, workHeight, spacing) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = x + bb.minX;
    const minY = y + bb.minY;
    const maxX = x + bb.maxX;
    const maxY = y + bb.maxY;
    const spacingPad = Math.max(0, spacing || 0);

    if (
      minX < -1e-6 ||
      minY < -1e-6 ||
      maxX > workWidth + 1e-6 ||
      maxY > workHeight + 1e-6
    ) {
      return false;
    }

    for (const placement of occupiedPlacements) {
      const otherOrient = placement.orient;
      const otherBounds = otherOrient?.bb || getBoundingBox(otherOrient?.polygon || []);
      const otherMinX = placement.x + otherBounds.minX;
      const otherMinY = placement.y + otherBounds.minY;
      const otherMaxX = placement.x + otherBounds.maxX;
      const otherMaxY = placement.y + otherBounds.maxY;

      if (
        maxX + spacingPad < otherMinX ||
        minX - spacingPad > otherMaxX ||
        maxY + spacingPad < otherMinY ||
        minY - spacingPad > otherMaxY
      ) {
        continue;
      }

      if (
        !cachedPolygonsOverlap(
          orient.polygon,
          otherOrient.polygon,
          { x, y },
          { x: placement.x, y: placement.y },
          spacing,
          bb,
          otherBounds
        )
      ) {
        continue;
      }

      return false;
    }

    if (!this._isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight)) {
      return false;
    }

    return true;
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
          : Math.max(0, direction.sign > 0 ? rightBounds.minY - lastBounds.maxY : lastBounds.minY - rightBounds.maxY);
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
      .slice(0, MAX_SPLIT_PARTNER_NEAR_CANDIDATES);
  }

  _compactSplitFillCandidatePlacement(candidate, orient, occupiedPlacements, config, workWidth, workHeight) {
    const spacing = config.spacing || 0;
    const step = Math.max(0.1, (config.gridStep || 1) / 4);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;

    let currentX = candidate.x;
    let currentY = candidate.y;

    const isSafe = (cx, cy) => {
      return this._canPlaceSplitOrient(
        orient,
        cx,
        cy,
        occupiedPlacements,
        workWidth,
        workHeight,
        spacing
      );
    };

    if (!isSafe(currentX, currentY)) return candidate;

    const directions = [
      { axis: 'x', sign: -1 }, // Left
      { axis: 'x', sign: 1 },  // Right
      { axis: 'y', sign: -1 }, // Up
      { axis: 'y', sign: 1 }   // Down
    ];

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
            currentX = roundedX;
            currentY = roundedY;
            moved = true;
          }
        }
      }
    }

    return { x: currentX, y: currentY };
  }

  _compactSplitPartnerPlacement(candidate, orient, lastPlacement, occupiedPlacements, config, workWidth, workHeight) {
    const direction = this._getSplitPartnerDirection(lastPlacement, orient);
    if (!direction) return candidate;

    const spacing = config.spacing || 0;
    const step = Math.max(0.25, (config.gridStep || 1) / 2);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minStart = direction.axis === 'x' ? -bb.minX : -bb.minY;
    const maxStart = direction.axis === 'x' ? workWidth - bb.maxX : workHeight - bb.maxY;
    const startValue = direction.axis === 'x' ? candidate.x : candidate.y;
    const isSafe = (value) => {
      const x = direction.axis === 'x' ? value : candidate.x;
      const y = direction.axis === 'y' ? value : candidate.y;
      return this._canPlaceSplitOrient(
        orient,
        x,
        y,
        occupiedPlacements,
        workWidth,
        workHeight,
        spacing
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
    maxOptions = MAX_SPLIT_FILL_OPTIONS_PER_STATE
  ) {
    const options = [];
    const seen = new Set();

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
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
        if (options.length >= maxOptions * 2) break;
      }
      if (options.length >= maxOptions * 2) break;
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
      const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(fineCompacted.x, 3)}|${roundMetric(fineCompacted.y, 3)}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: roundMetric(fineCompacted.x, 3),
        y: roundMetric(fineCompacted.y, 3)
      });
    }

    return compactedOptions;
  }

  _getSplitPairPartnerFoot(foot) {
    if (foot === 'split-left') return 'split-right';
    if (foot === 'split-right') return 'split-left';
    return null;
  }

  _getSplitPlacementPairStats(placements = []) {
    let leftCount = 0;
    let rightCount = 0;
    for (const placement of placements) {
      if (placement?.orient?.foot === 'split-left') leftCount += 1;
      if (placement?.orient?.foot === 'split-right') rightCount += 1;
    }

    const splitPairCount = Math.min(leftCount, rightCount);
    const splitUnpairedCount = Math.abs(leftCount - rightCount);
    return {
      splitLeftCount: leftCount,
      splitRightCount: rightCount,
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
    maxOptions = MAX_SPLIT_FILL_OPTIONS_PER_STATE
  ) {
    const freeRects = this._buildPreparedSplitFreeRects(
      occupiedPlacements,
      workWidth,
      workHeight,
      config.spacing
    );
    const options = [];
    const seen = new Set();

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      const compatibleRects = freeRects.filter((rect) =>
        rect.width + 1e-6 >= orient.width &&
        rect.height + 1e-6 >= orient.height
      );

      for (const rect of compatibleRects) {
        const placementCandidates = this._buildPreparedRectPlacementCandidates(rect, orient, step);
        for (const candidate of placementCandidates) {
          if (!this._canPlaceSplitOrient(
            orient,
            candidate.x,
            candidate.y,
            occupiedPlacements,
            workWidth,
            workHeight,
            config.spacing
          )) {
            continue;
          }

          this._pushSplitPlacementOption(options, seen, {
            orient,
            x: candidate.x,
            y: candidate.y,
            effectiveArea: orient.areaMm2
          }, workWidth, workHeight);
          if (options.length >= maxOptions * 2) break;
        }
        if (options.length >= maxOptions * 2) break;
      }
      if (options.length >= maxOptions * 2) break;
    }

    for (const orient of orientVariants) {
      if (options.length >= maxOptions * 2) break;
      if (filterFn && !filterFn(orient)) continue;
      const boundaryCandidates = this._buildPreparedBoundaryPlacementCandidates(
        orient,
        workWidth,
        workHeight,
        step
      );

      for (const candidate of boundaryCandidates) {
        if (!this._canPlaceSplitOrient(
          orient,
          candidate.x,
          candidate.y,
          occupiedPlacements,
          workWidth,
          workHeight,
          config.spacing
        )) {
          continue;
        }

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: candidate.x,
          y: candidate.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight);
        if (options.length >= maxOptions * 2) break;
      }
    }

    for (const orient of orientVariants) {
      if (options.length >= maxOptions * 2) break;
      if (filterFn && !filterFn(orient)) continue;
      const edgeCandidates = this._buildPreparedEdgePlacementCandidates(
        occupiedPlacements,
        orient,
        workWidth,
        workHeight,
        step
      );

      for (const candidate of edgeCandidates) {
        if (!this._canPlaceSplitOrient(
          orient,
          candidate.x,
          candidate.y,
          occupiedPlacements,
          workWidth,
          workHeight,
          config.spacing
        )) {
          continue;
        }

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: candidate.x,
          y: candidate.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight);
        if (options.length >= maxOptions * 2) break;
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
      const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(fineCompacted.x, 3)}|${roundMetric(fineCompacted.y, 3)}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: roundMetric(fineCompacted.x, 3),
        y: roundMetric(fineCompacted.y, 3)
      });
    }

    return compactedOptions;
  }

  _rankSplitFillState(state) {
    const pairStats = this._getSplitPlacementPairStats(state.extraPlacements);
    const bounds = computeEnvelope(state.occupiedPlacements);
    return {
      count: state.extraPlacements.length,
      pairs: pairStats.splitPairCount,
      unpaired: pairStats.splitUnpairedCount,
      height: bounds.height,
      width: bounds.width,
      waste: bounds.width * bounds.height
    };
  }

  _compareSplitFillStates(left, right) {
    const leftRank = this._rankSplitFillState(left);
    const rightRank = this._rankSplitFillState(right);
    return rightRank.count - leftRank.count
      || rightRank.pairs - leftRank.pairs
      || leftRank.unpaired - rightRank.unpaired
      || leftRank.height - rightRank.height
      || leftRank.width - rightRank.width
      || leftRank.waste - rightRank.waste;
  }

  _dedupeSplitFillStates(states) {
    const unique = [];
    const seen = new Set();
    for (const state of states.sort((left, right) => this._compareSplitFillStates(left, right))) {
      const key = state.extraPlacements
        .map((placement) => `${placement.orient.foot}:${placement.orient.angle}:${roundMetric(placement.x, 1)}:${roundMetric(placement.y, 1)}`)
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(state);
      if (unique.length >= MAX_SPLIT_FILL_BEAM_WIDTH) break;
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
    for (const firstOrient of orientVariants) {
      const partnerFoot = this._getSplitPairPartnerFoot(firstOrient?.foot);
      if (!partnerFoot) continue;

      for (const secondOrient of orientVariants) {
        if (secondOrient?.foot !== partnerFoot) continue;
        if (secondOrient?.splitPairAngleFamily !== firstOrient?.splitPairAngleFamily) continue;
        const key = `${firstOrient.foot}:${firstOrient.angle}|${secondOrient.foot}:${secondOrient.angle}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const template = this._buildTightSplitPairTemplate(firstOrient, secondOrient, config, step);
        if (!template) continue;
        templates.push({
          ...template,
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
      .slice(0, MAX_SPLIT_PAIR_TEMPLATES);
  }

  _canPlaceSplitPairTemplate(template, originX, originY, occupiedPlacements, config, workWidth, workHeight) {
    const placed = template.placements.map((placement) => ({
      ...placement,
      x: roundMetric(originX + placement.x, 3),
      y: roundMetric(originY + placement.y, 3)
    }));

    for (let index = 0; index < placed.length; index++) {
      const previous = [...occupiedPlacements, ...placed.slice(0, index)];
      if (!this._canPlaceSplitOrient(
        placed[index].orient,
        placed[index].x,
        placed[index].y,
        previous,
        workWidth,
        workHeight,
        config.spacing
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

    for (const placement of occupiedPlacements) {
      const bounds = this._getPlacementBounds(placement);
      const candidateOrigins = [
        { x: bounds.minX - template.width, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.minY - template.height },
        { x: bounds.minX, y: bounds.maxY }
      ];
      for (const origin of candidateOrigins) {
        for (const dx of [-safeStep, 0, safeStep]) {
          for (const dy of [-safeStep, 0, safeStep]) {
            addOrigin(origin.x + dx, origin.y + dy);
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
    maxOptions = MAX_SPLIT_PAIR_GROUP_OPTIONS_PER_STATE
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
    if (config.preparedSplitFillEnabled !== true) return [];

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
      Math.ceil((remainingAreaMm2 / minHalfArea) * MAX_SPLIT_FILL_SAFETY_MULTIPLIER)
    );
    const maxExtraFillers = Number.isFinite(config.preparedSplitFillMaxPieces)
      ? Math.max(1, config.preparedSplitFillMaxPieces)
      : physicalSafetyLimit;

    const orientVariants = [];
    for (const angle of this._getSplitFillAngles(config)) {
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
      extraPlacements: []
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
            MAX_SPLIT_PAIR_GROUP_OPTIONS_PER_STATE
          );

          for (const groupOption of groupOptions) {
            const nextGroupPlacements = groupOption.placements.map((placement, index) => ({
              ...placement,
              id: `split_fill_${state.extraPlacements.length + index}`
            }));
            expandedStates.push({
              occupiedPlacements: [...state.occupiedPlacements, ...nextGroupPlacements],
              extraPlacements: [...state.extraPlacements, ...nextGroupPlacements]
            });
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
              MAX_SPLIT_FILL_OPTIONS_PER_STATE
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
                MAX_SPLIT_FILL_OPTIONS_PER_STATE
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
            MAX_SPLIT_FILL_OPTIONS_PER_STATE
        );
        const seenOptions = new Set(options.map((option) =>
          `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`
        ));
        for (const option of genericOptions) {
          const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`;
          if (seenOptions.has(key)) continue;
          seenOptions.add(key);
          options.push(option);
        }
        options = [
          ...options.slice(0, Math.ceil(MAX_SPLIT_FILL_OPTIONS_PER_STATE / 2)),
          ...genericOptions
            .filter((option) => {
              const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`;
              return seenOptions.has(key);
            })
            .slice(0, Math.floor(MAX_SPLIT_FILL_OPTIONS_PER_STATE / 2))
        ].slice(0, MAX_SPLIT_FILL_OPTIONS_PER_STATE);

        for (const option of options) {
          const nextPlacement = {
            ...option,
            id: `split_fill_${state.extraPlacements.length}`
          };
          expandedStates.push({
            occupiedPlacements: [...state.occupiedPlacements, nextPlacement],
            extraPlacements: [...state.extraPlacements, nextPlacement]
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
    if (config.preparedSplitFillPreferPairs !== false) {
      return this._balanceSplitFillPlacementsForPairs(extraPlacements);
    }

    return extraPlacements;
  }

  _augmentCandidateWithSplitFillers(sizeName, polygon, candidate, config, workWidth, workHeight) {
    const primaryExtraPlacements = this._findSplitFillPlacements(
      sizeName,
      polygon,
      candidate,
      config,
      workWidth,
      workHeight
    );
    const extraPlacementVariants = [primaryExtraPlacements]
      .filter((placements) => placements?.length);
    if (!extraPlacementVariants.length) return candidate;

    const {
      placedCount: _ignoredPlacedCount,
      usedWidthMm: _ignoredUsedWidthMm,
      usedHeightMm: _ignoredUsedHeightMm,
      envelopeWasteMm2: _ignoredEnvelopeWasteMm2,
      efficiency: _ignoredEfficiency,
      ...candidateMetadata
    } = candidate;
    let bestAugmentedCandidate = candidate;

    for (const extraPlacements of extraPlacementVariants) {
      const usableExtraCount = extraPlacements.length;
      const keptPlacements = extraPlacements.slice(0, usableExtraCount);
      const pairStats = this._getSplitPlacementPairStats(keptPlacements);
      const usedAreaMm2 = (candidate.usedAreaMm2 ?? candidate.placedCount * candidate.pieceArea)
        + keptPlacements.reduce((sum, placement) => sum + (placement.effectiveArea || 0), 0);

      const augmentedCandidate = this._buildCandidate(
        sizeName,
        candidate.selectedFoot ?? candidate.foot ?? candidate.placements?.[0]?.orient?.foot ?? 'L',
        candidate.pieceArea,
        [...candidate.placements, ...keptPlacements],
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
      const finalized = augmentedCandidate ? this._finalizeCandidate(augmentedCandidate, config) : null;
      if (finalized && compareDoubleInsoleCandidates(finalized, bestAugmentedCandidate) < 0) {
        bestAugmentedCandidate = finalized;
      }
    }

    return bestAugmentedCandidate;
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
    const variants = [];
    const bodyCols = this._countCols(orient.width, dxMm, workWidth);
    const rowShiftRange = orient.width * 0.45;
    const geometricShiftCandidates = extractInternalGapShiftCandidates(orient, step);
    const rowShiftCandidates = selectPrimaryRowShiftCandidates(
      geometricShiftCandidates,
      buildShiftCandidates(rowShiftRange, step, SHIFT_SCAN_LIMIT),
      MAX_SHIFT_CANDIDATES
    );
    const rowShiftPairs = buildRowShiftPairs(orient, step, rowShiftCandidates);

    if (bodyCols > 0) {
      const uniformRowPlacements = this._buildShiftedUniformPlacements(
        orient,
        bodyCols,
        1,
        dxMm,
        orient.height + config.spacing + step * 2,
        0,
        0,
        0
      );
      const uniformBodyHeightMm = roundMetric(
        getPlacementsBottom(uniformRowPlacements) - getPlacementsTop(uniformRowPlacements),
        3
      );
      const alignedDyMm = this._findUniformDy(orient, dxMm, config, step);
      if (alignedDyMm != null) {
        variants.push({
          rowPlacements: uniformRowPlacements,
          bodyCols,
          bodyDxMm: dxMm,
          bodyHeightMm: uniformBodyHeightMm,
          bodyDyMm: alignedDyMm,
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          scanOrder: 'uniform-pitch-grid',
          bodyPatternMode: 'double-insole-uniform-pitch'
        });
      }

      for (const { rowShiftXmm, rowShiftYmm } of rowShiftPairs) {
        const shiftedDyMm = this._findShiftedUniformDy(orient, dxMm, rowShiftXmm, rowShiftYmm, config, step);
        if (shiftedDyMm == null) continue;
        variants.push({
          rowPlacements: uniformRowPlacements,
          bodyCols,
          bodyDxMm: dxMm,
          bodyHeightMm: uniformBodyHeightMm,
          bodyDyMm: shiftedDyMm,
          rowShiftXmm: roundMetric(rowShiftXmm),
          rowShiftYmm: roundMetric(rowShiftYmm),
          scanOrder: 'staggered-double-contour',
          bodyPatternMode: 'double-insole-staggered-row-shift'
        });
      }
    }

    const sequentialRows = [
      {
        placements: this._buildSequentialBodyRow(
          orient,
          orient,
          'rows',
          workWidth,
          config,
          step
        ),
        scanOrder: 'sequential-double-contour',
        bodyPatternMode: 'double-insole-sequential-row',
        primaryAngle: orient.angle,
        alternateAngle: orient.angle
      }
    ];

    if (pairedOrient && normalizeAngleDegrees(pairedOrient.angle) !== normalizeAngleDegrees(orient.angle)) {
      sequentialRows.push({
        placements: this._buildSequentialBodyRow(
          orient,
          pairedOrient,
          'rows',
          workWidth,
          config,
          step
        ),
        scanOrder: 'paired-sequential-double-contour',
        bodyPatternMode: 'double-insole-paired-sequential-row',
        primaryAngle: orient.angle,
        alternateAngle: pairedOrient.angle
      });
    }

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
        const shiftedDyMm = this._findShiftedRowPitch(sequentialRowPlacements, rowShiftXmm, rowShiftYmm, config, step);
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

    return limitDoubleContourVariants(variants, workHeight, config.doubleContourVariantLimit);
  }

  _evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    let bestCandidate = null;
    const candidatePool = [];
    const angleStates = [];

    for (const angle of angles) {
      const orient = this._decorateOrient(sizeName, foot, polygon, angle, config, step);
      const pairedOrient = this._decorateOrient(
        sizeName,
        foot,
        polygon,
        normalizeAngleDegrees(angle + 180),
        config,
        step
      );
      const dxMm = this._findUniformDx(orient, config, step);
      if (dxMm == null) continue;

      const variants = this._buildDoubleContourVariants(orient, dxMm, workWidth, workHeight, config, step, pairedOrient);
      if (!variants.length) continue;

      let filler90Orient = null;
      let filler90DxMm = null;
      let filler90DyMm = null;
      let filler90Cols = 0;
      let maxFiller90Rows = 0;

      if (config.allowRotate90 !== false) {
        const filler90Angle = (angle + 90) % 360;
        filler90Orient = this._decorateOrient(sizeName, foot, polygon, filler90Angle, config, step);
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
        const bodyRows = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight);
        if (!bodyCols || !bodyRows) continue;

        const bodyPlacements = this._buildRepeatedBodyPlacements(
          variant.rowPlacements,
          bodyRows,
          variant.bodyDyMm,
          0,
          variant.rowShiftXmm,
          variant.rowShiftYmm
        );
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
        const finalizedBodyOnlyCandidate = bodyOnlyCandidate ? this._finalizeCandidate(bodyOnlyCandidate, config) : null;
        if (finalizedBodyOnlyCandidate && compareDoubleInsoleCandidates(finalizedBodyOnlyCandidate, bestCandidate) < 0) {
          bestCandidate = finalizedBodyOnlyCandidate;
        }
        addRankedCandidate(candidatePool, finalizedBodyOnlyCandidate, config.preparedSplitFillCandidateLimit);
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
        const bodyRowsNoFiller = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight);
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
          fillerRowCountOptions = fillerRowCountOptions.length > 1
            ? [0, fillerRowCountOptions[fillerRowCountOptions.length - 1]]
            : [0];
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
                  const bodyPlacements = this._buildRepeatedBodyPlacements(
                    variant.rowPlacements,
                    bodyRows,
                    variant.bodyDyMm,
                    bodyStartY,
                    variant.rowShiftXmm,
                    variant.rowShiftYmm
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
                  const placements = [...topFillerPlacements, ...bodyPlacements, ...bottomFillerPlacements];

                  const candidate = this._buildCandidate(
                    sizeName,
                    foot,
                    pieceArea,
                    placements,
                    {
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
                    },
                    workWidth,
                    workHeight,
                    config
                  );

                  const finalizedCandidate = candidate ? this._finalizeCandidate(candidate, config) : null;
                  if (finalizedCandidate && compareDoubleInsoleCandidates(finalizedCandidate, bestCandidate) < 0) {
                    bestCandidate = finalizedCandidate;
                  }
                  addRankedCandidate(candidatePool, finalizedCandidate, config.preparedSplitFillCandidateLimit);
                }
              }
            }
          }
        }
      }
    }

    if (config.preparedSplitFillEnabled === true && candidatePool.length) {
      const splitCandidates = candidatePool.length ? candidatePool : [bestCandidate];
      for (const candidate of splitCandidates) {
        if (!candidate?.placements?.length) continue;
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

    return bestCandidate;
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const preferredAngles = this._getDoubleContourPreferredAngles(config);
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
      : fallbackSameSideCandidate;
    if (
      fallbackCandidate &&
      (
        !bestCandidate ||
        compareDoubleInsoleCandidates(fallbackCandidate, bestCandidate) < 0
      )
    ) {
      bestCandidate = fallbackCandidate;
    }

    return bestCandidate;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const renderKey = `${placement.orient.foot}_${placement.orient.angle}`;

      if (!renderTemplates[renderKey]) {
        renderTemplates[renderKey] = {
          path: polygon.map((point, pointIndex) =>
            `${pointIndex === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
          ).join(' ') + ' Z',
          internalsPaths: [],
          labelOffset: {
            x: roundMetric(polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length),
            y: roundMetric(polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length)
          }
        };
      }

      return {
        id: `${sizeName}_${placement.orient.foot}_${index}`,
        sizeName,
        foot: placement.orient.foot,
        x: roundMetric(worldX, 3),
        y: roundMetric(worldY, 3),
        angle: placement.orient.angle,
        polygon: translate(polygon, worldX, worldY),
        cycPolygon: translate(placement.orient.cycPolygon || polygon, worldX, worldY),
        internals: [],
        renderKey,
        areaMm2: placement.effectiveArea
          ?? placement.orient.areaMm2
          ?? polygonArea(polygon)
      };
    });

    return { placed: items, renderTemplates };
  }

  _finalizeCandidate(candidate, config) {
    if (!candidate?.placements?.length) return null;

    const bounds = candidate.bounds || computeEnvelope(candidate.placements);
    const materialized = this._materializePlacedItems(candidate.sizeName, candidate.placements, config);
    const usedAreaMm2 = candidate.usedAreaMm2
      ?? materialized.placed.reduce((sum, item) => sum + (item.areaMm2 || 0), 0);

    return {
      ...candidate,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      usedAreaMm2,
      envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - usedAreaMm2)),
      ...materialized,
      bounds
    };
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const placedCount = candidate.placed.length;
    const usedAreaMm2 = candidate.usedAreaMm2
      ?? candidate.placed.reduce((sum, item) => sum + (item.areaMm2 || 0), 0);
    const efficiency = totalArea > 0
      ? roundMetric((usedAreaMm2 / totalArea) * 100, 1)
      : 0;

    return {
      sheetIndex: 0,
      placed: candidate.placed,
      renderTemplates: candidate.renderTemplates,
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placedCount,
      efficiency,
      patternInfo: {
        algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
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

  async _testCapacityParallel(sizeList, config) {
    const startTime = Date.now();
    const cachedResults = new Array(sizeList.length).fill(null);
    const uncachedTasks = [];

    for (let index = 0; index < sizeList.length; index++) {
      const size = sizeList[index];
      const cacheKey = buildCapacityResultCacheKey('same-side-double-contour', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
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

    const workerCount = resolveDoubleContourWorkerCount(uncachedTasks, config);
    const orderedTasks = orderTasksByEstimatedWeight(
      uncachedTasks,
      (task) => estimateDoubleContourTaskWeight(task.size, task.config)
    );
    const workerResults = orderedTasks.length
      ? await executeDoubleContourTasksInParallel(orderedTasks, workerCount)
      : [];
    const sheetsBySize = {};
    const summary = [];

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
      summary.push(summaryItem);
      sheetsBySize[summaryItem.sizeName] = sheet;
    }

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

  async testCapacity(sizeList, overrideConfig = {}) {
    const explicitDeepSplitFill = overrideConfig.preparedSplitFillDeep ?? this.config.preparedSplitFillDeep;
    const deepSplitFillEnabled = explicitDeepSplitFill == null
      ? sizeList.length === 1
      : explicitDeepSplitFill === true;
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
        ?? (deepSplitFillEnabled ? DEEP_SPLIT_AUGMENT_CANDIDATES : 1)
    };

    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

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
      return this._testCapacityParallel(normalizedSizeList, config);
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
        summary.push(cachedResult.summaryItem);
        sheetsBySize[size.sizeName] = cachedResult.sheet;
        continue;
      }

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
        const summaryItem = buildEmptyDoubleContourSummaryItem(size);
        summary.push(summaryItem);
        sheetsBySize[size.sizeName] = null;
        setCachedCapacityResult(cacheKey, {
          summaryItem,
          sheet: null
        });
        continue;
      }

      const sheet = this._buildSheetFromCandidate(size.sizeName, candidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;
      const summaryItem = buildDoubleContourSummaryItem(size, sheet);
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
