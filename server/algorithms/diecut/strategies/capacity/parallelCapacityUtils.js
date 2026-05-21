import os from 'os';

function getTotalMemoryGb() {
  const totalMemory = typeof os.totalmem === 'function' ? os.totalmem() : 0;
  if (!Number.isFinite(totalMemory) || totalMemory <= 0) return 0;
  return totalMemory / (1024 ** 3);
}

export function getLogicalCpuCount() {
  if (typeof os.availableParallelism === 'function') {
    const available = os.availableParallelism();
    if (Number.isFinite(available) && available > 0) {
      return available;
    }
  }

  const fallback = os.cpus()?.length || 1;
  return Math.max(1, fallback);
}

function resolveCpuWorkerCap(logicalCpuCount) {
  if (logicalCpuCount <= 4) return 1;
  if (logicalCpuCount <= 8) return 4;
  if (logicalCpuCount <= 12) return 6;
  if (logicalCpuCount <= 16) return 10;
  if (logicalCpuCount <= 32) return 16;
  return Math.min(32, Math.floor(logicalCpuCount * 0.75));
}

function resolveMemoryWorkerCap(totalMemoryGb) {
  if (totalMemoryGb <= 0) return 4;
  if (totalMemoryGb < 6) return 2;
  if (totalMemoryGb < 10) return 4;
  if (totalMemoryGb < 14) return 8;
  if (totalMemoryGb < 20) return 16;
  if (totalMemoryGb < 30) return 24;
  return Math.min(48, Math.floor(totalMemoryGb * 1.0));
}

export function resolveAdaptiveParallelWorkerCount(sizeList, config = {}) {
  const logicalCpuCount = getLogicalCpuCount();
  const cpuCap = resolveCpuWorkerCap(logicalCpuCount);
  const memoryCap = resolveMemoryWorkerCap(getTotalMemoryGb());
  const hardCap = Math.min(cpuCap, memoryCap);

  if (config.parallelWorkerCount > 0) {
    return Math.min(sizeList.length, Math.max(1, Math.min(config.parallelWorkerCount, hardCap)));
  }

  if (!sizeList?.length) return 0;

  const sizeCap = sizeList.length <= 2
    ? 2
    : sizeList.length <= 4
      ? 4
      : Number.POSITIVE_INFINITY;

  return Math.min(sizeList.length, Math.max(1, Math.min(hardCap, sizeCap)));
}

export function orderTasksByEstimatedWeight(tasks, estimateWeight) {
  if (!Array.isArray(tasks) || tasks.length <= 1) {
    return Array.isArray(tasks) ? [...tasks] : [];
  }

  return [...tasks].sort((leftTask, rightTask) => {
    const leftWeight = Number(estimateWeight(leftTask)) || 0;
    const rightWeight = Number(estimateWeight(rightTask)) || 0;
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }
    return (leftTask.index ?? 0) - (rightTask.index ?? 0);
  });
}
