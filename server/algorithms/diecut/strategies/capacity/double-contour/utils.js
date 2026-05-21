import { Worker, isMainThread } from 'worker_threads';



import {
  getBoundingBox
} from '../../../core/polygonUtils.js';

import {
  computeEnvelope,
  roundMetric,
  rotateVector,
  resolveAxisSideFromVector
} from '../patternCapacityUtils.js';

export { rotateVector, resolveAxisSideFromVector };




export const DOUBLE_CONTOUR_CAPACITY_WORKER_URL = new URL('../../../../workers/diecutCapacitySameSideWorker.js', import.meta.url);

// All hardcoded constants have been replaced by adaptive logic in the methods below
export const DEFAULT_DOUBLE_CONTOUR_FINE_ROTATE_OFFSETS = [0];

export function getWholePairsPlaced(candidate = {}) {
  const pairValue = candidate.maxPairsPlaced
    ?? candidate.actualPairs
    ?? candidate.pairs
    ?? Math.floor((candidate.placedCount || 0) / 2);
  return Math.max(0, Math.floor(Number(pairValue) || 0));
}

export function computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2 = 0) {
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

export function computeCandidateUsedArea(candidate = {}) {
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

export function attachLeftoverMetrics(candidate, workWidth, workHeight) {
  if (!candidate) return candidate;
  const bounds = candidate.bounds || (candidate.placements?.length ? computeEnvelope(candidate.placements) : null);
  const usedAreaMm2 = computeCandidateUsedArea(candidate);
  return {
    ...candidate,
    maxPairsPlaced: getWholePairsPlaced(candidate),
    ...computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2)
  };
}

function isSplitPlacement(placement = {}) {
  const id = placement.id || '';
  const foot = placement.orient?.foot || placement.foot || '';
  return id.startsWith('split_fill_')
    || id.startsWith('margin_fill_')
    || foot.startsWith('split-')
    || placement.isSplit === true;
}

export function getWholePlacementCount(candidate = {}) {
  if (Array.isArray(candidate.placements)) {
    return candidate.placements.filter((placement) => !isSplitPlacement(placement)).length;
  }

  if (Number.isFinite(candidate.dcCount)) {
    return Math.max(0, Number(candidate.dcCount));
  }

  const bodyCount = Number.isFinite(candidate.bodyCount)
    ? Math.max(0, Number(candidate.bodyCount))
    : null;
  const filler90Count = Number.isFinite(candidate.filler90Count)
    ? Math.max(0, Number(candidate.filler90Count))
    : 0;
  if (bodyCount != null) {
    return bodyCount + filler90Count;
  }

  return getWholePairsPlaced(candidate);
}

export function compareDoubleInsoleCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;

  const nextWholeCount = getWholePlacementCount(nextCandidate);
  const bestWholeCount = getWholePlacementCount(bestCandidate);
  if (nextWholeCount !== bestWholeCount) {
    return bestWholeCount - nextWholeCount;
  }

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
    return (nextCandidate.splitUnpairedCount || 0) - (bestCandidate.splitUnpairedCount || 0);
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
  if (nextCandidate.bodyCount !== bestCandidate.bodyCount) {
    return bestCandidate.bodyCount - nextCandidate.bodyCount;
  }
  if (nextCandidate.filler90Count !== bestCandidate.filler90Count) {
    return nextCandidate.filler90Count - bestCandidate.filler90Count;
  }
  if ((nextCandidate.filler90StartY || 0) !== (bestCandidate.filler90StartY || 0)) {
    return (bestCandidate.filler90StartY || 0) - (nextCandidate.filler90StartY || 0);
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

export function buildShiftCandidates(range, step, limit = 9) {
  if (!Number.isFinite(range) || range <= 0) return [0];
  const safeStep = Math.max(step, 0.25);
  const candidates = new Set([0]);
  const steps = Math.max(1, limit);
  const increment = Math.max(safeStep, range / steps);

  for (let value = increment; value <= range + 1e-6; value += increment) {
    const rounded = roundMetric(value, 3);
    if (Math.abs(rounded) < safeStep * 0.5) continue;
    candidates.add(rounded);
    candidates.add(-rounded);
  }
  
  // Add some finer steps around the most promising areas
  const fineIncrement = increment / 3;
  for (let value = increment; value <= range + 1e-6; value += increment) {
      candidates.add(roundMetric(value - fineIncrement, 3));
      candidates.add(roundMetric(value + fineIncrement, 3));
  }

  return [...candidates].sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

export function buildHorizontalIntervalsAtY(polygon, y) {
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

export function extractInternalGapShiftCandidates(orient, step) {
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



export function selectPrimaryRowShiftCandidates(geometricCandidates, sampledCandidates, limit = 12) {
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

export function addRankedCandidate(candidatePool, candidate, limit = 30) {
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



export function buildFillerRowCountChoices(maxRows) {
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

export function shouldTryFillerRowCombination(topRows, bottomRows, maxRows) {
  const totalRows = topRows + bottomRows;
  if (totalRows <= 2) return true;
  return topRows === maxRows || bottomRows === maxRows;
}

export function rankDoubleContourVariant(variant, workWidth, workHeight) {
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


export function buildRowShiftPairs(orient, step, shiftXCandidates) {
  const pairs = [];
  const shiftYCandidates = [0];
  
  const pieceArea = orient.areaMm2 || 15000;
  const pieceHeight = orient.height || 150;
  
  // PHYSICAL ADAPTIVITY: Instead of 'Size' names, use piece area and height
  // Smaller pieces (Area < 18000) are high-density targets and need finer search.
  // Larger pieces (Area > 28000) are bulky and need fewer variations but larger shifts.
  const isSmall = pieceArea < 18000;
  const isLarge = pieceArea > 28000;

  if (pieceHeight > 0) {
    // Super granular 0.5mm search for small pieces, 1.0mm for standard/large
    const safeStep = isSmall ? 0.5 : 1.0; 
    const range = Math.min(pieceHeight * 0.85, 85); 
    for (let y = safeStep; y <= range; y += safeStep) {
      shiftYCandidates.push(roundMetric(y, 3));
      shiftYCandidates.push(roundMetric(-y, 3));
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

  // ADAPTIVE LIMITS: Smaller pieces need significantly more candidates (250+) 
  // to find the 'magical' interlocking point.
  const y0Limit = isSmall ? 200 : (isLarge ? 60 : 80);
  const yShiftLimit = isSmall ? 600 : (isLarge ? 120 : 200);

  const combined = [...y0Pairs.slice(0, y0Limit), ...yShiftPairs.slice(0, yShiftLimit)];
  const seen = new Set();
  return combined.filter(p => {
    const key = `${p.rowShiftXmm}_${p.rowShiftYmm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}







export function quantizeWithinBounds(value, step, maxValue) {
  const safeStep = Math.max(0.25, step || 1);
  const quantized = Math.round(value / safeStep) * safeStep;
  return roundMetric(Math.max(0, Math.min(maxValue, quantized)), 3);
}

export function buildAxisCandidates(minValue, maxValue, step, pieceDim = 0) {
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


export function buildDenseAxisCandidates(minValue, maxValue, step, maxSamples = 100) {
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



export function normalizeAngleDegrees(angle) {
  return ((roundMetric(Number(angle), 3) % 360) + 360) % 360;
}

export function getPlacementBounds(placement) {
  const bb = placement?.orient?.bb || getBoundingBox(placement?.orient?.polygon || []);
  return {
    minX: placement.x + bb.minX,
    minY: placement.y + bb.minY,
    maxX: placement.x + bb.maxX,
    maxY: placement.y + bb.maxY
  };
}

export function getPlacementsTop(placements = []) {
  if (!placements.length) return 0;
  let minY = Infinity;
  for (const placement of placements) {
    minY = Math.min(minY, getPlacementBounds(placement).minY);
  }
  return roundMetric(minY, 3);
}

export function getPlacementsBottom(placements = []) {
  let maxY = 0;
  for (const placement of placements) {
    maxY = Math.max(maxY, getPlacementBounds(placement).maxY);
  }
  return roundMetric(maxY, 3);
}

export function getPlacementsLeft(placements = []) {
  if (!placements.length) return 0;
  let minX = Infinity;
  for (const placement of placements) {
    minX = Math.min(minX, getPlacementBounds(placement).minX);
  }
  return roundMetric(minX, 3);
}

export function getPlacementsRight(placements = []) {
  if (!placements.length) return 0;
  let maxX = -Infinity;
  for (const placement of placements) {
    maxX = Math.max(maxX, getPlacementBounds(placement).maxX);
  }
  return roundMetric(maxX, 3);
}

export function getAveragePitchX(placements = []) {
  if (placements.length < 2) return null;
  let total = 0;
  for (let index = 1; index < placements.length; index++) {
    total += placements[index].x - placements[index - 1].x;
  }
  return roundMetric(total / (placements.length - 1), 3);
}




export function shouldUseParallelDoubleContourCapacity(sizeList, config) {
  return isMainThread
    && config.parallelSizes !== false
    && config.capacityLayoutMode === 'same-side-double-contour'
    && sizeList.length > 1;
}





export function runDoubleContourWorkerTask(worker, task) {
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

export async function executeDoubleContourTasksInParallel(tasks, concurrency, onProgress) {
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
