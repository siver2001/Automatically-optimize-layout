import { Worker, isMainThread } from 'worker_threads';
import { BaseNesting } from '../../core/BaseNesting.js';
import {
  flipX,
  normalizeToOrigin,
  area as polygonArea
} from '../../core/polygonUtils.js';
import {
  buildShiftCandidates,
  cachedPolygonsOverlap,
  compareComplementaryCandidates,
  computeEnvelope,
  findMinimalQuantizedValue,
  getOrientBounds,
  quantizeToStep,
  roundMetric,
  validateLocalPlacements,
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

const PAIR_SHIFT_SAMPLE_LIMIT = 19;
const ROW_SHIFT_X_SAMPLE_LIMIT = 21;
const ROW_SHIFT_Y_SAMPLE_LIMIT = 13;
const ROW_REPEAT_CHECK_COUNT = 4;
const ROW_NEIGHBOR_COL_START = -1;
const ROW_NEIGHBOR_COL_END = 2;
const MAX_FINE_ROTATE_DEGREES = 5;
const DETAILED_FINE_ROTATE_STEP_DEGREES = 0.5;

function normalizeFineRotateOffsets(offsets) {
  return [...new Set(
    offsets
      .filter((angle) => Number.isFinite(angle))
      .map((value) => roundMetric(Math.max(-MAX_FINE_ROTATE_DEGREES, Math.min(MAX_FINE_ROTATE_DEGREES, value)), 3))
  )];
}

function compareMotifCandidates(nextMotif, bestMotif) {
  if (!bestMotif) return -1;
  const nextArea = nextMotif.width * nextMotif.height;
  const bestArea = bestMotif.width * bestMotif.height;
  if (nextArea !== bestArea) {
    return nextArea - bestArea;
  }
  if (nextMotif.height !== bestMotif.height) {
    return nextMotif.height - bestMotif.height;
  }
  if (nextMotif.width !== bestMotif.width) {
    return nextMotif.width - bestMotif.width;
  }
  if (Math.abs(nextMotif.pairDyMm) !== Math.abs(bestMotif.pairDyMm)) {
    return Math.abs(nextMotif.pairDyMm) - Math.abs(bestMotif.pairDyMm);
  }
  return nextMotif.pairDxMm - bestMotif.pairDxMm;
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

const PAIR_CAPACITY_WORKER_URL = new URL('../../../workers/diecutCapacityPairWorker.js', import.meta.url);

function shouldUseParallelPairCapacity(sizeList, config) {
  return isMainThread
    && config.parallelSizes !== false
    && config.capacityLayoutMode !== 'legacy-pair'
    && sizeList.length > 1;
}

function estimatePairTaskWeight(size, config) {
  const usableWidth = Math.max(1, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(1, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const usableArea = usableWidth * usableHeight;
  const pieceArea = Math.max(1, polygonArea(size?.polygon) || 1);
  const pointFactor = 1 + Math.max(0, ((size?.polygon?.length || 0) - 12) / 48);
  const fineRotateOffsets = Array.isArray(config.pairFineRotateOffsets) && config.pairFineRotateOffsets.length
    ? normalizeFineRotateOffsets(config.pairFineRotateOffsets)
    : [-4, -2, 0];
  const angleFactor = 1 + Math.max(0, fineRotateOffsets.length - 1) * 0.35;
  const fillerFactor = config.allowRotate90 === false ? 1 : 1.15;
  return (usableArea / pieceArea) * pointFactor * angleFactor * fillerFactor;
}

function resolveParallelWorkerCount(sizeList, config) {
  return resolveAdaptiveParallelWorkerCount(sizeList, config);
}

function buildEmptyPairSummaryItem(size) {
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: 0,
    pairs: 0,
    placedCount: 0,
    efficiency: 0
  };
}

function buildPairSummaryItem(size, sheet) {
  if (!sheet) return buildEmptyPairSummaryItem(size);
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: sheet.placedCount,
    pairs: Math.floor(sheet.placedCount / 2),
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

async function executePairCapacityTasksInParallel(tasks, concurrency) {
  if (!tasks.length) return [];

  const workerCount = Math.min(tasks.length, Math.max(1, concurrency));
  const results = new Array(tasks.length);
  let nextTaskIndex = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    const worker = new Worker(PAIR_CAPACITY_WORKER_URL, {
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

function compareAlignedPairCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  const nextShift = Math.abs(nextCandidate.rowShiftXmm || 0) + Math.abs(nextCandidate.rowShiftYmm || 0);
  const bestShift = Math.abs(bestCandidate.rowShiftXmm || 0) + Math.abs(bestCandidate.rowShiftYmm || 0);
  if (nextShift !== bestShift) {
    return nextShift - bestShift;
  }
  if (nextCandidate.bodyCount !== bestCandidate.bodyCount) {
    return bestCandidate.bodyCount - nextCandidate.bodyCount;
  }
  if (nextCandidate.fillerCount !== bestCandidate.fillerCount) {
    return nextCandidate.fillerCount - bestCandidate.fillerCount;
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
        cachedPolygonsOverlap(
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

export class CapacityTestComplementaryPattern extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _getStaggerSpacing(config) {
    const baseSpacing = config?.spacing ?? 0;
    const staggerSpacing = config?.staggerSpacing;
    if (!Number.isFinite(staggerSpacing)) return baseSpacing;
    return Math.max(baseSpacing, staggerSpacing);
  }

  _minSepV(rA, rB, dx) {
    for (let dy = -rB.rows; dy <= rA.rows + rB.rows; dy++) {
      let overlap = false;
      const yStart = Math.max(0, dy);
      const yEnd = Math.min(rA.rows, dy + rB.rows);
      if (yStart < yEnd) {
        outer: for (let r = yStart; r < yEnd; r++) {
          const offA = r * rA.cols;
          const offB = (r - dy) * rB.cols;
          for (let cB = 0; cB < rB.cols; cB++) {
            const cA = cB + dx;
            if (cA >= 0 && cA < rA.cols && rA.cells[offA + cA] && rB.cells[offB + cB]) {
              overlap = true;
              break outer;
            }
          }
        }
      }
      if (!overlap) return dy;
    }
    return rA.rows + rB.rows;
  }

  _minSepH(rA, rB, dy) {
    for (let dx = -rB.cols; dx <= rA.cols + rB.cols; dx++) {
      let overlap = false;
      const xStart = Math.max(0, dx);
      const xEnd = Math.min(rA.cols, dx + rB.cols);
      if (xStart < xEnd) {
        outer: for (let c = xStart; c < xEnd; c++) {
          for (let rowB = 0; rowB < rB.rows; rowB++) {
            const rowA = rowB + dy;
            if (rowA >= 0 && rowA < rA.rows) {
              if (rA.cells[rowA * rA.cols + c] && rB.cells[rowB * rB.cols + (c - dx)]) {
                overlap = true;
                break outer;
              }
            }
          }
        }
      }
      if (!overlap) return dx;
    }
    return rA.cols + rB.cols;
  }

  _getAngleFamilies(config) {
    const allowed = new Set(this._getAllowedAngles(config));
    let bodyAngles = [0, 180].filter((angle) => allowed.has(angle));
    let topAngles = [90, 270].filter((angle) => allowed.has(angle));

    if (!bodyAngles.length) {
      bodyAngles = [...allowed].sort((a, b) => a - b);
    }
    if (!topAngles.length && config.allowRotate90 !== false && allowed.has(90)) {
      topAngles = [90];
    }

    return {
      bodyAngles,
      topAngles
    };
  }

  _buildOrients(sizeName, foot, polygon, angles, config, step) {
    const item = { sizeName, foot, polygon };
    return [...new Set(angles)]
      .map((angle) => {
        const orient = this._getOrient(item, angle, step, config.spacing);
        const bb = getOrientBounds(orient);
        return {
          ...orient,
          foot,
          bb,
          width: bb.width,
          height: bb.height,
          key: `${foot}-${angle}`
        };
      })
      .sort((a, b) => a.angle - b.angle);
  }

  _isPairSafe(orientA, orientB, dxMm, dyMm, spacing, step) {
    if (dxMm === 0 && dyMm === 0) return false;
    const dx = Math.round(dxMm / step);
    const dy = Math.round(dyMm / step);
    if (this._checkRasterOverlap(orientA.raster, orientB.raster, dx, dy)) {
      return false;
    }
    return !cachedPolygonsOverlap(
      orientA.polygon,
      orientB.polygon,
      { x: 0, y: 0 },
      { x: dxMm, y: dyMm },
      spacing,
      orientA.bb,
      orientB.bb
    );
  }

  _createMotif(order, leftOrient, rightOrient, pairDxMm, pairDyMm, name) {
    const firstOrient = order === 'LR' ? leftOrient : rightOrient;
    const secondOrient = order === 'LR' ? rightOrient : leftOrient;
    const rawItems = [
      { id: `${name}_0`, orient: firstOrient, x: 0, y: 0 },
      { id: `${name}_1`, orient: secondOrient, x: pairDxMm, y: pairDyMm }
    ];
    const rawBounds = computeEnvelope(rawItems);
    const items = rawItems.map((item) => ({
      ...item,
      x: item.x - rawBounds.minX,
      y: item.y - rawBounds.minY
    }));
    const bounds = computeEnvelope(items);

    return {
      name,
      order,
      items,
      bounds,
      width: bounds.width,
      height: bounds.height,
      pairDxMm: roundMetric(pairDxMm),
      pairDyMm: roundMetric(pairDyMm),
      leftOrient,
      rightOrient,
      leftAngle: leftOrient.angle,
      rightAngle: rightOrient.angle
    };
  }

  _materializeMotif(motif, originX, originY, prefix) {
    return motif.items.map((item, index) => ({
      id: `${prefix}_${index}`,
      orient: item.orient,
      x: originX + item.x,
      y: originY + item.y
    }));
  }

  _buildRowSpecs(startFoot, leftOrients, rightOrients) {
    const specs = [];
    for (const leftOrient of leftOrients) {
      for (const rightOrient of rightOrients) {
        specs.push({
          startFoot,
          leftOrient,
          rightOrient
        });
      }
    }
    return specs;
  }

  _getRowOrient(rowSpec, col) {
    const isEvenCol = Math.abs(col) % 2 === 0;
    const useLeft = rowSpec.startFoot === 'L' ? isEvenCol : !isEvenCol;
    return useLeft ? rowSpec.leftOrient : rowSpec.rightOrient;
  }

  _buildAlternatingRowPlacements(rowSpec, dxMm, colShiftYmm, rowXmm, rowYmm, colStart, colEnd, prefix) {
    const placements = [];
    for (let col = colStart; col <= colEnd; col++) {
      placements.push({
        id: `${prefix}_${col}`,
        orient: this._getRowOrient(rowSpec, col),
        x: rowXmm + col * dxMm,
        y: rowYmm + (Math.abs(col) % 2 === 1 ? colShiftYmm : 0)
      });
    }
    return placements;
  }

  _areSameRowSafe(rowSpec, dxMm, colShiftYmm, spacing) {
    const placements = this._buildAlternatingRowPlacements(rowSpec, dxMm, colShiftYmm, 0, 0, -2, 5, 'same_row');
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findAlternatingDx(row0Spec, row1Spec, colShiftYmm, config, step) {
    const widthUpper = Math.max(
      row0Spec.leftOrient.width,
      row0Spec.rightOrient.width,
      row1Spec.leftOrient.width,
      row1Spec.rightOrient.width
    );
    const upper = Math.max(
      step,
      quantizeToStep(widthUpper * 2 + Math.abs(colShiftYmm) + config.spacing + step * 6, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (dxMm) =>
      this._areSameRowSafe(row0Spec, dxMm, colShiftYmm, config.spacing) &&
      this._areSameRowSafe(row1Spec, dxMm, colShiftYmm, config.spacing)
    );
  }

  _areAdjacentAlternatingRowsSafe(row0Spec, row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowShiftYmm, rowStrideYmm, spacing) {
    const placements = [
      ...this._buildAlternatingRowPlacements(row0Spec, dxMm, colShiftYmm, 0, 0, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row0'),
      ...this._buildAlternatingRowPlacements(row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowStrideYmm + rowShiftYmm, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row1'),
      ...this._buildAlternatingRowPlacements(row0Spec, dxMm, colShiftYmm, 0, rowStrideYmm * 2, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row2')
    ];
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findAlternatingDy(row0Spec, row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowShiftYmm, config, step) {
    const requiredSpacing = this._getStaggerSpacing(config);
    const heightUpper = Math.max(
      row0Spec.leftOrient.height,
      row0Spec.rightOrient.height,
      row1Spec.leftOrient.height,
      row1Spec.rightOrient.height
    );
    const upper = Math.max(
      step,
      quantizeToStep(heightUpper * 2 + Math.abs(colShiftYmm) + Math.abs(rowShiftYmm) + config.spacing + step * 10, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideYmm) =>
      this._areAdjacentAlternatingRowsSafe(
        row0Spec,
        row1Spec,
        dxMm,
        colShiftYmm,
        rowShiftXmm,
        rowShiftYmm,
        rowStrideYmm,
        requiredSpacing
      )
    );
  }

  _findBestMotif(order, leftOrient, rightOrient, config, step, namePrefix) {
    const firstOrient = order === 'LR' ? leftOrient : rightOrient;
    const secondOrient = order === 'LR' ? rightOrient : leftOrient;
    let bestMotif = null;

    const considerCandidate = (dxCells, dyCells) => {
      const dxMm = dxCells * step;
      const dyMm = dyCells * step;
      if (!this._isPairSafe(firstOrient, secondOrient, dxMm, dyMm, config.spacing, step)) {
        return;
      }
      const motif = this._createMotif(order, leftOrient, rightOrient, dxMm, dyMm, namePrefix);
      if (compareMotifCandidates(motif, bestMotif) < 0) {
        bestMotif = motif;
      }
    };

    for (let dxCells = -secondOrient.raster.cols; dxCells <= firstOrient.raster.cols; dxCells++) {
      const dyCells = this._minSepV(firstOrient.raster, secondOrient.raster, dxCells);
      considerCandidate(dxCells, dyCells);
    }

    for (let dyCells = -secondOrient.raster.rows; dyCells <= firstOrient.raster.rows; dyCells++) {
      const dxCells = this._minSepH(firstOrient.raster, secondOrient.raster, dyCells);
      considerCandidate(dxCells, dyCells);
    }

    return bestMotif;
  }

  _buildMotifOptions(order, leftOrients, rightOrients, config, step, deadline, prefix) {
    const motifs = [];

    for (const leftOrient of leftOrients) {
      if (Date.now() > deadline) break;
      for (const rightOrient of rightOrients) {
        if (Date.now() > deadline) break;
        const motif = this._findBestMotif(
          order,
          leftOrient,
          rightOrient,
          config,
          step,
          `${prefix}_${leftOrient.angle}_${rightOrient.angle}`
        );
        if (motif) {
          motifs.push(motif);
        }
      }
    }

    return motifs.sort((a, b) => compareMotifCandidates(a, b));
  }

  _areRowRepeatsSafe(motif, rowStrideXmm, spacing) {
    const placements = [];
    for (let col = 0; col < ROW_REPEAT_CHECK_COUNT; col++) {
      placements.push(...this._materializeMotif(motif, col * rowStrideXmm, 0, `repeat_${col}`));
    }
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findRowStrideX(row0Motif, row1Motif, config, step) {
    const upper = Math.max(
      step,
      quantizeToStep(Math.max(row0Motif.width, row1Motif.width) * 2 + config.spacing + step * 8, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideXmm) =>
      this._areRowRepeatsSafe(row0Motif, rowStrideXmm, config.spacing) &&
      this._areRowRepeatsSafe(row1Motif, rowStrideXmm, config.spacing)
    );
  }

  _buildRowNeighborhood(row0Motif, row1Motif, rowStrideXmm, rowShiftXmm, rowShiftYmm, rowStrideYmm) {
    const rows = [];
    const motifs = [row0Motif, row1Motif, row0Motif];

    for (let row = 0; row < motifs.length; row++) {
      const motif = motifs[row];
      const isOddRow = row % 2 === 1;
      const rowX = isOddRow ? rowShiftXmm : 0;
      const rowY = row * rowStrideYmm + (isOddRow ? rowShiftYmm : 0);

      for (let col = ROW_NEIGHBOR_COL_START; col <= ROW_NEIGHBOR_COL_END; col++) {
        rows.push(...this._materializeMotif(motif, rowX + col * rowStrideXmm, rowY, `row_${row}_${col}`));
      }
    }

    return rows;
  }

  _findRowStrideY(row0Motif, row1Motif, rowStrideXmm, rowShiftXmm, rowShiftYmm, config, step) {
    const requiredSpacing = this._getStaggerSpacing(config);
    const upper = Math.max(
      step,
      quantizeToStep(row0Motif.height + row1Motif.height + Math.abs(rowShiftYmm) + requiredSpacing + step * 10, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideYmm) => {
      const neighborhood = this._buildRowNeighborhood(
        row0Motif,
        row1Motif,
        rowStrideXmm,
        rowShiftXmm,
        rowShiftYmm,
        rowStrideYmm
      );
      return validateLocalPlacements(neighborhood, requiredSpacing).valid;
    });
  }

  _buildBodyPlacements(pattern, workWidth, workHeight, startYmm = 0, maxRows = Number.MAX_SAFE_INTEGER) {
    const placements = [];
    const baseX = pattern.rowShiftXmm < 0 ? -pattern.rowShiftXmm : 0;
    const minEvenY = Math.min(0, pattern.colShiftYmm);
    const minOddY = pattern.rowShiftYmm + Math.min(0, pattern.colShiftYmm);
    const baseY = startYmm - Math.min(0, minEvenY, minOddY);
    let usedRows = 0;
    let usedCols = 0;

    for (let row = 0; row < maxRows; row++) {
      const rowX = baseX + (row % 2 === 1 ? pattern.rowShiftXmm : 0);
      const rowY = baseY + row * pattern.rowStrideYmm + (row % 2 === 1 ? pattern.rowShiftYmm : 0);
      const rowSpec = row % 2 === 1 ? pattern.row1Spec : pattern.row0Spec;
      const maxRowHeight = Math.max(rowSpec.leftOrient.height, rowSpec.rightOrient.height) + Math.abs(pattern.colShiftYmm);
      if (rowY + maxRowHeight > workHeight + 1e-6) break;

      const rowPlacements = [];
      for (let col = 0; ; col++) {
        const orient = this._getRowOrient(rowSpec, col);
        const x = rowX + col * pattern.dxMm;
        if (x + orient.width > workWidth + 1e-6) break;
        const y = rowY + (col % 2 === 1 ? pattern.colShiftYmm : 0);
        if (y < -1e-6 || y + orient.height > workHeight + 1e-6) continue;

        rowPlacements.push({
          id: `body_${row}_${col}`,
          orient,
          x,
          y
        });
      }

      if (!rowPlacements.length) break;

      placements.push(...rowPlacements);
      usedRows += 1;
      usedCols = Math.max(usedCols, Math.floor(rowPlacements.length / 2));
    }

    return {
      placements,
      usedRows,
      usedCols
    };
  }

  _buildTopBandPlacements(topPattern, workWidth, workHeight) {
    const placements = [];
    const minY = Math.min(0, topPattern.colShiftYmm);
    const baseY = -minY;
    const rowHeight = Math.max(topPattern.rowSpec.leftOrient.height, topPattern.rowSpec.rightOrient.height) + Math.abs(topPattern.colShiftYmm);
    if (rowHeight > workHeight + 1e-6) {
      return { placements, topBandPairs: 0 };
    }

    for (let col = 0; ; col++) {
      const orient = this._getRowOrient(topPattern.rowSpec, col);
      const x = col * topPattern.dxMm;
      if (x + orient.width > workWidth + 1e-6) break;
      const y = baseY + (col % 2 === 1 ? topPattern.colShiftYmm : 0);
      if (y < -1e-6 || y + orient.height > workHeight + 1e-6) continue;

      placements.push({
        id: `top_${col}`,
        orient,
        x,
        y
      });
    }

    return {
      placements,
      topBandPairs: placements.length / 2
    };
  }

  _findBodyStartY(topPlacements, pattern, workWidth, workHeight, config, step) {
    return findMinimalQuantizedValue(0, workHeight, step, (startYmm) => {
      const body = this._buildBodyPlacements(pattern, workWidth, workHeight, startYmm, 2);
      if (!body.placements.length) return false;
      return validatePatternPlacements([...topPlacements, ...body.placements], workWidth, workHeight, config.spacing).valid;
    });
  }

  _resolvePairBodyOrient(orients, col, startFoot = 'L', primaryFirst = true) {
    const usePrimary = (primaryFirst ? col % 2 === 0 : col % 2 === 1)
      || !orients.alternateLeft
      || !orients.alternateRight;
    const useLeft = startFoot === 'L' ? col % 2 === 0 : col % 2 === 1;

    if (usePrimary) {
      return useLeft ? orients.primaryLeft : orients.primaryRight;
    }
    return useLeft ? orients.alternateLeft : orients.alternateRight;
  }

  _resolvePairFillerOrient(orients, row, col, startFoot = 'L') {
    const usePrimaryRow = row % 2 === 0 || !orients.alternateLeft || !orients.alternateRight;
    const useLeft = startFoot === 'L' ? col % 2 === 0 : col % 2 === 1;

    if (usePrimaryRow) {
      return useLeft ? orients.primaryLeft : orients.primaryRight;
    }
    return useLeft ? orients.alternateLeft : orients.alternateRight;
  }

  _buildSequentialPairRow(resolveOrient, workWidth, config, step, prefix) {
    const precision = Math.min(step, 0.05);
    const buildRow = (validateAgainstWholeRow) => {
      const placements = [];

      for (let col = 0; ; col++) {
        const orient = resolveOrient(col);
        const maxX = roundMetric(workWidth - orient.bb.maxX, 3);
        if (maxX < -1e-6) break;

        const itemId = `${prefix}_${col}`;
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

  _findSequentialPairRowPitch(rowPlacements, config, step) {
    if (!rowPlacements.length) return null;

    const precision = Math.min(step, 0.05);
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const upper = buildUpperBound(
      step,
      rowBottom - rowTop + config.spacing + step * 8
    );

    return findMinimalContinuousValue(0, upper, precision, (deltaY) =>
      !hasCrossPlacementOverlap(
        rowPlacements,
        rowPlacements.map((placement, index) => ({
          ...placement,
          id: `pair_next_${index}`,
          y: roundMetric(placement.y + deltaY, 3)
        })),
        config.spacing
      )
    );
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

  _buildRepeatedPlacements(rowPlacements, rows, rowPitch, startY = 0, prefix = 'pair_body') {
    const placements = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < rowPlacements.length; col++) {
        const placement = rowPlacements[col];
        placements.push({
          id: `${prefix}_${row}_${col}`,
          orient: placement.orient,
          x: placement.x,
          y: roundMetric(startY + placement.y + row * rowPitch, 3)
        });
      }
    }
    return placements;
  }

  _shiftRowPlacements(rowPlacements, shiftXmm, workWidth, prefix = 'pair_row_shift') {
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

    const ratios = Array.isArray(this.config.pairAlignedRowShiftRatios) && this.config.pairAlignedRowShiftRatios.length
      ? this.config.pairAlignedRowShiftRatios
      : [0.125, 0.35, 0.5];
    const candidates = [];
    for (const ratio of ratios) {
      const value = quantizeToStep(averagePitchX * ratio, step);
      if (Math.abs(value) < step) continue;
      candidates.push(value);
    }

    return [...new Set(candidates)]
      .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
  }

  _buildAlignedPairBodyVariants(bodyStrategy, bodyRowPlacements, workWidth, workHeight, config, step, includeShifted = true) {
    const variants = [];
    const staggerSpacing = this._getStaggerSpacing(config);
    const bodyDyMm = this._findSequentialPairRowPitch(bodyRowPlacements, config, step);
    if (bodyDyMm == null) return variants;

    const bodyRows = this._countRowsFromPlacements(bodyRowPlacements, bodyDyMm, workHeight);
    if (bodyRows > 0) {
      variants.push({
        key: `uniform_${bodyStrategy.key}`,
        row0Placements: bodyRowPlacements,
        row1Placements: bodyRowPlacements,
        row0ToRow1Dy: bodyDyMm,
        row1ToRow0Dy: bodyDyMm,
        bodyRows,
        bodyCount: bodyRowPlacements.length * bodyRows,
        placements: this._buildRepeatedPlacements(
          bodyRowPlacements,
          bodyRows,
          bodyDyMm,
          0,
          `pair_body_${bodyStrategy.key}`
        ),
        lastRowPlacements: bodyRowPlacements,
        lastRowStartY: roundMetric((bodyRows - 1) * bodyDyMm, 3),
        bodyDxMm: getAveragePitchX(bodyRowPlacements),
        bodyDyMm: roundMetric(bodyDyMm),
        rowShiftXmm: 0,
        rowShiftYmm: 0,
        usedCols: Math.floor(bodyRowPlacements.length / 2),
        usedRows: bodyRows,
        bodyPatternMode: 'aligned-uniform'
      });
    }

    const averagePitchX = getAveragePitchX(bodyRowPlacements);
    if (!averagePitchX || !includeShifted) return variants;

    const rowShiftCandidates = this._buildAlignedRowShiftCandidates(averagePitchX, step);

    for (const rowShiftXmm of rowShiftCandidates) {
      const shiftedRowPlacements = this._shiftRowPlacements(
        bodyRowPlacements,
        rowShiftXmm,
        workWidth,
        `pair_body_shift_${bodyStrategy.key}_${rowShiftXmm}`
      );
      if (!shiftedRowPlacements.length) continue;

      const row0ToRow1Dy = this._findStartOffsetAfterRow(bodyRowPlacements, shiftedRowPlacements, config, step, staggerSpacing);
      const row1ToRow0Dy = this._findStartOffsetAfterRow(shiftedRowPlacements, bodyRowPlacements, config, step, staggerSpacing);
      if (row0ToRow1Dy == null || row1ToRow0Dy == null) continue;

      const alternatingRows = this._countAlternatingRowsFromRows(
        bodyRowPlacements,
        shiftedRowPlacements,
        row0ToRow1Dy,
        row1ToRow0Dy,
        workHeight
      );
      if (!alternatingRows) continue;

      const alternatingPlacements = this._buildAlternatingRepeatedRows(
        bodyRowPlacements,
        shiftedRowPlacements,
        alternatingRows,
        row0ToRow1Dy,
        row1ToRow0Dy,
        0,
        `pair_body_shift_${bodyStrategy.key}_${rowShiftXmm}`
      );
      const bodyCount = this._countAlternatingPieces(
        bodyRowPlacements,
        shiftedRowPlacements,
        alternatingRows
      );

      variants.push({
        key: `shifted_${bodyStrategy.key}_${rowShiftXmm}`,
        row0Placements: bodyRowPlacements,
        row1Placements: shiftedRowPlacements,
        row0ToRow1Dy: roundMetric(row0ToRow1Dy),
        row1ToRow0Dy: roundMetric(row1ToRow0Dy),
        bodyRows: alternatingRows,
        bodyCount,
        placements: alternatingPlacements,
        lastRowPlacements: alternatingRows % 2 === 1 ? bodyRowPlacements : shiftedRowPlacements,
        lastRowStartY: this._getAlternatingLastRowStartY(
          alternatingRows,
          row0ToRow1Dy,
          row1ToRow0Dy
        ),
        bodyDxMm: averagePitchX,
        bodyDyMm: roundMetric((row0ToRow1Dy + row1ToRow0Dy) / 2),
        rowShiftXmm: roundMetric(rowShiftXmm),
        rowShiftYmm: 0,
        usedCols: Math.max(bodyRowPlacements.length, shiftedRowPlacements.length) / 2,
        usedRows: alternatingRows,
        bodyPatternMode: 'aligned-shifted'
      });
    }

    return variants;
  }

  _findStartOffsetAfterRow(baseRowPlacements, nextRowPlacements, config, step, requiredSpacing = config.spacing) {
    if (!baseRowPlacements.length || !nextRowPlacements.length) return 0;

    const precision = Math.min(step, 0.05);
    const baseBottom = getPlacementsBottom(baseRowPlacements);
    const nextTop = getPlacementsTop(nextRowPlacements);
    const nextBottom = getPlacementsBottom(nextRowPlacements);
    const upper = buildUpperBound(
      step,
      baseBottom - nextTop + nextBottom + requiredSpacing + step * 8
    );

    const deltaY = findMinimalContinuousValue(0, upper, precision, (delta) =>
      !hasCrossPlacementOverlap(
        baseRowPlacements,
        nextRowPlacements.map((placement, index) => ({
          ...placement,
          id: `pair_fill_${index}`,
          y: roundMetric(placement.y + delta, 3)
        })),
        requiredSpacing
      )
    );

    return deltaY == null ? null : roundMetric(deltaY, 3);
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

  _buildAlternatingRepeatedRows(row0Placements, row1Placements, rows, row0ToRow1Dy, row1ToRow0Dy, startY = 0, prefix = 'pair_fill_alt') {
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

  _countAlternatingPieces(row0Placements, row1Placements, rows) {
    let total = 0;
    for (let row = 0; row < rows; row++) {
      total += row % 2 === 0 ? row0Placements.length : row1Placements.length;
    }
    return total;
  }

  _normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  _getPairFineRotateOffsets(config) {
    const rawOffsets = Array.isArray(config.pairFineRotateOffsets) && config.pairFineRotateOffsets.length
      ? config.pairFineRotateOffsets
      : (() => {
          if ((config.gridStep || 1) <= 0.5) {
            const denseOffsets = [];
            const stepDegrees = Number.isFinite(config.pairFineRotateStepDegrees)
              ? Math.max(0.125, config.pairFineRotateStepDegrees)
              : DETAILED_FINE_ROTATE_STEP_DEGREES;
            for (let value = -MAX_FINE_ROTATE_DEGREES; value <= MAX_FINE_ROTATE_DEGREES + 0.0001; value += stepDegrees) {
              denseOffsets.push(roundMetric(value, 3));
            }
            return denseOffsets;
          }
          return [-4, -2, 0, 2, 4];
        })();
    if (config.pairFineRotateEnabled === false) {
      return [0];
    }
    return normalizeFineRotateOffsets(rawOffsets);
  }

  _buildPairBodyStrategies(sizeName, baseLeft, baseRight, config, step) {
    const orientCache = new Map();
    const ensureOrient = (foot, polygon, angle) => {
      const normalizedAngle = this._normalizeAngle(angle);
      const key = `${foot}_${normalizedAngle}`;
      if (!orientCache.has(key)) {
        const orient = this._buildOrients(sizeName, foot, polygon, [normalizedAngle], config, step)[0] || null;
        orientCache.set(key, orient);
      }
      return orientCache.get(key);
    };

    const strategies = new Map();
    const pushStrategy = (keyPrefix, firstOrient, secondOrient, extra = {}) => {
      if (!firstOrient || !secondOrient) return;
      const key = `${firstOrient.foot}_${firstOrient.angle}|${secondOrient.foot}_${secondOrient.angle}`;
      if (strategies.has(key)) return;
      strategies.set(key, {
        key: `${keyPrefix}_${key}`,
        rowSequence: [firstOrient, secondOrient],
        ...extra
      });
    };

    for (const offset of this._getPairFineRotateOffsets(config)) {
      const leftNear0 = ensureOrient('L', baseLeft, offset);
      const rightNear180Mirror = ensureOrient('R', baseRight, 180 - offset);
      const leftNear180Mirror = ensureOrient('L', baseLeft, 180 - offset);
      const rightNear0Mirror = ensureOrient('R', baseRight, -offset);
      pushStrategy('pair-mirror-a', leftNear0, rightNear180Mirror, {
        bodyRotationMode: 'mirror-a',
        rotationOffset: offset
      });
      pushStrategy('pair-mirror-a-rev', rightNear180Mirror, leftNear0, {
        bodyRotationMode: 'mirror-a',
        rotationOffset: offset
      });
      pushStrategy('pair-mirror-b', leftNear180Mirror, rightNear0Mirror, {
        bodyRotationMode: 'mirror-b',
        rotationOffset: offset
      });
      pushStrategy('pair-mirror-b-rev', rightNear0Mirror, leftNear180Mirror, {
        bodyRotationMode: 'mirror-b',
        rotationOffset: offset
      });
    }

    return [...strategies.values()];
  }

  _buildAlignedMotifOrderOptions(leftOrients, rightOrients, config, step, deadline, prefix) {
    return [
      ...this._buildMotifOptions('LR', leftOrients, rightOrients, config, step, deadline, `${prefix}_lr`),
      ...this._buildMotifOptions('RL', leftOrients, rightOrients, config, step, deadline, `${prefix}_rl`)
    ].sort((a, b) => compareMotifCandidates(a, b));
  }

  _buildAlignedMotifRowPlacements(motif, rowStrideXmm, workWidth, rowYmm, prefix) {
    const placements = [];
    let usedCols = 0;

    for (let col = 0; ; col++) {
      const originX = col * rowStrideXmm;
      if (originX + motif.width > workWidth + 1e-6) break;
      placements.push(...this._materializeMotif(motif, originX, rowYmm, `${prefix}_${col}`));
      usedCols += 1;
    }

    return {
      placements,
      usedCols
    };
  }

  _buildAlignedMotifPlacements(motif, rowStrideXmm, rowStrideYmm, workWidth, workHeight, startYmm = 0, maxRows = Number.MAX_SAFE_INTEGER) {
    const placements = [];
    let usedRows = 0;
    let usedCols = 0;

    for (let row = 0; row < maxRows; row++) {
      const rowY = startYmm + row * rowStrideYmm;
      if (rowY + motif.height > workHeight + 1e-6) break;

      const rowData = this._buildAlignedMotifRowPlacements(motif, rowStrideXmm, workWidth, rowY, `aligned_${row}`);
      if (!rowData.placements.length) break;

      placements.push(...rowData.placements);
      usedRows += 1;
      usedCols = Math.max(usedCols, rowData.usedCols);
    }

    return {
      placements,
      usedRows,
      usedCols
    };
  }

  _buildAlternatingAlignedMotifPlacements(row0Motif, row1Motif, rowStrideXmm, rowStrideYmm, workWidth, workHeight, startYmm = 0, maxRows = Number.MAX_SAFE_INTEGER) {
    const placements = [];
    let usedRows = 0;
    let usedCols = 0;

    for (let row = 0; row < maxRows; row++) {
      const motif = row % 2 === 0 ? row0Motif : row1Motif;
      const rowY = startYmm + row * rowStrideYmm;
      if (rowY + motif.height > workHeight + 1e-6) break;

      const rowData = this._buildAlignedMotifRowPlacements(motif, rowStrideXmm, workWidth, rowY, `aligned_alt_${row}`);
      if (!rowData.placements.length) break;

      placements.push(...rowData.placements);
      usedRows += 1;
      usedCols = Math.max(usedCols, rowData.usedCols);
    }

    return {
      placements,
      usedRows,
      usedCols
    };
  }

  _findAlignedStartAfterPlacements(basePlacements, nextPlacements, config, step) {
    if (!basePlacements.length || !nextPlacements.length) return 0;

    const baseBounds = computeEnvelope(basePlacements);
    const nextBounds = computeEnvelope(nextPlacements);
    const upper = Math.max(
      step,
      quantizeToStep(baseBounds.maxY - nextBounds.minY + nextBounds.height + config.spacing + step * 8, step)
    );

    return findMinimalQuantizedValue(0, upper, step, (deltaYmm) => {
      const shiftedPlacements = nextPlacements.map((placement, index) => ({
        ...placement,
        id: `${placement.id || 'next'}_${index}`,
        y: placement.y + deltaYmm
      }));
      return validateLocalPlacements([...basePlacements, ...shiftedPlacements], config.spacing).valid;
    });
  }

  _buildAlignedCandidateMetadata(bodyMotif, body, rowStrideXmm, rowStrideYmm, extra = {}) {
    return {
      patternFamily: 'aligned-grid',
      topBandUsed: false,
      topBandPairs: 0,
      topBandAngleLeft: null,
      topBandAngleRight: null,
      bodyRow0LeftAngle: bodyMotif.leftAngle,
      bodyRow0RightAngle: bodyMotif.rightAngle,
      bodyRow1LeftAngle: bodyMotif.leftAngle,
      bodyRow1RightAngle: bodyMotif.rightAngle,
      pairDxMm: roundMetric(bodyMotif.pairDxMm),
      pairDyMm: roundMetric(bodyMotif.pairDyMm),
      rowStrideXmm: roundMetric(rowStrideXmm),
      rowStrideYmm: roundMetric(rowStrideYmm),
      rowShiftXmm: 0,
      rowShiftYmm: 0,
      usedRows: body.usedRows,
      usedCols: body.usedCols,
      ...extra
    };
  }

  _findBestAlignedForSize(size, config, workWidth, workHeight, deadline) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(size.polygon) || 1;
    const baseLeft = normalizeToOrigin(size.polygon);
    const baseRight = normalizeToOrigin(flipX(size.polygon));
    const buildAngleOrient = (foot, polygon, angle) => {
      const normalizedAngle = this._normalizeAngle(angle);
      return this._buildOrients(size.sizeName, foot, polygon, [normalizedAngle], config, step)[0] || null;
    };
    const fillerOrients = {
      primaryLeft: config.allowRotate90 === false ? null : buildAngleOrient('L', baseLeft, 90),
      primaryRight: config.allowRotate90 === false ? null : buildAngleOrient('R', baseRight, 90),
      alternateLeft: config.allowRotate90 === false ? null : buildAngleOrient('L', baseLeft, 270),
      alternateRight: config.allowRotate90 === false ? null : buildAngleOrient('R', baseRight, 270)
    };
    const bodyStrategies = this._buildPairBodyStrategies(size.sizeName, baseLeft, baseRight, config, step);
    if (!bodyStrategies.length) return null;

    const startFeet = ['L', 'R'];
    const fillerStrategies = [
      {
        key: 'none',
        rowPlacements: [],
        dyMm: null,
        primaryAngle: null,
        secondaryAngle: null,
        startFoot: null,
        priority: 2
      }
    ];

    if (fillerOrients.primaryLeft && fillerOrients.primaryRight) {
      for (const fillerStartFoot of startFeet) {
        const filler90Row = this._buildSequentialPairRow(
          (col) => this._resolvePairFillerOrient(
            {
              ...fillerOrients,
              alternateLeft: null,
              alternateRight: null
            },
            0,
            col,
            fillerStartFoot
          ),
          workWidth,
          config,
          step,
          `pair_fill90_${fillerStartFoot}`
        );
        if (!filler90Row.length) continue;

        const filler90DyMm = this._findSequentialPairRowPitch(filler90Row, config, step);
        if (filler90DyMm != null) {
          fillerStrategies.push({
            key: 'uniform-90',
            rowPlacements: filler90Row,
            dyMm: filler90DyMm,
            primaryAngle: 90,
            secondaryAngle: null,
            startFoot: fillerStartFoot,
            priority: 1
          });
        }

        if (fillerOrients.alternateLeft && fillerOrients.alternateRight) {
          const fillerAlternateStartFeet = [
            fillerStartFoot === 'L' ? 'R' : 'L',
            fillerStartFoot
          ];

          for (const filler270StartFoot of fillerAlternateStartFeet) {
            const filler270Row = this._buildSequentialPairRow(
              (col) => this._resolvePairFillerOrient(
                {
                  primaryLeft: fillerOrients.alternateLeft,
                  primaryRight: fillerOrients.alternateRight,
                  alternateLeft: null,
                  alternateRight: null
                },
                0,
                col,
                filler270StartFoot
              ),
              workWidth,
              config,
              step,
              `pair_fill270_${fillerStartFoot}_${filler270StartFoot}`
            );

            if (!filler270Row.length) continue;

            const filler90To270Dy = this._findStartOffsetAfterRow(filler90Row, filler270Row, config, step);
            const filler270To90Dy = this._findStartOffsetAfterRow(filler270Row, filler90Row, config, step);

            if (filler90To270Dy != null && filler270To90Dy != null) {
              fillerStrategies.push({
                key: filler270StartFoot === fillerStartFoot
                  ? 'alternate-90-270-same-start'
                  : 'alternate-90-270-opposite-start',
                rowPlacements: filler90Row,
                alternateRowPlacements: filler270Row,
                dyMm: filler90To270Dy,
                alternateDyMm: filler270To90Dy,
                primaryAngle: 90,
                secondaryAngle: 270,
                startFoot: fillerStartFoot,
                alternateStartFoot: filler270StartFoot,
                priority: filler270StartFoot === fillerStartFoot ? 1 : 0
              });
            }
          }
        }
      }
    }

    let bestCandidate = null;
    const fillerUpperBoundCache = new Map();

    const getFillerUpperBound = (strategy, availableHeight) => {
      if (!strategy.rowPlacements.length || availableHeight <= 0) return 0;

      const cacheKey = `${strategy.key}|${roundMetric(availableHeight, 2)}`;
      if (fillerUpperBoundCache.has(cacheKey)) {
        return fillerUpperBoundCache.get(cacheKey);
      }

      const rows = strategy.alternateRowPlacements?.length
        ? this._countAlternatingRowsFromRows(
          strategy.rowPlacements,
          strategy.alternateRowPlacements,
          strategy.dyMm,
          strategy.alternateDyMm ?? strategy.dyMm,
          availableHeight
        )
        : this._countRowsFromPlacements(
          strategy.rowPlacements,
          strategy.dyMm,
          availableHeight
        );
      const pieceCount = strategy.alternateRowPlacements?.length
        ? this._countAlternatingPieces(strategy.rowPlacements, strategy.alternateRowPlacements, rows)
        : rows * strategy.rowPlacements.length;

      fillerUpperBoundCache.set(cacheKey, pieceCount);
      return pieceCount;
    };

    const bodyRowEntries = [];
    let maxBodyRowLength = 0;
    for (const bodyStrategy of bodyStrategies) {
      if (Date.now() > deadline) break;

      const bodyRowPlacements = this._buildSequentialPairRow(
        (col) => bodyStrategy.rowSequence[col % bodyStrategy.rowSequence.length],
        workWidth,
        config,
        step,
        `pair_body_${bodyStrategy.key}`
      );
      if (!bodyRowPlacements.length) continue;

      maxBodyRowLength = Math.max(maxBodyRowLength, bodyRowPlacements.length);
      bodyRowEntries.push({
        bodyStrategy,
        bodyRowPlacements,
        bodyLeftOrient: bodyStrategy.rowSequence.find((orient) => orient.foot === 'L') || null,
        bodyRightOrient: bodyStrategy.rowSequence.find((orient) => orient.foot === 'R') || null
      });
    }

    for (const bodyRowEntry of bodyRowEntries) {
      if (Date.now() > deadline) break;

      const {
        bodyStrategy,
        bodyRowPlacements,
        bodyLeftOrient,
        bodyRightOrient
      } = bodyRowEntry;
      const bodyVariants = this._buildAlignedPairBodyVariants(
        bodyStrategy,
        bodyRowPlacements,
        workWidth,
        workHeight,
        config,
        step,
        bodyRowPlacements.length >= maxBodyRowLength
          && bodyStrategy.rowSequence[0]?.foot === 'L'
      );

      for (const bodyVariant of bodyVariants) {
        if (Date.now() > deadline) break;

        const bodyRemainingHeight = Math.max(0, workHeight - bodyVariant.lastRowStartY);
        const bodyUpperBound = bodyVariant.bodyCount + Math.max(
          0,
          ...fillerStrategies.map((strategy) => getFillerUpperBound(strategy, bodyRemainingHeight))
        );

        if (bestCandidate && bodyUpperBound < bestCandidate.placedCount) {
          continue;
        }

        for (const fillerStrategy of fillerStrategies) {
          if (Date.now() > deadline) break;

          const fillerRowPlacements = fillerStrategy.rowPlacements;
          const fillerUpperBound = getFillerUpperBound(fillerStrategy, bodyRemainingHeight);
          if (bestCandidate && bodyVariant.bodyCount + fillerUpperBound < bestCandidate.placedCount) {
            continue;
          }

          const fillerStartOffset = fillerRowPlacements.length
            ? this._findStartOffsetAfterRow(bodyVariant.lastRowPlacements, fillerRowPlacements, config, step)
            : 0;
          if (fillerRowPlacements.length && fillerStartOffset == null) continue;

          const fillerStartY = fillerRowPlacements.length
            ? roundMetric(bodyVariant.lastRowStartY + fillerStartOffset, 3)
            : 0;
          const fillerRows = fillerRowPlacements.length
            ? fillerStrategy.alternateRowPlacements?.length
              ? this._countAlternatingRowsFromRows(
                fillerRowPlacements,
                fillerStrategy.alternateRowPlacements,
                fillerStrategy.dyMm,
                fillerStrategy.alternateDyMm ?? fillerStrategy.dyMm,
                Math.max(0, workHeight - fillerStartY)
              )
              : this._countRowsFromPlacements(
                fillerRowPlacements,
                fillerStrategy.dyMm,
                Math.max(0, workHeight - fillerStartY)
              )
            : 0;
          const exactFillerCount = fillerRows > 0
            ? fillerStrategy.alternateRowPlacements?.length
              ? this._countAlternatingPieces(
                fillerRowPlacements,
                fillerStrategy.alternateRowPlacements,
                fillerRows
              )
              : fillerRows * fillerRowPlacements.length
            : 0;

          if (bestCandidate && bodyVariant.bodyCount + exactFillerCount < bestCandidate.placedCount) {
            continue;
          }

          const fillerPlacements = fillerRows > 0
            ? fillerStrategy.alternateRowPlacements?.length
              ? this._buildAlternatingRepeatedRows(
                fillerRowPlacements,
                fillerStrategy.alternateRowPlacements,
                fillerRows,
                fillerStrategy.dyMm,
                fillerStrategy.alternateDyMm ?? fillerStrategy.dyMm,
                fillerStartY,
                `pair_fill_${bodyStrategy.key}_${fillerStrategy.startFoot || 'none'}`
              )
              : this._buildRepeatedPlacements(
                fillerRowPlacements,
                fillerRows,
                fillerStrategy.dyMm,
                fillerStartY,
                `pair_fill_${bodyStrategy.key}_${fillerStrategy.startFoot || 'none'}`
              )
            : [];

          const candidate = this._buildCandidate(
            size.sizeName,
            pieceArea,
            [...bodyVariant.placements, ...fillerPlacements],
            {
              patternFamily: bodyVariant.bodyPatternMode === 'aligned-shifted'
                ? 'aligned-shifted-grid'
                : 'aligned-grid',
              topBandUsed: fillerRows > 0,
              topBandPairs: Math.floor(fillerPlacements.length / 2),
              topBandAngleLeft: fillerStrategy.primaryAngle,
              topBandAngleRight: fillerStrategy.primaryAngle,
              bodyRow0LeftAngle: bodyLeftOrient?.angle ?? null,
              bodyRow0RightAngle: bodyRightOrient?.angle ?? null,
              bodyRow1LeftAngle: bodyLeftOrient?.angle ?? null,
              bodyRow1RightAngle: bodyRightOrient?.angle ?? null,
              bodyStartFoot: bodyStrategy.rowSequence[0]?.foot ?? null,
              bodyPrimaryFirst: null,
              bodyRotationMode: bodyStrategy.bodyRotationMode,
              rotationOffset: bodyStrategy.rotationOffset,
              fillerStartFoot: fillerStrategy.startFoot,
              fillerAlternateStartFoot: fillerStrategy.alternateStartFoot ?? fillerStrategy.startFoot,
              pairDxMm: null,
              pairDyMm: null,
              rowStrideXmm: bodyVariant.bodyDxMm,
              rowStrideYmm: bodyVariant.bodyDyMm,
              rowShiftXmm: bodyVariant.rowShiftXmm,
              rowShiftYmm: bodyVariant.rowShiftYmm,
              usedRows: bodyVariant.usedRows,
              usedCols: bodyVariant.usedCols,
              bodyCount: bodyVariant.bodyCount,
              bodyCols: bodyRowPlacements.length,
              bodyRows: bodyVariant.bodyRows,
              bodyDxMm: bodyVariant.bodyDxMm,
              bodyDyMm: bodyVariant.bodyDyMm,
              fillerCount: exactFillerCount,
              fillerRows,
              fillerCols: fillerRowPlacements.length,
              fillerDxMm: fillerRowPlacements.length ? getAveragePitchX(fillerRowPlacements) : null,
              fillerDyMm: fillerStrategy.dyMm != null ? roundMetric(fillerStrategy.dyMm) : null,
              fillerAlternateDyMm: fillerStrategy.alternateDyMm != null ? roundMetric(fillerStrategy.alternateDyMm) : null,
              fillerPatternKey: fillerStrategy.key,
              fillerPatternPriority: fillerStrategy.priority,
              scanOrder: 'left-to-right-then-down'
            },
            workWidth,
            workHeight,
            config
          );

          if (candidate && compareAlignedPairCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }

    return bestCandidate;
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
        x: roundMetric(worldX, 3),
        y: roundMetric(worldY, 3),
        angle: placement.orient.angle,
        renderKey
      };
    });
    return { placed: items, renderTemplates };
  }

  _buildCandidate(sizeName, pieceArea, placements, metadata, workWidth, workHeight, config) {
    if (!placements.length) return null;

    const quickBounds = computeEnvelope(placements);
    const quickCandidate = {
      ...metadata,
      pieceArea,
      placedCount: placements.length,
      usedHeightMm: roundMetric(quickBounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, quickBounds.width * quickBounds.height - placements.length * pieceArea))
    };

    const validation = validatePatternPlacements(placements, workWidth, workHeight, config.spacing);
    if (!validation.valid) return null;

    return {
      ...quickCandidate,
      ...this._materializePlacedItems(sizeName, placements, config),
      bounds: validation.bounds,
      usedHeightMm: roundMetric(validation.bounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, validation.bounds.width * validation.bounds.height - placements.length * pieceArea))
    };
  }

  _findBestForSize(size, config, workWidth, workHeight, deadline) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(size.polygon) || 1;
    const baseLeft = normalizeToOrigin(size.polygon);
    const baseRight = normalizeToOrigin(flipX(size.polygon));
    const { bodyAngles, topAngles } = this._getAngleFamilies(config);
    const leftBodyOrients = this._buildOrients(size.sizeName, 'L', baseLeft, bodyAngles, config, step);
    const rightBodyOrients = this._buildOrients(size.sizeName, 'R', baseRight, bodyAngles, config, step);
    const leftTopOrients = topAngles.length
      ? this._buildOrients(size.sizeName, 'L', baseLeft, topAngles, config, step)
      : [];
    const rightTopOrients = topAngles.length
      ? this._buildOrients(size.sizeName, 'R', baseRight, topAngles, config, step)
      : [];

    const families = ['checkerboard', 'stripe'];

    let bestCandidate = null;
    const startOrders = ['L', 'R'];

    for (const family of families) {
      for (const startFoot of startOrders) {
        const row0Specs = this._buildRowSpecs(startFoot, leftBodyOrients, rightBodyOrients);
        const row1StartFoot = family === 'checkerboard'
          ? (startFoot === 'L' ? 'R' : 'L')
          : startFoot;
        const row1Specs = this._buildRowSpecs(row1StartFoot, leftBodyOrients, rightBodyOrients);

        for (const row0Spec of row0Specs) {
          if (Date.now() > deadline) return bestCandidate;

          for (const row1Spec of row1Specs) {
            if (Date.now() > deadline) return bestCandidate;

            const colShiftRange = Math.max(
              row0Spec.leftOrient.height,
              row0Spec.rightOrient.height,
              row1Spec.leftOrient.height,
              row1Spec.rightOrient.height
            ) * 0.35;
            const colShiftCandidates = buildShiftCandidates(colShiftRange, step, PAIR_SHIFT_SAMPLE_LIMIT);

            for (const colShiftYmm of colShiftCandidates) {
              if (Date.now() > deadline) return bestCandidate;

              const dxMm = this._findAlternatingDx(row0Spec, row1Spec, colShiftYmm, config, step);
              if (dxMm == null) continue;

              const rowShiftXRange = Math.max(
                row0Spec.leftOrient.width,
                row0Spec.rightOrient.width,
                row1Spec.leftOrient.width,
                row1Spec.rightOrient.width
              ) * 0.5;
              const rowShiftYRange = Math.max(
                row0Spec.leftOrient.height,
                row0Spec.rightOrient.height,
                row1Spec.leftOrient.height,
                row1Spec.rightOrient.height
              ) * 0.15;
              const rowShiftXCandidates = buildShiftCandidates(rowShiftXRange, step, ROW_SHIFT_X_SAMPLE_LIMIT);
              const rowShiftYCandidates = buildShiftCandidates(rowShiftYRange, step, ROW_SHIFT_Y_SAMPLE_LIMIT);

              for (const rowShiftXmm of rowShiftXCandidates) {
                if (Date.now() > deadline) return bestCandidate;

                for (const rowShiftYmm of rowShiftYCandidates) {
                  if (Date.now() > deadline) return bestCandidate;

                  const rowStrideYmm = this._findAlternatingDy(
                    row0Spec,
                    row1Spec,
                    dxMm,
                    colShiftYmm,
                    rowShiftXmm,
                    rowShiftYmm,
                    config,
                    step
                  );
                  if (rowStrideYmm == null) continue;

                  const pattern = {
                    patternFamily: family,
                    row0Spec,
                    row1Spec,
                    dxMm,
                    colShiftYmm,
                    rowStrideXmm: dxMm * 2,
                    rowStrideYmm,
                    rowShiftXmm,
                    rowShiftYmm
                  };

                  const bodyOnly = this._buildBodyPlacements(pattern, workWidth, workHeight, 0);
                  if (!bodyOnly.placements.length) continue;

                  const bodyCandidate = this._buildCandidate(
                    size.sizeName,
                    pieceArea,
                    bodyOnly.placements,
                    {
                      patternFamily: family,
                      topBandUsed: false,
                      topBandPairs: 0,
                      topBandAngleLeft: null,
                      topBandAngleRight: null,
                      bodyRow0LeftAngle: row0Spec.leftOrient.angle,
                      bodyRow0RightAngle: row0Spec.rightOrient.angle,
                      bodyRow1LeftAngle: row1Spec.leftOrient.angle,
                      bodyRow1RightAngle: row1Spec.rightOrient.angle,
                      pairDxMm: roundMetric(dxMm),
                      pairDyMm: roundMetric(colShiftYmm),
                      rowStrideXmm: roundMetric(dxMm * 2),
                      rowStrideYmm: roundMetric(rowStrideYmm),
                      rowShiftXmm: roundMetric(rowShiftXmm),
                      rowShiftYmm: roundMetric(rowShiftYmm),
                      usedRows: bodyOnly.usedRows,
                      usedCols: bodyOnly.usedCols
                    },
                    workWidth,
                    workHeight,
                    config
                  );

                  if (bodyCandidate && compareComplementaryCandidates(bodyCandidate, bestCandidate) < 0) {
                    bestCandidate = bodyCandidate;
                  }

                  if (!leftTopOrients.length || !rightTopOrients.length) continue;

                  for (const topStartFoot of startOrders) {
                    if (Date.now() > deadline) return bestCandidate;
                    const topSpecs = this._buildRowSpecs(topStartFoot, leftTopOrients, rightTopOrients);

                    for (const topSpec of topSpecs) {
                      if (Date.now() > deadline) return bestCandidate;

                      const topColShiftRange = Math.max(topSpec.leftOrient.height, topSpec.rightOrient.height) * 0.35;
                      const topColShiftCandidates = buildShiftCandidates(topColShiftRange, step, PAIR_SHIFT_SAMPLE_LIMIT);

                      for (const topColShiftYmm of topColShiftCandidates) {
                        const topDxMm = this._findAlternatingDx(topSpec, topSpec, topColShiftYmm, config, step);
                        if (topDxMm == null) continue;

                        const topBand = this._buildTopBandPlacements(
                          {
                            rowSpec: topSpec,
                            dxMm: topDxMm,
                            colShiftYmm: topColShiftYmm
                          },
                          workWidth,
                          workHeight
                        );
                        if (!topBand.topBandPairs) continue;

                        const bodyStartYmm = this._findBodyStartY(topBand.placements, pattern, workWidth, workHeight, config, step);
                        if (bodyStartYmm == null) continue;

                        const bodyWithTop = this._buildBodyPlacements(pattern, workWidth, workHeight, bodyStartYmm);
                        if (!bodyWithTop.placements.length) continue;

                        const candidate = this._buildCandidate(
                          size.sizeName,
                          pieceArea,
                          [...topBand.placements, ...bodyWithTop.placements],
                          {
                            patternFamily: family,
                            topBandUsed: true,
                            topBandPairs: topBand.topBandPairs,
                            topBandAngleLeft: topSpec.leftOrient.angle,
                            topBandAngleRight: topSpec.rightOrient.angle,
                            bodyRow0LeftAngle: row0Spec.leftOrient.angle,
                            bodyRow0RightAngle: row0Spec.rightOrient.angle,
                            bodyRow1LeftAngle: row1Spec.leftOrient.angle,
                            bodyRow1RightAngle: row1Spec.rightOrient.angle,
                            pairDxMm: roundMetric(dxMm),
                            pairDyMm: roundMetric(colShiftYmm),
                            rowStrideXmm: roundMetric(dxMm * 2),
                            rowStrideYmm: roundMetric(rowStrideYmm),
                            rowShiftXmm: roundMetric(rowShiftXmm),
                            rowShiftYmm: roundMetric(rowShiftYmm),
                            usedRows: bodyWithTop.usedRows,
                            usedCols: bodyWithTop.usedCols
                          },
                          workWidth,
                          workHeight,
                          config
                        );

                        if (candidate && compareComplementaryCandidates(candidate, bestCandidate) < 0) {
                          bestCandidate = candidate;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return bestCandidate;
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const placedCount = candidate.placed.length;
    const pairs = Math.floor(placedCount / 2);
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
    const perSizeBudget = config.capacityLayoutMode === 'legacy-pair'
      ? Math.max(2500, Math.floor((config.maxTimeMs || 120000) / Math.max(1, sizeList.length)))
      : Math.max(15000, Math.floor((config.maxTimeMs || 120000) / Math.max(1, sizeList.length)));

    const sheetsBySize = {};
    const summary = [];

    for (const size of sizeList) {
      const cacheKey = buildCapacityResultCacheKey(config.capacityLayoutMode === 'legacy-pair' ? 'legacy-pair' : 'pair-complementary', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        summary.push(cachedResult.summaryItem);
        sheetsBySize[size.sizeName] = cachedResult.sheet;
        continue;
      }

      const deadline = Date.now() + perSizeBudget;
      const candidate = config.capacityLayoutMode === 'legacy-pair'
        ? this._findBestForSize(
          size,
          config,
          workWidth,
          workHeight,
          deadline
        )
        : this._findBestAlignedForSize(
          size,
          config,
          workWidth,
          workHeight,
          deadline
        );

      if (!candidate) {
        const summaryItem = buildEmptyPairSummaryItem(size);
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

      const summaryItem = buildPairSummaryItem(size, sheet);
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
      mode: 'test-capacity-pair-complementary',
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
      const cacheKey = buildCapacityResultCacheKey(
        config.capacityLayoutMode === 'legacy-pair' ? 'legacy-pair' : 'pair-complementary',
        size,
        config
      );
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
    const orderedTasks = orderTasksByEstimatedWeight(uncachedTasks, (task) => estimatePairTaskWeight(task.size, task.config));
    const workerResults = orderedTasks.length
      ? await executePairCapacityTasksInParallel(orderedTasks, workerCount)
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
      mode: 'test-capacity-pair-complementary',
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
      capacityLayoutMode: overrideConfig.capacityLayoutMode === 'legacy-pair'
        ? 'legacy-pair'
        : 'pair-complementary',
      pairingStrategy: 'pair',
      mirrorPairs: true,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true
    };

    if (shouldUseParallelPairCapacity(sizeList, config)) {
      return this._testCapacityParallel(sizeList, config);
    }

    return this._testCapacitySequential(sizeList, config);
  }
}
