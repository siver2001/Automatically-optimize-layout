import { BaseNesting } from '../../core/BaseNesting.js';
import { Worker, isMainThread } from 'worker_threads';
import {
  normalizeToOrigin,
  area as polygonArea,
  polygonsOverlap
} from '../../core/polygonUtils.js';
import {
  getOrientBounds,
  roundMetric,
  validateLocalPlacements,
  computeEnvelope,
  validatePatternPlacements
} from './patternCapacityUtils.js';
import {
  buildCapacityResultCacheKey,
  getCachedCapacityResult,
  setCachedCapacityResult
} from './capacityResultCache.js';
import {
  orderTasksByEstimatedWeight,
  resolveAdaptiveParallelWorkerCount
} from './parallelCapacityUtils.js';

function compareAlignedCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.bodyCount !== bestCandidate.bodyCount) {
    return bestCandidate.bodyCount - nextCandidate.bodyCount;
  }
  if (nextCandidate.filler90Count !== bestCandidate.filler90Count) {
    return nextCandidate.filler90Count - bestCandidate.filler90Count;
  }
  if ((nextCandidate.fillerPatternPriority ?? 99) !== (bestCandidate.fillerPatternPriority ?? 99)) {
    return (nextCandidate.fillerPatternPriority ?? 99) - (bestCandidate.fillerPatternPriority ?? 99);
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.usedWidthMm !== bestCandidate.usedWidthMm) {
    return nextCandidate.usedWidthMm - bestCandidate.usedWidthMm;
  }
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

function buildUpperBound(step, ...values) {
  return Math.max(step, ...values);
}

function findMinimalContinuousValue(minValue, maxValue, precision, isSafe) {
  if (minValue > maxValue) return null;
  if (!isSafe(maxValue)) return null;

  let low = minValue;
  let high = maxValue;
  while (high - low > precision) {
    const mid = (low + high) / 2;
    if (isSafe(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const roundedHigh = roundMetric(high, 3);
  if (isSafe(roundedHigh)) {
    return roundedHigh;
  }

  let candidate = roundedHigh;
  while (candidate <= maxValue + 1e-6) {
    candidate = roundMetric(candidate + 0.001, 3);
    if (candidate > maxValue + 1e-6) break;
    if (isSafe(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getPlacementsBottom(placements) {
  let maxY = 0;
  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    maxY = Math.max(maxY, placement.y + bb.maxY);
  }
  return maxY;
}

function getPlacementsTop(placements) {
  if (!placements.length) return 0;
  let minY = Infinity;
  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    minY = Math.min(minY, placement.y + bb.minY);
  }
  return minY;
}

function getAveragePitchX(placements) {
  if (placements.length < 2) return null;
  let total = 0;
  for (let index = 1; index < placements.length; index++) {
    total += placements[index].x - placements[index - 1].x;
  }
  return roundMetric(total / (placements.length - 1));
}

function countAlternatingPieces(row0Placements, row1Placements, rows) {
  let total = 0;
  for (let row = 0; row < rows; row++) {
    total += row % 2 === 0 ? row0Placements.length : row1Placements.length;
  }
  return total;
}

function buildRelativeSvgPath(polygon) {
  if (!polygon || polygon.length < 2) return '';
  return polygon.map((point, index) => {
    const x = point.x.toFixed(2);
    const y = point.y.toFixed(2);
    return `${index === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ') + ' Z';
}

function getRelativeCentroid(polygon) {
  if (!polygon || polygon.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const point of polygon) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: roundMetric(sumX / polygon.length),
    y: roundMetric(sumY / polygon.length)
  };
}

function getRenderKey(orient) {
  return `${orient.foot}_${orient.angle}`;
}

function getPlacementWorldBounds(placement) {
  const bb = getOrientBounds(placement.orient);
  return {
    bb,
    minX: placement.x + bb.minX,
    minY: placement.y + bb.minY,
    maxX: placement.x + bb.maxX,
    maxY: placement.y + bb.maxY
  };
}

function hasCrossPlacementOverlap(firstPlacements, secondPlacements, spacing) {
  if (!firstPlacements.length || !secondPlacements.length) return false;

  const firstIndexed = firstPlacements.map((placement) => ({
    placement,
    bounds: getPlacementWorldBounds(placement)
  }));
  const secondIndexed = secondPlacements.map((placement) => ({
    placement,
    bounds: getPlacementWorldBounds(placement)
  }));

  for (const first of firstIndexed) {
    for (const second of secondIndexed) {
      if (
        first.bounds.maxX + spacing < second.bounds.minX ||
        first.bounds.minX - spacing > second.bounds.maxX ||
        first.bounds.maxY + spacing < second.bounds.minY ||
        first.bounds.minY - spacing > second.bounds.maxY
      ) {
        continue;
      }

      if (
        polygonsOverlap(
          first.placement.orient.polygon,
          second.placement.orient.polygon,
          { x: first.placement.x, y: first.placement.y },
          { x: second.placement.x, y: second.placement.y },
          spacing,
          first.bounds.bb,
          second.bounds.bb
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

const SAME_SIDE_CAPACITY_WORKER_URL = new URL('../../../workers/diecutCapacitySameSideWorker.js', import.meta.url);

function shouldUseParallelCapacity(sizeList, config) {
  return isMainThread && config.parallelSizes !== false && sizeList.length > 1;
}

function estimateSameSideTaskWeight(size, config) {
  const usableWidth = Math.max(1, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(1, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const usableArea = usableWidth * usableHeight;
  const pieceArea = Math.max(1, polygonArea(size?.polygon) || 1);
  const pointFactor = 1 + Math.max(0, ((size?.polygon?.length || 0) - 12) / 56);
  const fineRotateOffsets = Array.isArray(config.sameSideFineRotateOffsets) && config.sameSideFineRotateOffsets.length
    ? config.sameSideFineRotateOffsets.filter((angle) => Number.isFinite(angle))
    : Array.isArray(config.pairFineRotateOffsets) && config.pairFineRotateOffsets.length
      ? config.pairFineRotateOffsets.filter((angle) => Number.isFinite(angle))
      : [-6, -4, -2, 0, 2, 4, 6];
  const angleFactor = 1 + Math.max(0, fineRotateOffsets.length - 1) * 0.25;
  const rotateFactor = config.allowRotate90 === false ? 1 : 1.1;
  return (usableArea / pieceArea) * pointFactor * rotateFactor * angleFactor;
}

function resolveParallelWorkerCount(sizeList, config) {
  return resolveAdaptiveParallelWorkerCount(sizeList, config);
}

function buildEmptySameSideSummaryItem(size) {
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: 0,
    pairs: 0,
    placedCount: 0,
    efficiency: 0
  };
}

function buildSameSideSummaryItem(size, sheet) {
  if (!sheet) return buildEmptySameSideSummaryItem(size);
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: sheet.placedCount,
    pairs: 0,
    placedCount: sheet.placedCount,
    efficiency: sheet.efficiency
  };
}

function runWorkerTask(worker, task) {
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

async function executeCapacityTasksInParallel(tasks, concurrency) {
  if (!tasks.length) return [];

  const workerCount = Math.min(tasks.length, Math.max(1, concurrency));
  const results = new Array(tasks.length);
  let nextTaskIndex = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    const worker = new Worker(SAME_SIDE_CAPACITY_WORKER_URL, {
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
        results[resultIndex] = await runWorkerTask(worker, task);
      }
    } finally {
      await worker.terminate();
    }
  });

  await Promise.all(runners);
  return results;
}

export class CapacityTestSameSidePattern extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  _getSameSideFineRotateOffsets(config) {
    const rawOffsets = Array.isArray(config.sameSideFineRotateOffsets) && config.sameSideFineRotateOffsets.length
      ? config.sameSideFineRotateOffsets
      : Array.isArray(config.pairFineRotateOffsets) && config.pairFineRotateOffsets.length
        ? config.pairFineRotateOffsets
        : (() => {
            if ((config.gridStep || 1) <= 0.5) {
              const denseOffsets = [];
              for (let value = -6; value <= 6.0001; value += 0.5) {
                denseOffsets.push(roundMetric(value, 3));
              }
              return denseOffsets;
            }
            return [-6, -4, -2, 0, 2, 4, 6];
          })();
    const fineRotateEnabled = config.sameSideFineRotateEnabled ?? config.pairFineRotateEnabled;
    if (fineRotateEnabled === false) {
      return [0];
    }
    return [...new Set(rawOffsets.map((value) => roundMetric(value, 3)))];
  }

  _decorateOrient(sizeName, foot, polygon, angle, config, step) {
    const item = { sizeName, foot, polygon };
    const orient = this._getOrient(item, angle, step, config.spacing);
    const bb = getOrientBounds(orient);
    return {
      ...orient,
      foot,
      bb,
      width: bb.width,
      height: bb.height
    };
  }

  _buildSameSideBodyStrategies(sizeName, foot, polygon, config, step) {
    const orientCache = new Map();
    const ensureOrient = (angle) => {
      const normalizedAngle = this._normalizeAngle(angle);
      const key = `${foot}_${normalizedAngle}`;
      if (!orientCache.has(key)) {
        orientCache.set(
          key,
          this._decorateOrient(sizeName, foot, polygon, normalizedAngle, config, step)
        );
      }
      return orientCache.get(key);
    };

    const strategies = new Map();
    const pushStrategy = (primaryOrient, alternateOrient, extra = {}) => {
      if (!primaryOrient || !alternateOrient) return;
      const key = `${primaryOrient.angle}|${alternateOrient.angle}`;
      if (strategies.has(key)) return;
      strategies.set(key, {
        key: `body_${key}`,
        primaryOrient,
        alternateOrient,
        ...extra
      });
    };

    for (const offset of this._getSameSideFineRotateOffsets(config)) {
      const near0 = ensureOrient(offset);
      const near180 = ensureOrient(180 - offset);
      pushStrategy(near0, near180, {
        rotationOffset: offset,
        startPattern: 'forward'
      });
      pushStrategy(near180, near0, {
        rotationOffset: offset,
        startPattern: 'reverse'
      });
    }

    return [...strategies.values()];
  }

  _buildSameSideFillerBaseStrategies(sizeName, foot, polygon, config, step) {
    if (config.allowRotate90 === false) return [];

    const orientCache = new Map();
    const ensureOrient = (angle) => {
      const normalizedAngle = this._normalizeAngle(angle);
      const key = `${foot}_${normalizedAngle}`;
      if (!orientCache.has(key)) {
        orientCache.set(
          key,
          this._decorateOrient(sizeName, foot, polygon, normalizedAngle, config, step)
        );
      }
      return orientCache.get(key);
    };

    const strategies = new Map();
    const pushStrategy = (primaryOrient, alternateOrient, extra = {}) => {
      if (!primaryOrient) return;
      const alternateKey = alternateOrient ? alternateOrient.angle : 'none';
      const key = `${primaryOrient.angle}|${alternateKey}`;
      if (strategies.has(key)) return;
      strategies.set(key, {
        key: `filler_${key}`,
        primaryOrient,
        alternateOrient,
        ...extra
      });
    };

    for (const offset of this._getSameSideFineRotateOffsets(config)) {
      const near90 = ensureOrient(90 + offset);
      const near270 = ensureOrient(270 - offset);
      pushStrategy(near90, null, {
        rotationOffset: offset,
        startPattern: 'uniform-forward'
      });
      pushStrategy(near270, null, {
        rotationOffset: offset,
        startPattern: 'uniform-reverse'
      });
      pushStrategy(near90, near270, {
        rotationOffset: offset,
        startPattern: 'alternate-forward'
      });
      pushStrategy(near270, near90, {
        rotationOffset: offset,
        startPattern: 'alternate-reverse'
      });
    }

    return [...strategies.values()];
  }

  _resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col) {
    const parity = (row + col) % 2;
    if (rowMode === 'checkerboard') {
      return parity === 0 ? primaryOrient : alternateOrient;
    }
    return col % 2 === 0 ? primaryOrient : alternateOrient;
  }

  _buildBodyNeighborhood(primaryOrient, alternateOrient, rowMode, dxMm, dyMm) {
    const placements = [];
    const sampleRows = 4;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      for (let col = 0; col < sampleCols; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col);
        placements.push({
          id: `body_${row}_${col}`,
          orient,
          x: col * dxMm,
          y: row * dyMm
        });
      }
    }

    return placements;
  }

  _buildUniformNeighborhood(orient, dxMm, dyMm) {
    const placements = [];
    const sampleRows = 4;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      for (let col = 0; col < sampleCols; col++) {
        placements.push({
          id: `uniform_${row}_${col}`,
          orient,
          x: col * dxMm,
          y: row * dyMm
        });
      }
    }

    return placements;
  }

  _resolveFillerOrient(primaryOrient, alternateOrient, row) {
    if (!alternateOrient) return primaryOrient;
    return row % 2 === 0 ? primaryOrient : alternateOrient;
  }

  _buildAlternatingUniformNeighborhood(primaryOrient, alternateOrient, dxMm, dyMm) {
    const placements = [];
    const sampleRows = 4;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      const orient = this._resolveFillerOrient(primaryOrient, alternateOrient, row);
      for (let col = 0; col < sampleCols; col++) {
        placements.push({
          id: `uniform_${row}_${col}`,
          orient,
          x: col * dxMm,
          y: row * dyMm
        });
      }
    }

    return placements;
  }

  _buildSequentialBodyRow(primaryOrient, alternateOrient, rowMode, workWidth, config, step) {
    const precision = Math.min(step, 0.05);
    const buildRow = (validateAgainstWholeRow) => {
      const placements = [];

      for (let col = 0; ; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, 0, col);
        const maxX = roundMetric(workWidth - orient.bb.maxX, 3);
        if (maxX < -1e-6) break;

        const itemId = `body_0_${col}`;
        if (!placements.length) {
          const startX = roundMetric(Math.max(0, -orient.bb.minX), 3);
          if (startX > maxX + 1e-6) break;
          placements.push({
            id: itemId,
            orient,
            x: startX,
            y: 0
          });
          continue;
        }

        const previous = placements[placements.length - 1];
        const minX = roundMetric(previous.x, 3);
        const referencePlacements = validateAgainstWholeRow ? placements : [previous];
        const candidateX = findMinimalContinuousValue(minX, maxX, precision, (x) =>
          !hasCrossPlacementOverlap(
            referencePlacements,
            [
              {
                id: itemId,
                orient,
                x,
                y: 0
              }
            ],
            config.spacing
          )
        );

        if (candidateX == null || candidateX + orient.bb.maxX > workWidth + 1e-6) {
          break;
        }

        placements.push({
          id: itemId,
          orient,
          x: candidateX,
          y: 0
        });
      }

      return placements;
    };

    const row = buildRow(false);
    const trimmedRow = this._trimToValidRowPrefix(row, config.spacing);
    if (trimmedRow.length === row.length) return row;

    const safeRow = buildRow(true);
    const trimmedSafeRow = this._trimToValidRowPrefix(safeRow, config.spacing);
    return trimmedSafeRow.length > trimmedRow.length ? trimmedSafeRow : trimmedRow;
  }

  _trimToValidRowPrefix(placements, spacing) {
    if (!placements.length) return [];
    if (validateLocalPlacements(placements, spacing).valid) {
      return placements;
    }

    const trimmed = placements.slice();
    while (trimmed.length > 0 && !validateLocalPlacements(trimmed, spacing).valid) {
      trimmed.pop();
    }
    return trimmed;
  }

  _findSequentialRowPitch(rowPlacements, config, step) {
    if (!rowPlacements.length) return null;

    const precision = Math.min(step, 0.05);
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const minDeltaY = 0;
    const upper = buildUpperBound(
      step,
      rowBottom - rowTop + config.spacing + step * 8
    );

    return findMinimalContinuousValue(minDeltaY, upper, precision, (deltaY) =>
      !hasCrossPlacementOverlap(
        rowPlacements,
        rowPlacements.map((placement, index) => ({
          ...placement,
          id: `body_next_${index}`,
          y: roundMetric(placement.y + deltaY, 3)
        })),
        config.spacing
      )
    );
  }

  _findAlignedBodyDx(primaryOrient, alternateOrient, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.width, alternateOrient.width) * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) =>
      validateLocalPlacements(
        this._buildBodyNeighborhood(primaryOrient, alternateOrient, 'rows', dxMm, Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 2).filter(item => item.y === 0),
        config.spacing
      ).valid
    );
  }

  _findAlignedBodyDy(primaryOrient, alternateOrient, rowMode, dxMm, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.height, alternateOrient.height) * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      validateLocalPlacements(
        this._buildBodyNeighborhood(primaryOrient, alternateOrient, rowMode, dxMm, dyMm),
        config.spacing
      ).valid
    );
  }

  _findUniformDx(orient, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      orient.width * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) =>
      validateLocalPlacements(
        this._buildUniformNeighborhood(orient, dxMm, orient.height + config.spacing + step * 2).filter(item => item.y === 0),
        config.spacing
      ).valid
    );
  }

  _findUniformDy(orient, dxMm, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      orient.height * 2 + config.spacing + step * 8
    );
    const baseRow = this._buildUniformNeighborhood(
      orient,
      dxMm,
      orient.height + config.spacing + step * 2
    ).filter((item) => item.y === 0);

    return findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      !hasCrossPlacementOverlap(
        baseRow,
        baseRow.map((placement, index) => ({
          ...placement,
          id: `uniform_next_${index}`,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      )
    );
  }

  _findAlternatingUniformDy(primaryOrient, alternateOrient, dxMm, config, step) {
    if (!alternateOrient) {
      return this._findUniformDy(primaryOrient, dxMm, config, step);
    }

    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.height, alternateOrient.height) * 2 + config.spacing + step * 8
    );
    const baseRow = this._buildAlternatingUniformNeighborhood(
      primaryOrient,
      alternateOrient,
      dxMm,
      Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 2
    ).filter((item) => item.y === 0);
    const nextRow = this._buildAlternatingUniformNeighborhood(
      primaryOrient,
      alternateOrient,
      dxMm,
      Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 2
    ).filter((item) => item.y > 0 && item.y < Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 3)
      .map((placement, index) => ({
        ...placement,
        id: `uniform_next_${index}`,
        y: 0
      }));
    const reverseBaseRow = nextRow.map((placement, index) => ({
      ...placement,
      id: `uniform_alt_base_${index}`
    }));
    const reverseNextRow = baseRow.map((placement, index) => ({
      ...placement,
      id: `uniform_alt_next_${index}`
    }));

    return findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      !hasCrossPlacementOverlap(
        baseRow,
        nextRow.map((placement) => ({
          ...placement,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      ) && !hasCrossPlacementOverlap(
        reverseBaseRow,
        reverseNextRow.map((placement) => ({
          ...placement,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      )
    );
  }

  _findAlternatingUniformPitches(primaryOrient, alternateOrient, dxMm, config, step) {
    if (!alternateOrient) {
      const uniformDyMm = this._findUniformDy(primaryOrient, dxMm, config, step);
      return uniformDyMm == null
        ? null
        : {
          primaryToAlternateDyMm: uniformDyMm,
          alternateToPrimaryDyMm: uniformDyMm
        };
    }

    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.height, alternateOrient.height) * 2 + config.spacing + step * 8
    );
    const neighborhood = this._buildAlternatingUniformNeighborhood(
      primaryOrient,
      alternateOrient,
      dxMm,
      Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 2
    );
    const basePrimaryRow = neighborhood.filter((item) => item.y === 0);
    const baseAlternateRow = neighborhood
      .filter((item) => item.y > 0 && item.y < Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 3)
      .map((placement, index) => ({
        ...placement,
        id: `uniform_next_${index}`,
        y: 0
      }));

    const primaryToAlternateDyMm = findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      !hasCrossPlacementOverlap(
        basePrimaryRow,
        baseAlternateRow.map((placement) => ({
          ...placement,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      )
    );
    if (primaryToAlternateDyMm == null) return null;

    const alternateToPrimaryDyMm = findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      !hasCrossPlacementOverlap(
        baseAlternateRow,
        basePrimaryRow.map((placement, index) => ({
          ...placement,
          id: `uniform_alt_next_${index}`,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      )
    );
    if (alternateToPrimaryDyMm == null) return null;

    return {
      primaryToAlternateDyMm,
      alternateToPrimaryDyMm
    };
  }

  _countCols(maxWidth, dxMm, workWidth) {
    let cols = 0;
    while (true) {
      const x = cols * dxMm;
      if (x + maxWidth > workWidth + 1e-6) break;
      cols += 1;
    }
    return cols;
  }

  _countRows(maxHeight, dyMm, workHeight) {
    let rows = 0;
    while (true) {
      const y = rows * dyMm;
      if (y + maxHeight > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _countRowsFromPlacements(rowPlacements, rowPitch, workHeight) {
    if (!rowPlacements.length) return 0;
    const rowHeight = getPlacementsBottom(rowPlacements) - getPlacementsTop(rowPlacements);
    let rows = 0;
    while (true) {
      const y = rows * rowPitch;
      if (y + rowHeight > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _shiftRowPlacements(rowPlacements, shiftXmm, workWidth, prefix = 'body_row_shift') {
    if (!rowPlacements.length) return [];

    const shifted = [];
    for (let index = 0; index < rowPlacements.length; index++) {
      const placement = rowPlacements[index];
      const shiftedX = roundMetric(placement.x + shiftXmm, 3);
      const bb = getOrientBounds(placement.orient);
      if (shiftedX + bb.minX < -1e-6 || shiftedX + bb.maxX > workWidth + 1e-6) {
        continue;
      }
      shifted.push({
        id: `${prefix}_${index}`,
        orient: placement.orient,
        x: shiftedX,
        y: placement.y
      });
    }

    return shifted;
  }

  _getAlternatingLastRowStartY(rows, row0ToRow1Dy, row1ToRow0Dy) {
    if (rows <= 1) return 0;

    let currentY = 0;
    for (let row = 1; row < rows; row++) {
      currentY += row % 2 === 1 ? row0ToRow1Dy : row1ToRow0Dy;
    }
    return roundMetric(currentY, 3);
  }

  _buildAlignedRowShiftCandidates(averagePitchX, step) {
    if (!averagePitchX || averagePitchX <= 0) return [];

    const ratios = Array.isArray(this.config.sameSideAlignedRowShiftRatios) && this.config.sameSideAlignedRowShiftRatios.length
      ? this.config.sameSideAlignedRowShiftRatios
      : [0.35];
    const candidates = [];
    for (const ratio of ratios) {
      const value = roundMetric(Math.round((averagePitchX * ratio) / step) * step, 3);
      if (Math.abs(value) < step) continue;
      candidates.push(value);
    }

    return [...new Set(candidates)]
      .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
  }

  _countAlternatingRowsFromRows(row0Placements, row1Placements, row0ToRow1Dy, row1ToRow0Dy, workHeight) {
    if (!row0Placements.length) return 0;

    let currentY = 0;
    let rows = 0;
    while (true) {
      const rowPlacements = rows % 2 === 0 ? row0Placements : row1Placements;
      const rowHeight = getPlacementsBottom(rowPlacements) - getPlacementsTop(rowPlacements);
      if (currentY + rowHeight > workHeight + 1e-6) break;
      rows += 1;
      currentY += rows % 2 === 1 ? row0ToRow1Dy : row1ToRow0Dy;
    }
    return rows;
  }

  _buildAlternatingRepeatedRows(row0Placements, row1Placements, rows, row0ToRow1Dy, row1ToRow0Dy, startY = 0, prefix = 'body_shift') {
    const placements = [];
    let currentY = startY;

    for (let row = 0; row < rows; row++) {
      const sourcePlacements = row % 2 === 0 ? row0Placements : row1Placements;
      for (let col = 0; col < sourcePlacements.length; col++) {
        const placement = sourcePlacements[col];
        placements.push({
          id: `${prefix}_${row}_${col}`,
          orient: placement.orient,
          x: placement.x,
          y: roundMetric(currentY + placement.y, 3)
        });
      }
      currentY += row % 2 === 0 ? row0ToRow1Dy : row1ToRow0Dy;
    }

    return placements;
  }

  _countAlternatingRows(primaryOrient, alternateOrient, rows, primaryToAlternateDyMm, alternateToPrimaryDyMm, workHeight) {
    if (!primaryOrient) return 0;

    let currentY = 0;
    let count = 0;
    while (true) {
      const orient = this._resolveFillerOrient(primaryOrient, alternateOrient, count);
      if (currentY + orient.height > workHeight + 1e-6) break;
      count += 1;
      currentY += count % 2 === 1 ? primaryToAlternateDyMm : alternateToPrimaryDyMm;
      if (count >= rows) break;
    }
    return count;
  }

  _countFillerRows(primaryOrient, alternateOrient, fillerPrimaryPitchMm, fillerAlternatePitchMm, workHeight) {
    if (!primaryOrient) return 0;

    let currentY = 0;
    let rows = 0;
    while (true) {
      const orient = this._resolveFillerOrient(primaryOrient, alternateOrient, rows);
      if (currentY + orient.height > workHeight + 1e-6) break;
      rows += 1;
      currentY += rows % 2 === 1 ? fillerPrimaryPitchMm : fillerAlternatePitchMm;
    }
    return rows;
  }

  _buildBodyPlacements(primaryOrient, alternateOrient, rowMode, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col);
        placements.push({
          id: `body_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm, 3),
          y: roundMetric(startY + row * dyMm, 3)
        });
      }
    }

    return placements;
  }

  _buildUniformPlacements(primaryOrient, alternateOrient, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      const orient = this._resolveFillerOrient(primaryOrient, alternateOrient, row);
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm, 3),
          y: roundMetric(startY + row * dyMm, 3)
        });
      }
    }

    return placements;
  }

  _buildAlternatingPitchPlacements(
    primaryOrient,
    alternateOrient,
    cols,
    rows,
    dxMm,
    primaryToAlternateDyMm,
    alternateToPrimaryDyMm,
    startY = 0
  ) {
    const placements = [];
    let currentY = startY;

    for (let row = 0; row < rows; row++) {
      const orient = this._resolveFillerOrient(primaryOrient, alternateOrient, row);
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm, 3),
          y: roundMetric(currentY, 3)
        });
      }
      currentY += row % 2 === 0 ? primaryToAlternateDyMm : alternateToPrimaryDyMm;
    }

    return placements;
  }

  _findBodyStartOffsetAfterFillerRow(fillerRowPlacements, bodyRowPlacements, config, step) {
    return this._findStartOffsetAfterRow(fillerRowPlacements, bodyRowPlacements, config, step);
  }

  _findStartOffsetAfterRow(baseRowPlacements, nextRowPlacements, config, step) {
    if (!baseRowPlacements.length || !nextRowPlacements.length) return 0;

    const precision = Math.min(step, 0.05);
    const baseBottom = getPlacementsBottom(baseRowPlacements);
    const nextTop = getPlacementsTop(nextRowPlacements);
    const nextBottom = getPlacementsBottom(nextRowPlacements);
    const upper = buildUpperBound(
      step,
      baseBottom - nextTop + nextBottom + config.spacing + step * 8
    );

    const deltaY = findMinimalContinuousValue(0, upper, precision, (delta) =>
      !hasCrossPlacementOverlap(
        baseRowPlacements,
        nextRowPlacements.map((placement, index) => ({
          ...placement,
          id: `body_start_${index}`,
          y: roundMetric(placement.y + delta, 3)
        })),
        config.spacing
      )
    );

    return deltaY == null ? null : roundMetric(deltaY, 3);
  }

  _buildRepeatedBodyPlacements(rowPlacements, rows, rowPitch, startY = 0) {
    const placements = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < rowPlacements.length; col++) {
        const placement = rowPlacements[col];
        placements.push({
          id: `body_${row}_${col}`,
          orient: placement.orient,
          x: placement.x,
          y: roundMetric(startY + placement.y + row * rowPitch, 3)
        });
      }
    }
    return placements;
  }

  _buildSequentialBodyVariants(rowPlacements, workWidth, workHeight, config, step, includeShifted = true) {
    const variants = [];
    const bodyDyMm = this._findSequentialRowPitch(rowPlacements, config, step);
    if (bodyDyMm == null) return variants;

    const bodyRows = this._countRowsFromPlacements(rowPlacements, bodyDyMm, workHeight);
    if (bodyRows > 0) {
      variants.push({
        key: 'uniform',
        row0Placements: rowPlacements,
        row1Placements: rowPlacements,
        row0ToRow1Dy: bodyDyMm,
        row1ToRow0Dy: bodyDyMm,
        bodyRows,
        bodyCount: rowPlacements.length * bodyRows,
        placements: this._buildRepeatedBodyPlacements(rowPlacements, bodyRows, bodyDyMm, 0),
        lastRowPlacements: rowPlacements,
        lastRowStartY: roundMetric((bodyRows - 1) * bodyDyMm, 3),
        bodyDxMm: getAveragePitchX(rowPlacements),
        bodyDyMm: roundMetric(bodyDyMm),
        rowShiftXmm: 0,
        rowShiftYmm: 0,
        bodyPatternMode: 'aligned-uniform'
      });
    }

    const averagePitchX = getAveragePitchX(rowPlacements);
    if (!includeShifted || rowPlacements.length < 2 || !averagePitchX) return variants;

    const rowShiftCandidates = this._buildAlignedRowShiftCandidates(averagePitchX, step);
    for (const rowShiftXmm of rowShiftCandidates) {
      const shiftedRowPlacements = this._shiftRowPlacements(
        rowPlacements,
        rowShiftXmm,
        workWidth,
        `body_shift_${rowShiftXmm}`
      );
      if (shiftedRowPlacements.length < Math.max(1, rowPlacements.length - 1)) continue;

      const row0ToRow1Dy = this._findStartOffsetAfterRow(rowPlacements, shiftedRowPlacements, config, step);
      const row1ToRow0Dy = this._findStartOffsetAfterRow(shiftedRowPlacements, rowPlacements, config, step);
      if (row0ToRow1Dy == null || row1ToRow0Dy == null) continue;

      const alternatingRows = this._countAlternatingRowsFromRows(
        rowPlacements,
        shiftedRowPlacements,
        row0ToRow1Dy,
        row1ToRow0Dy,
        workHeight
      );
      if (!alternatingRows) continue;

      variants.push({
        key: `shifted_${rowShiftXmm}`,
        row0Placements: rowPlacements,
        row1Placements: shiftedRowPlacements,
        row0ToRow1Dy: roundMetric(row0ToRow1Dy),
        row1ToRow0Dy: roundMetric(row1ToRow0Dy),
        bodyRows: alternatingRows,
        bodyCount: countAlternatingPieces(rowPlacements, shiftedRowPlacements, alternatingRows),
        placements: this._buildAlternatingRepeatedRows(
          rowPlacements,
          shiftedRowPlacements,
          alternatingRows,
          row0ToRow1Dy,
          row1ToRow0Dy,
          0,
          `body_shift_${rowShiftXmm}`
        ),
        lastRowPlacements: alternatingRows % 2 === 1 ? rowPlacements : shiftedRowPlacements,
        lastRowStartY: this._getAlternatingLastRowStartY(
          alternatingRows,
          row0ToRow1Dy,
          row1ToRow0Dy
        ),
        bodyDxMm: averagePitchX,
        bodyDyMm: roundMetric((row0ToRow1Dy + row1ToRow0Dy) / 2),
        rowShiftXmm: roundMetric(rowShiftXmm),
        rowShiftYmm: 0,
        bodyPatternMode: 'aligned-shifted'
      });
    }

    return variants;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const renderKey = getRenderKey(placement.orient);
      if (!renderTemplates[renderKey]) {
        renderTemplates[renderKey] = {
          path: buildRelativeSvgPath(polygon),
          labelOffset: getRelativeCentroid(polygon)
        };
      }
      return {
        id: `${sizeName}_${placement.orient.foot}_${index}`,
        sizeName,
        foot: placement.orient.foot,
        x: roundMetric(worldX),
        y: roundMetric(worldY),
        angle: placement.orient.angle,
        renderKey
      };
    });
    return { placed: items, renderTemplates };
  }

  _buildCandidate(sizeName, foot, pieceArea, placements, metadata, workWidth, workHeight, config) {
    if (!placements.length) return null;

    const bounds = computeEnvelope(placements);
    if (
      bounds.minX < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > workWidth + 1e-6 ||
      bounds.maxY > workHeight + 1e-6
    ) {
      return null;
    }

    return {
      sizeName,
      selectedFoot: foot,
      pieceArea,
      placedCount: placements.length,
      ...metadata,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - placements.length * pieceArea)),
      placements,
      bounds
    };
  }

  _finalizeCandidate(candidate, config) {
    if (!candidate?.placements?.length) return null;

    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const validation = validatePatternPlacements(
      candidate.placements,
      workWidth,
      workHeight,
      config.spacing
    );
    if (!validation.valid) return null;

    const bounds = validation.bounds || candidate.bounds || computeEnvelope(candidate.placements);
    return {
      ...candidate,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      envelopeWasteMm2: roundMetric(
        Math.max(0, bounds.width * bounds.height - candidate.placedCount * candidate.pieceArea)
      ),
      ...this._materializePlacedItems(candidate.sizeName, candidate.placements, config),
      bounds
    };
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight, deadline = Infinity) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    const bodyStrategies = this._buildSameSideBodyStrategies(sizeName, foot, polygon, config, step);
    const fillerBaseStrategies = this._buildSameSideFillerBaseStrategies(sizeName, foot, polygon, config, step);
    const bodyModes = ['rows'];
    let bestCandidate = null;
    const candidatePool = [];
    const fillerUpperBoundCache = new Map();

    for (const bodyStrategy of bodyStrategies) {
      if (Date.now() > deadline) return bestCandidate;
      const primaryOrient = bodyStrategy.primaryOrient;
      const alternateOrient = bodyStrategy.alternateOrient;
      const fillerStrategies = [
        {
          key: 'none',
          primaryOrient: null,
          alternateOrient: null,
          dxMm: null,
          dyMm: null,
          cols: 0,
          maxRows: 0,
          firstRowPlacements: [],
          primaryAngle: null,
          secondaryAngle: null,
          priority: 2,
          rotationOffset: null,
          startPattern: 'none'
        }
      ];

      for (const fillerBaseStrategy of fillerBaseStrategies) {
        if (Date.now() > deadline) return bestCandidate;
        const fillerPrimaryOrient = fillerBaseStrategy.primaryOrient;
        const fillerAlternateOrient = fillerBaseStrategy.alternateOrient;
        const fillerDxMm = this._findUniformDx(fillerPrimaryOrient, config, step);
        if (fillerDxMm == null) continue;

        const uniformDyMm = this._findUniformDy(fillerPrimaryOrient, fillerDxMm, config, step);
        if (uniformDyMm != null) {
          const uniformCols = this._countCols(fillerPrimaryOrient.width, fillerDxMm, workWidth);
          const uniformFirstRowPlacements = this._buildAlternatingPitchPlacements(
            fillerPrimaryOrient,
            null,
            uniformCols,
            1,
            fillerDxMm,
            uniformDyMm,
            uniformDyMm,
            0
          );
          fillerStrategies.push({
            key: `${fillerBaseStrategy.key}_uniform`,
            primaryOrient: fillerPrimaryOrient,
            alternateOrient: null,
            dxMm: fillerDxMm,
            dyMm: uniformDyMm,
            cols: uniformCols,
            maxRows: this._countRows(fillerPrimaryOrient.height, uniformDyMm, workHeight),
            firstRowPlacements: uniformFirstRowPlacements,
            primaryAngle: fillerPrimaryOrient.angle,
            secondaryAngle: null,
            priority: 1,
            rotationOffset: fillerBaseStrategy.rotationOffset,
            startPattern: fillerBaseStrategy.startPattern
          });
        }

        if (fillerAlternateOrient) {
          const alternatingPitches = this._findAlternatingUniformPitches(
            fillerPrimaryOrient,
            fillerAlternateOrient,
            fillerDxMm,
            config,
            step
          );
          if (alternatingPitches != null) {
            const alternatingCols = this._countCols(fillerPrimaryOrient.width, fillerDxMm, workWidth);
            const alternatingFirstRowPlacements = this._buildAlternatingPitchPlacements(
              fillerPrimaryOrient,
              fillerAlternateOrient,
              alternatingCols,
              1,
              fillerDxMm,
              alternatingPitches.primaryToAlternateDyMm,
              alternatingPitches.alternateToPrimaryDyMm,
              0
            );
            fillerStrategies.push({
              key: `${fillerBaseStrategy.key}_alternate`,
              primaryOrient: fillerPrimaryOrient,
              alternateOrient: fillerAlternateOrient,
              dxMm: fillerDxMm,
              dyMm: alternatingPitches.primaryToAlternateDyMm,
              alternateDyMm: alternatingPitches.alternateToPrimaryDyMm,
              cols: alternatingCols,
              maxRows: this._countFillerRows(
                fillerPrimaryOrient,
                fillerAlternateOrient,
                alternatingPitches.primaryToAlternateDyMm,
                alternatingPitches.alternateToPrimaryDyMm,
                workHeight
              ),
              firstRowPlacements: alternatingFirstRowPlacements,
              primaryAngle: fillerPrimaryOrient.angle,
              secondaryAngle: fillerAlternateOrient.angle,
              priority: 0,
              rotationOffset: fillerBaseStrategy.rotationOffset,
              startPattern: fillerBaseStrategy.startPattern
            });
          }
        }
      }

      fillerStrategies.sort((left, right) =>
        (left.priority ?? 99) - (right.priority ?? 99)
        || (right.maxRows ?? 0) - (left.maxRows ?? 0)
      );

      const getFillerUpperBound = (strategy, availableHeight) => {
        if (!strategy.primaryOrient || strategy.cols <= 0 || availableHeight <= 0) {
          return 0;
        }

        const cacheKey = `${bodyStrategy.key}_${strategy.key}_${roundMetric(availableHeight, 3)}`;
        if (fillerUpperBoundCache.has(cacheKey)) {
          return fillerUpperBoundCache.get(cacheKey);
        }

        const rows = strategy.alternateOrient
          ? this._countFillerRows(
            strategy.primaryOrient,
            strategy.alternateOrient,
            strategy.dyMm,
            strategy.alternateDyMm ?? strategy.dyMm,
            availableHeight
          )
          : this._countRows(strategy.primaryOrient.height, strategy.dyMm, availableHeight);
        const pieceCount = rows * strategy.cols;
        fillerUpperBoundCache.set(cacheKey, pieceCount);
        return pieceCount;
      };

      for (const rowMode of bodyModes) {
        if (Date.now() > deadline) return bestCandidate;
      const bodyRowPlacements = this._buildSequentialBodyRow(
        primaryOrient,
        alternateOrient,
        rowMode,
        workWidth,
        config,
        step
      );
      const bodyCols = bodyRowPlacements.length;
      if (!bodyCols) continue;

      const bodyVariants = this._buildSequentialBodyVariants(
        bodyRowPlacements,
        workWidth,
        workHeight,
        config,
        step,
        bodyCols >= 3
      );
      bodyVariants.sort((left, right) =>
        right.bodyCount - left.bodyCount
        || Math.abs(right.rowShiftXmm || 0) - Math.abs(left.rowShiftXmm || 0)
      );

      for (const bodyVariant of bodyVariants) {
        if (Date.now() > deadline) return bestCandidate;
        const bodyRemainingHeight = Math.max(0, workHeight - bodyVariant.lastRowStartY);
        const bodyUpperBound = bodyVariant.bodyCount + Math.max(
          0,
          ...fillerStrategies.map((strategy) => getFillerUpperBound(strategy, bodyRemainingHeight))
        );

        if (bestCandidate && bodyUpperBound < bestCandidate.placedCount) {
          continue;
        }

        for (const fillerStrategy of fillerStrategies) {
          if (Date.now() > deadline) return bestCandidate;
          const fillerPrimaryOrient = fillerStrategy.primaryOrient;
          const fillerAlternateOrient = fillerStrategy.alternateOrient;
          const filler90DxMm = fillerStrategy.dxMm;
          const filler90DyMm = fillerStrategy.dyMm;
          const fillerAlternateDyMm = fillerStrategy.alternateDyMm ?? filler90DyMm;
          const filler90Cols = fillerStrategy.cols;
          const fillerUpperBound = getFillerUpperBound(fillerStrategy, bodyRemainingHeight);
          if (bestCandidate && bodyVariant.bodyCount + fillerUpperBound < bestCandidate.placedCount) {
            continue;
          }

          const fillerFirstRowPlacements = filler90Cols > 0 && fillerPrimaryOrient
            ? fillerStrategy.firstRowPlacements || []
            : [];
          const fillerStartOffsetAfterBody = fillerFirstRowPlacements.length
            ? this._findStartOffsetAfterRow(
            bodyVariant.lastRowPlacements,
            fillerFirstRowPlacements,
            config,
            step
          )
          : 0;
          if (fillerFirstRowPlacements.length && fillerStartOffsetAfterBody == null) continue;

          const fillerStartY = fillerFirstRowPlacements.length
            ? roundMetric(bodyVariant.lastRowStartY + fillerStartOffsetAfterBody, 3)
          : 0;
          const filler90Rows = fillerFirstRowPlacements.length
            ? this._countFillerRows(
            fillerPrimaryOrient,
            fillerAlternateOrient,
            filler90DyMm,
            fillerAlternateDyMm,
            Math.max(0, workHeight - fillerStartY)
          )
          : 0;
          const fillerPlacements = filler90Rows > 0 && fillerPrimaryOrient
            ? this._buildAlternatingPitchPlacements(
              fillerPrimaryOrient,
              fillerAlternateOrient,
            filler90Cols,
            filler90Rows,
            filler90DxMm,
            filler90DyMm,
            fillerAlternateDyMm,
              fillerStartY
            )
            : [];
          const fillerCount = filler90Cols * filler90Rows;
          if (bestCandidate && bodyVariant.bodyCount + fillerCount < bestCandidate.placedCount) {
            continue;
          }

          const placements = [...bodyVariant.placements, ...fillerPlacements];
          const candidate = this._buildCandidate(
            sizeName,
            foot,
            pieceArea,
            placements,
            {
              rowMode,
              bodyCount: bodyVariant.bodyCount,
              bodyCols: Math.max(bodyVariant.row0Placements.length, bodyVariant.row1Placements.length),
              bodyRows: bodyVariant.bodyRows,
              bodyDxMm: bodyVariant.bodyDxMm,
              bodyDyMm: roundMetric(bodyVariant.bodyDyMm),
              bodyStartY: 0,
              bodyPrimaryAngle: primaryOrient.angle,
              bodyAlternateAngle: alternateOrient.angle,
              bodyPatternMode: bodyVariant.bodyPatternMode,
              bodyRotationOffset: bodyStrategy.rotationOffset ?? 0,
              bodyStartPattern: bodyStrategy.startPattern,
              rowShiftXmm: bodyVariant.rowShiftXmm,
              rowShiftYmm: bodyVariant.rowShiftYmm,
              filler90Used: filler90Rows > 0,
              filler90Count: fillerCount,
              filler90Cols,
              filler90Rows,
              filler90DxMm: filler90DxMm != null ? roundMetric(filler90DxMm) : null,
              filler90DyMm: filler90DyMm != null ? roundMetric(filler90DyMm) : null,
              filler270DyMm: fillerAlternateDyMm != null ? roundMetric(fillerAlternateDyMm) : null,
              filler90Angle: fillerStrategy.primaryAngle,
              filler270Angle: fillerStrategy.secondaryAngle,
              fillerPatternKey: fillerStrategy.key,
              fillerPatternPriority: fillerStrategy.priority,
              fillerRotationOffset: fillerStrategy.rotationOffset ?? 0,
              fillerStartPattern: fillerStrategy.startPattern,
              scanOrder: 'left-to-right-then-down'
            },
            workWidth,
            workHeight,
            config
          );

          if (candidate) {
            candidatePool.push(candidate);
            if (compareAlignedCandidates(candidate, bestCandidate) < 0) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }
    }

    if (!candidatePool.length) return null;

    candidatePool.sort((left, right) => compareAlignedCandidates(left, right));
    for (const candidate of candidatePool) {
      const finalized = this._finalizeCandidate(candidate, config);
      if (finalized) return finalized;
    }

    return null;
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const placedCount = candidate.placed.length;
    const efficiency = totalArea > 0
      ? roundMetric((placedCount * candidate.pieceArea / totalArea) * 100, 1)
      : 0;

    return {
      sheetIndex: 0,
      placed: candidate.placed,
      renderTemplates: candidate.renderTemplates,
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placedCount,
      efficiency
    };
  }

  async _testCapacitySequential(sizeList, config) {
    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const perSizeBudget = Math.max(15000, Math.floor((config.maxTimeMs || 120000) / Math.max(1, sizeList.length)));

    const sheetsBySize = {};
    const summary = [];

    for (const size of sizeList) {
      const cacheKey = buildCapacityResultCacheKey('same-side-banded', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        summary.push(cachedResult.summaryItem);
        sheetsBySize[size.sizeName] = cachedResult.sheet;
        continue;
      }

      const basePolygon = normalizeToOrigin(size.polygon);
      const footCandidates = [
        {
          foot: size.foot || 'L',
          polygon: basePolygon
        }
      ];
      const deadline = Date.now() + perSizeBudget;

      let bestCandidate = null;

      for (const footCandidate of footCandidates) {
        const candidate = this._evaluateFootCandidate(
          size.sizeName,
          footCandidate.foot,
          footCandidate.polygon,
          config,
          workWidth,
          workHeight,
          deadline
        );

        if (candidate && compareAlignedCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        const summaryItem = buildEmptySameSideSummaryItem(size);
        summary.push(summaryItem);
        sheetsBySize[size.sizeName] = null;
        setCachedCapacityResult(cacheKey, {
          summaryItem,
          sheet: null
        });
        continue;
      }

      const sheet = this._buildSheetFromCandidate(size.sizeName, bestCandidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;

      const summaryItem = buildSameSideSummaryItem(size, sheet);
      summary.push(summaryItem);
      setCachedCapacityResult(cacheKey, {
        summaryItem,
        sheet
      });
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-banded',
      summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName,
      sheet: defaultSheet,
      sheetsBySize,
      timeMs: Date.now() - startTime
    };
  }

  async _testCapacityParallel(sizeList, config) {
    const startTime = Date.now();
    const cachedResults = new Array(sizeList.length).fill(null);
    const uncachedTasks = [];

    for (let index = 0; index < sizeList.length; index++) {
      const size = sizeList[index];
      const cacheKey = buildCapacityResultCacheKey('same-side-banded', size, config);
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
          parallelSizes: false
        }
      });
    }

    const workerCount = resolveParallelWorkerCount(uncachedTasks.map((task) => task.size), config);
    const orderedTasks = orderTasksByEstimatedWeight(uncachedTasks, (task) => estimateSameSideTaskWeight(task.size, task.config));
    const workerResults = orderedTasks.length
      ? await executeCapacityTasksInParallel(orderedTasks, workerCount)
      : [];
    const sheetsBySize = {};
    const summary = [];

    for (const task of uncachedTasks) {
      const workerResult = workerResults[task.index];
      if (!workerResult?.payload) {
        throw new Error(`Missing worker payload for size index ${task.index}`);
      }
      setCachedCapacityResult(task.cacheKey, workerResult.payload);
      cachedResults[task.index] = workerResult.payload;
    }

    for (let index = 0; index < cachedResults.length; index++) {
      const cachedResult = cachedResults[index];
      if (!cachedResult) {
        throw new Error(`Missing cached capacity payload for size index ${index}`);
      }
      const { summaryItem, sheet } = cachedResult;
      summary.push(summaryItem);
      sheetsBySize[summaryItem.sizeName] = sheet;
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-banded',
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
    const config = {
      ...this.config,
      ...overrideConfig,
      capacityLayoutMode: 'same-side-banded',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate180: true,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true
    };

    if (shouldUseParallelCapacity(sizeList, config)) {
      return this._testCapacityParallel(sizeList, config);
    }

    return this._testCapacitySequential(sizeList, config);
  }
}
