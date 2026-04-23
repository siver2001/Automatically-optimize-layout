import { BaseNesting } from '../../core/BaseNesting.js';
import {
  flipX,
  normalizeToOrigin,
  translate,
  area as polygonArea,
  polygonsOverlap
} from '../../core/polygonUtils.js';
import { Worker, isMainThread } from 'worker_threads';
import {
  getOrientBounds,
  roundMetric,
  validateLocalPlacements,
  computeEnvelope
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

const MAX_FINE_ROTATE_DEGREES = 5;
const DETAILED_FINE_ROTATE_STEP_DEGREES = 0.25;
const SAME_SIDE_CAPACITY_WORKER_URL = new URL('../../../workers/diecutCapacitySameSideWorker.js', import.meta.url);

function normalizeFineRotateOffsets(offsets) {
  return [...new Set(
    offsets
      .filter((angle) => Number.isFinite(angle))
      .map((value) => roundMetric(Math.max(-MAX_FINE_ROTATE_DEGREES, Math.min(MAX_FINE_ROTATE_DEGREES, value)), 3))
  )];
}

function buildDetailedFineRotateOffsets(stepDegrees) {
  const offsets = [0];
  for (let value = stepDegrees; value <= MAX_FINE_ROTATE_DEGREES + 0.0001; value += stepDegrees) {
    const rounded = roundMetric(value, 3);
    offsets.push(-rounded, rounded);
  }
  return normalizeFineRotateOffsets(offsets);
}

function shouldUseParallelSameSideCapacity(sizeList, config) {
  return isMainThread
    && config.parallelSizes !== false
    && config.capacityLayoutMode === 'same-side-banded'
    && sizeList.length > 1;
}

function estimateSameSideTaskWeight(size, config) {
  const usableWidth = Math.max(1, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(1, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const usableArea = usableWidth * usableHeight;
  const pieceArea = Math.max(1, polygonArea(size?.polygon) || 1);
  const pointFactor = 1 + Math.max(0, ((size?.polygon?.length || 0) - 12) / 48);
  const rotateFactor = config.sameSideFineRotateEnabled === true && (config.gridStep || 1) <= 0.5 ? 1.5 : 1;
  const fillerFactor = config.allowRotate90 === false ? 1 : 1.1;
  return (usableArea / pieceArea) * pointFactor * rotateFactor * fillerFactor;
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

async function executeSameSideCapacityTasksInParallel(tasks, concurrency) {
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

  return roundMetric(high, 3);
}

function buildShiftCandidates(range, step, limit = 7) {
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

function buildRelativeSvgPath(polygon, isClosed = true) {
  if (!polygon || polygon.length < 2) return '';
  const pathStr = polygon.map((point, index) => {
    const x = point.x.toFixed(2);
    const y = point.y.toFixed(2);
    return `${index === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  return isClosed ? pathStr + ' Z' : pathStr;
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

export class CapacityTestSameSidePattern extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _getSameSideFineRotateOffsets(config) {
    if (Array.isArray(config.sameSideFineRotateOffsets) && config.sameSideFineRotateOffsets.length) {
      const customOffsets = normalizeFineRotateOffsets(config.sameSideFineRotateOffsets);
      return customOffsets.length ? customOffsets : [0];
    }

    if (config.sameSideFineRotateEnabled === true && (config.gridStep || 1) <= 0.5) {
      return buildDetailedFineRotateOffsets(DETAILED_FINE_ROTATE_STEP_DEGREES);
    }

    return [0];
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
    if (validateLocalPlacements(row, config.spacing).valid) {
      return row;
    }
    return buildRow(true);
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

  _buildShiftedBodyNeighborhood(rowPlacements, rowPitch, rowShiftXmm = 0, rowShiftYmm = 0) {
    const placements = [];
    const sampleRows = 3;

    for (let row = 0; row < sampleRows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < rowPlacements.length; col++) {
        const placement = rowPlacements[col];
        placements.push({
          id: `body_shift_${row}_${col}`,
          orient: placement.orient,
          x: roundMetric(placement.x + shiftX, 3),
          y: roundMetric(placement.y + row * rowPitch + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _findShiftedRowPitch(rowPlacements, rowShiftXmm, rowShiftYmm, config, step) {
    if (!rowPlacements.length) return null;

    const precision = Math.min(step, 0.05);
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const minDeltaY = 0;
    const upper = buildUpperBound(
      step,
      rowBottom - rowTop + Math.abs(rowShiftYmm) + config.spacing + step * 10
    );

    return findMinimalContinuousValue(minDeltaY, upper, precision, (rowPitch) =>
      validateLocalPlacements(
        this._buildShiftedBodyNeighborhood(rowPlacements, rowPitch, rowShiftXmm, rowShiftYmm),
        config.spacing
      ).valid
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

  _buildBodyPlacements(primaryOrient, alternateOrient, rowMode, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col);
        placements.push({
          id: `body_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _buildUniformPlacements(orient, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _findBodyStartOffsetAfterFillerRow(fillerRowPlacements, bodyRowPlacements, config, step) {
    if (!fillerRowPlacements.length) return 0;

    const precision = Math.min(step, 0.05);
    const bodyTop = getPlacementsTop(bodyRowPlacements);
    const fillerBottom = getPlacementsBottom(fillerRowPlacements);
    const minDeltaY = 0;
    const upper = buildUpperBound(
      step,
      fillerBottom - bodyTop + getPlacementsBottom(bodyRowPlacements) + config.spacing + step * 8
    );

    const deltaY = findMinimalContinuousValue(minDeltaY, upper, precision, (delta) => {
      const shiftedBodyRow = bodyRowPlacements.map((placement, index) => ({
        ...placement,
        id: `body_start_${index}`,
        y: roundMetric(placement.y + delta, 3)
      }));
      return !hasCrossPlacementOverlap(fillerRowPlacements, shiftedBodyRow, config.spacing);
    });

    return deltaY == null ? null : roundMetric(deltaY, 3);
  }

  _buildRepeatedBodyPlacements(rowPlacements, rows, rowPitch, startY = 0, rowShiftXmm = 0, rowShiftYmm = 0) {
    const placements = [];
    const baseX = rowShiftXmm < 0 ? -rowShiftXmm : 0;
    const baseY = startY - Math.min(0, rowShiftYmm);
    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;
      for (let col = 0; col < rowPlacements.length; col++) {
        const placement = rowPlacements[col];
        placements.push({
          id: `body_${row}_${col}`,
          orient: placement.orient,
          x: roundMetric(baseX + placement.x + shiftX, 3),
          y: roundMetric(baseY + placement.y + row * rowPitch + shiftY, 3)
        });
      }
    }
    return placements;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const internals = placement.orient.internals || [];
      const renderKey = getRenderKey(placement.orient);
      if (!renderTemplates[renderKey]) {
        renderTemplates[renderKey] = {
          path: buildRelativeSvgPath(polygon),
          internalsPaths: internals.map(path => buildRelativeSvgPath(path, false)),
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
        polygon: translate(polygon, worldX, worldY),
        internals: internals.map(path => translate(path, worldX, worldY)),
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

    const bounds = candidate.bounds || computeEnvelope(candidate.placements);
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

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    const fineRotateOffsets = this._getSameSideFineRotateOffsets(config);
    const bodyModes = ['rows'];
    let bestCandidate = null;
    const candidatePool = [];

    for (const rotationOffset of fineRotateOffsets) {
      const primaryAngle = roundMetric(rotationOffset, 3);
      const alternateAngle = roundMetric(180 + rotationOffset, 3);
      const filler90Angle = roundMetric(90 + rotationOffset, 3);
      const primaryOrient = this._decorateOrient(sizeName, foot, polygon, primaryAngle, config, step);
      const alternateOrient = this._decorateOrient(sizeName, foot, polygon, alternateAngle, config, step);
      const filler90Orient = config.allowRotate90 === false
        ? null
        : this._decorateOrient(sizeName, foot, polygon, filler90Angle, config, step);

      let filler90DxMm = null;
      let filler90DyMm = null;
      let filler90Cols = 0;
      let maxFiller90Rows = 0;

      if (filler90Orient) {
        filler90DxMm = this._findUniformDx(filler90Orient, config, step);
        if (filler90DxMm != null) {
          filler90DyMm = this._findUniformDy(filler90Orient, filler90DxMm, config, step);
          if (filler90DyMm != null) {
            filler90Cols = this._countCols(filler90Orient.width, filler90DxMm, workWidth);
            maxFiller90Rows = this._countRows(filler90Orient.height, filler90DyMm, workHeight);
          }
        }
      }

      for (const rowMode of bodyModes) {
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

        const bodyDyMm = this._findSequentialRowPitch(bodyRowPlacements, config, step);
        if (bodyDyMm == null) continue;
        const bodyHeightMm = getPlacementsBottom(bodyRowPlacements) - getPlacementsTop(bodyRowPlacements);
        const bodyDxMm = getAveragePitchX(bodyRowPlacements);
        const bodyVariants = [
          {
            key: `${rowMode}_aligned`,
            rowPlacements: bodyRowPlacements,
            bodyDyMm,
            bodyDxMm,
            rowShiftXmm: 0,
            rowShiftYmm: 0
          }
        ];

        const rowShiftRange = Math.max(primaryOrient.width, alternateOrient.width) * 0.45;
        const rowShiftCandidates = buildShiftCandidates(rowShiftRange, step, 7);
        for (const rowShiftXmm of rowShiftCandidates) {
          if (Math.abs(rowShiftXmm) < Math.max(step, 0.25) * 0.5) continue;
          const shiftedDyMm = this._findShiftedRowPitch(bodyRowPlacements, rowShiftXmm, 0, config, step);
          if (shiftedDyMm == null) continue;
          bodyVariants.push({
            key: `${rowMode}_shift_${rowShiftXmm}`,
            rowPlacements: bodyRowPlacements,
            bodyDyMm: shiftedDyMm,
            bodyDxMm,
            rowShiftXmm: roundMetric(rowShiftXmm),
            rowShiftYmm: 0
          });
        }

        const fillerLastRowPlacements = filler90Cols > 0
          ? this._buildUniformPlacements(filler90Orient, filler90Cols, 1, filler90DxMm, filler90DyMm, 0)
          : [];
        for (const bodyVariant of bodyVariants) {
          const bodyStartOffsetAfterFillerRow = fillerLastRowPlacements.length
            ? this._findBodyStartOffsetAfterFillerRow(
              fillerLastRowPlacements,
              bodyVariant.rowPlacements,
              config,
              step
            )
            : 0;

          const fillerRowOptions = filler90Cols > 0 ? maxFiller90Rows : 0;
          for (let filler90Rows = 0; filler90Rows <= fillerRowOptions; filler90Rows++) {
            const fillerHeight = filler90Rows > 0
              ? filler90Orient.height + (filler90Rows - 1) * filler90DyMm
              : 0;
            if (fillerHeight > workHeight + 1e-6) continue;

            if (filler90Rows > 0 && bodyStartOffsetAfterFillerRow == null) continue;
            const lastFillerRowY = filler90Rows > 0
              ? roundMetric((filler90Rows - 1) * filler90DyMm)
              : 0;
            const bodyStartY = filler90Rows > 0
              ? roundMetric(lastFillerRowY + bodyStartOffsetAfterFillerRow)
              : 0;

            const bodyRows = this._countRows(
              bodyHeightMm,
              bodyVariant.bodyDyMm,
              Math.max(0, workHeight - bodyStartY)
            );
            const bodyCount = bodyCols * bodyRows;
            const fillerCount = filler90Cols * filler90Rows;
            const totalCount = bodyCount + fillerCount;

            if (bestCandidate) {
              if (totalCount < bestCandidate.placedCount) continue;
              if (totalCount === bestCandidate.placedCount && bodyCount < bestCandidate.bodyCount) continue;
              if (
                totalCount === bestCandidate.placedCount &&
                bodyCount === bestCandidate.bodyCount &&
                fillerCount > bestCandidate.filler90Count
              ) {
                continue;
              }
            }

            const fillerPlacements = filler90Rows > 0
              ? this._buildUniformPlacements(filler90Orient, filler90Cols, filler90Rows, filler90DxMm, filler90DyMm, 0)
              : [];
            const bodyPlacements = bodyRows > 0
              ? this._buildRepeatedBodyPlacements(
                bodyVariant.rowPlacements,
                bodyRows,
                bodyVariant.bodyDyMm,
                bodyStartY,
                bodyVariant.rowShiftXmm,
                bodyVariant.rowShiftYmm
              )
              : [];

            const placements = [...fillerPlacements, ...bodyPlacements];
            const candidate = this._buildCandidate(
              sizeName,
              foot,
              pieceArea,
              placements,
              {
                rowMode,
                rotationOffset: primaryAngle,
                bodyCount,
                bodyCols,
                bodyRows,
                bodyDxMm: bodyVariant.bodyDxMm,
                bodyDyMm: roundMetric(bodyVariant.bodyDyMm),
                bodyStartY: roundMetric(bodyStartY),
                rowShiftXmm: bodyVariant.rowShiftXmm,
                rowShiftYmm: bodyVariant.rowShiftYmm,
                bodyPrimaryAngle: primaryAngle,
                bodyAlternateAngle: alternateAngle,
                filler90Used: filler90Rows > 0,
                filler90Count: fillerCount,
                filler90Cols,
                filler90Rows,
                filler90DxMm: filler90DxMm != null ? roundMetric(filler90DxMm) : null,
                filler90DyMm: filler90DyMm != null ? roundMetric(filler90DyMm) : null,
                filler90Angle: filler90Orient ? filler90Angle : null,
                scanOrder: bodyVariant.rowShiftXmm ? 'staggered-row-bands' : 'left-to-right-then-down'
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
      efficiency,
      patternInfo: {
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
        scanOrder: candidate.scanOrder ?? null
      }
    };
  }

  async _testCapacitySequential(sizeList, config) {
    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
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
        { foot: 'L', polygon: basePolygon },
        { foot: 'R', polygon: normalizeToOrigin(flipX(size.polygon)) }
      ];

      let bestCandidate = null;

      for (const footCandidate of footCandidates) {
        const candidate = this._evaluateFootCandidate(
          size.sizeName,
          footCandidate.foot,
          footCandidate.polygon,
          config,
          workWidth,
          workHeight
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
    const orderedTasks = orderTasksByEstimatedWeight(
      uncachedTasks,
      (task) => estimateSameSideTaskWeight(task.size, task.config)
    );
    const workerResults = orderedTasks.length
      ? await executeSameSideCapacityTasksInParallel(orderedTasks, workerCount)
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

    if (shouldUseParallelSameSideCapacity(sizeList, config)) {
      return this._testCapacityParallel(sizeList, config);
    }

    return this._testCapacitySequential(sizeList, config);
  }
}

