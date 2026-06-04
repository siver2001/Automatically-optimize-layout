import { parentPort } from 'worker_threads';
import { CapacityTestSameSidePattern } from '../diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestPrePairedSameSidePattern } from '../diecut/strategies/capacity/CapacityTestPrePairedSameSidePattern.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { CapacityTestDoubleInsoleVerticalPattern } from '../diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleVerticalPattern.js';
import { CapacityTestDoubleInsoleHorizontalPattern } from '../diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleHorizontalPattern.js';
import { clearPatternCapacityCaches } from '../diecut/strategies/capacity/patternCapacityUtils.js';

if (!parentPort) {
  throw new Error('diecutCapacitySameSideWorker requires a parent port');
}

let cachedConfigKey = null;
let cachedAlgorithm = null;

function createAlgorithm(config) {
  if (config?.capacityLayoutMode === 'same-side-double-contour-vertical') {
    return new CapacityTestDoubleInsoleVerticalPattern(config);
  }

  if (config?.capacityLayoutMode === 'same-side-double-contour-horizontal') {
    return new CapacityTestDoubleInsoleHorizontalPattern(config);
  }

  if (config?.sameSidePreparedVariant === 'double-contour' || config?.capacityLayoutMode === 'same-side-double-contour') {
    return new CapacityTestDoubleInsoleDoubleContourPattern(config);
  }

  if (config?.capacityLayoutMode === 'same-side-prepaired-tight') {
    return new CapacityTestPrePairedSameSidePattern(config);
  }

  return new CapacityTestSameSidePattern(config);
}

function getAlgorithm(config) {
  const configKey = JSON.stringify(config);
  if (configKey !== cachedConfigKey || !cachedAlgorithm) {
    cachedConfigKey = configKey;
    cachedAlgorithm = createAlgorithm(config);
  }
  return cachedAlgorithm;
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

parentPort.on('message', async (task) => {
  const { index, size, config } = task;

  try {
    const algorithm = getAlgorithm(config);
    const result = await algorithm.testCapacity([size], {
      ...config,
      parallelSizes: false
    });
    const summaryItem = result.summary?.[0] || buildEmptySummaryItem(size);
    // Include timeMs in summary if present
    if (result.timeMs) summaryItem.timeMs = result.timeMs;

    parentPort.postMessage({
      index,
      payload: {
        summaryItem,
        sheet: result.sheetsBySize?.[size.sizeName] || null
      }
    });
  } catch (error) {
    parentPort.postMessage({
      index,
      error: error?.message || String(error)
    });
  }
});
