import { parentPort } from 'worker_threads';
import { CapacityTestSameSidePattern } from '../diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestPrePairedSameSidePattern } from '../diecut/strategies/capacity/CapacityTestPrePairedSameSidePattern.js';

if (!parentPort) {
  throw new Error('diecutCapacitySameSideWorker requires a parent port');
}

let cachedConfigKey = null;
let cachedAlgorithm = null;

function getAlgorithm(config) {
  const configKey = JSON.stringify(config);
  if (configKey !== cachedConfigKey || !cachedAlgorithm) {
    cachedConfigKey = configKey;
    cachedAlgorithm = config?.capacityLayoutMode === 'same-side-prepaired-tight'
      ? new CapacityTestPrePairedSameSidePattern(config)
      : new CapacityTestSameSidePattern(config);
  }
  return cachedAlgorithm;
}

parentPort.on('message', async (task) => {
  const { index, size, config } = task;

  try {
    const algorithm = getAlgorithm(config);
    const result = await algorithm.testCapacity([size], {
      ...config,
      parallelSizes: false
    });
    const summaryItem = result.summary?.[0] || {
      sizeName: size.sizeName,
      sizeValue: size.sizeValue,
      totalPieces: 0,
      pairs: 0,
      placedCount: 0,
      efficiency: 0
    };

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
