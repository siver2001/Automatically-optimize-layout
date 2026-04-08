import { Worker, isMainThread } from 'worker_threads';
import { normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestSameSidePattern } from './CapacityTestSameSidePattern.js';
import {
  buildCapacityResultCacheKey,
  getCachedCapacityResult,
  setCachedCapacityResult
} from './capacityResultCache.js';
import {
  orderTasksByEstimatedWeight,
  resolveAdaptiveParallelWorkerCount
} from './parallelCapacityUtils.js';

const SAME_SIDE_CAPACITY_WORKER_URL = new URL('../../../workers/diecutCapacitySameSideWorker.js', import.meta.url);

function compareTightCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.usedWidthMm !== bestCandidate.usedWidthMm) {
    return nextCandidate.usedWidthMm - bestCandidate.usedWidthMm;
  }
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

function shouldUseParallelPrePairedCapacity(sizeList, config) {
  return isMainThread
    && config.parallelSizes !== false
    && config.capacityLayoutMode === 'same-side-prepaired-tight'
    && sizeList.length > 1;
}

function estimatePrePairedTaskWeight(size, config) {
  const usableWidth = Math.max(1, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(1, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const usableArea = usableWidth * usableHeight;
  const pieceArea = Math.max(1, polygonArea(size?.polygon) || 1);
  const pointFactor = 1 + Math.max(0, ((size?.polygon?.length || 0) - 12) / 48);
  return usableArea / pieceArea * pointFactor;
}

function buildEmptySummaryItem(size) {
  return {
    sizeName: size.sizeName,
    sizeValue: size.sizeValue,
    totalPieces: 0,
    pairs: 0,
    placedCount: 0,
    efficiency: 0
  };
}

function buildSummaryItem(size, sheet) {
  if (!sheet) return buildEmptySummaryItem(size);
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

async function executeTasksInParallel(tasks, concurrency) {
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

export class CapacityTestPrePairedSameSidePattern extends CapacityTestSameSidePattern {
  _getPreferredAngles() {
    return [0, 90];
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    let bestCandidate = null;

    for (const angle of this._getPreferredAngles()) {
      const orient = this._decorateOrient(sizeName, foot, polygon, angle, config, step);
      const dxMm = this._findUniformDx(orient, config, step);
      if (dxMm == null) continue;

      const dyMm = this._findUniformDy(orient, dxMm, config, step);
      if (dyMm == null) continue;

      const bodyCols = this._countCols(orient.width, dxMm, workWidth);
      const bodyRows = this._countRows(orient.height, dyMm, workHeight);
      if (!bodyCols || !bodyRows) continue;

      const placements = this._buildUniformPlacements(
        orient,
        bodyCols,
        bodyRows,
        dxMm,
        dyMm,
        0
      );

      const candidate = this._buildCandidate(
        sizeName,
        foot,
        pieceArea,
        placements,
        {
          rowMode: 'uniform',
          bodyCount: placements.length,
          bodyCols,
          bodyRows,
          bodyDxMm: dxMm,
          bodyDyMm: dyMm,
          bodyStartY: 0,
          bodyPrimaryAngle: orient.angle,
          bodyAlternateAngle: orient.angle,
          bodyPatternMode: 'prepaired-uniform-pitch',
          bodyRotationOffset: 0,
          bodyStartPattern: 'uniform',
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          filler90Used: false,
          filler90Count: 0,
          filler90Cols: 0,
          filler90Rows: 0,
          filler90DxMm: null,
          filler90DyMm: null,
          filler270DyMm: null,
          filler90Angle: null,
          filler270Angle: null,
          fillerPatternKey: 'none',
          fillerPatternPriority: 99,
          fillerRotationOffset: 0,
          fillerStartPattern: 'none',
          scanOrder: 'uniform-pitch-grid'
        },
        workWidth,
        workHeight,
        config
      );

      const finalizedCandidate = candidate ? this._finalizeCandidate(candidate, config) : null;
      if (finalizedCandidate && compareTightCandidates(finalizedCandidate, bestCandidate) < 0) {
        bestCandidate = finalizedCandidate;
      }
    }

    return bestCandidate;
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = {
      ...this.config,
      ...overrideConfig,
      capacityLayoutMode: 'same-side-prepaired-tight',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate180: true,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true,
      sameSideFineRotateOffsets: [0],
      sameSideAlignedRowShiftRatios: [0]
    };

    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    if (shouldUseParallelPrePairedCapacity(normalizedSizeList, config)) {
      return this._testCapacityParallel(normalizedSizeList, config);
    }

    return this._testCapacitySequential(normalizedSizeList, config);
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
      const cacheKey = buildCapacityResultCacheKey('same-side-prepaired-tight', size, config);
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
        const summaryItem = buildEmptySummaryItem(size);
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
      const summaryItem = buildSummaryItem(size, sheet);
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
      mode: 'test-capacity-same-side-prepaired-tight',
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
      const cacheKey = buildCapacityResultCacheKey('same-side-prepaired-tight', size, config);
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

    const workerCount = resolveAdaptiveParallelWorkerCount(uncachedTasks.map((task) => task.size), config);
    const orderedTasks = orderTasksByEstimatedWeight(
      uncachedTasks,
      (task) => estimatePrePairedTaskWeight(task.size, task.config)
    );
    const workerResults = orderedTasks.length
      ? await executeTasksInParallel(orderedTasks, workerCount)
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
      mode: 'test-capacity-same-side-prepaired-tight',
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
