import { NESTING_STRATEGIES, normalizeNestingStrategy } from './nestingPlanUtils.js';
import { runOrderedNestingMode } from './OrderedNestingMode.js';
import { runMixedSizeAreaNestingMode } from './MixedSizeAreaNestingMode.js';
import { runCapacityDrivenSingleSizeNestingMode } from './CapacityDrivenSingleSizeNestingMode.js';
import { runCapacityDrivenMixedSizeNestingMode } from './CapacityDrivenMixedSizeNestingMode.js';
import { runClusterTilingNestingMode } from './ClusterTilingNestingMode.js';

// Ngưỡng tổng số đôi để tự động kích hoạt Cluster-Tiling
// Với số đôi >= 500, Cluster-Tiling cho tốc độ vượt trội
const CLUSTER_TILING_PAIR_THRESHOLD = 500;

function getTotalPairs(sizeList) {
  return (sizeList || []).reduce((sum, size) => {
    const qty = Math.ceil(Number(size?.quantity ?? size?.pairQuantity ?? 0));
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}

export async function runNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);
  const activeSizes = (sizeList || []).filter((size) => {
    const quantity = Math.ceil(Number(size?.quantity ?? size?.pairQuantity ?? 0));
    return Number.isFinite(quantity) && quantity > 0;
  });

  if (nestingStrategy === NESTING_STRATEGIES.SINGLE_SIZE) {
    // Với single-size-per-sheet VÀ số lượng lớn → dùng Cluster-Tiling
    const totalPairs = getTotalPairs(activeSizes);
    if (totalPairs >= CLUSTER_TILING_PAIR_THRESHOLD) {
      return runClusterTilingNestingMode({ sizeList, createNester, config, metadata });
    }
    return runCapacityDrivenSingleSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  if (activeSizes.length === 1) {
    // Nếu chỉ còn 1 size → coi như single-size, dùng Cluster-Tiling nếu đủ lớn
    const totalPairs = getTotalPairs(activeSizes);
    if (totalPairs >= CLUSTER_TILING_PAIR_THRESHOLD) {
      return runClusterTilingNestingMode({ sizeList, createNester, config, metadata });
    }
    return runCapacityDrivenSingleSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  if (nestingStrategy === NESTING_STRATEGIES.MIXED_SIZE) {
    return runCapacityDrivenMixedSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  // Ordered nesting (default) — cũng dùng Cluster-Tiling nếu số lượng khủng
  const totalPairs = getTotalPairs(activeSizes);
  if (totalPairs >= CLUSTER_TILING_PAIR_THRESHOLD) {
    return runClusterTilingNestingMode({ sizeList, createNester, config, metadata });
  }

  return runOrderedNestingMode({ sizeList, createNester, config, metadata });
}
