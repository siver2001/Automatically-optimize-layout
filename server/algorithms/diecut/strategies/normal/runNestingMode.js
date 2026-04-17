import { NESTING_STRATEGIES, normalizeNestingStrategy } from "./nestingPlanUtils.js";
import { runCapacityDrivenSingleSizeNestingMode } from "./CapacityDrivenSingleSizeNestingMode.js";
import { runCapacityDrivenMixedSizeNestingMode } from "./CapacityDrivenMixedSizeNestingMode.js";
import { runClusterTilingNestingMode } from "./ClusterTilingNestingMode.js";

const CLUSTER_TILING_PAIR_THRESHOLD = 500;

function getTotalPairs(sizeList) {
  return (sizeList || []).reduce((sum, size) => {
    const qty = Math.ceil(Number(size?.quantity ?? size?.pairQuantity ?? 0));
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}

export async function runNestingMode({
  sizeList,
  createNester,
  config,
  metadata = {},
}) {
  const nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);
  const activeSizes = (sizeList || []).filter((size) => {
    const quantity = Math.ceil(Number(size?.quantity ?? size?.pairQuantity ?? 0));
    return Number.isFinite(quantity) && quantity > 0;
  });

  if (nestingStrategy === NESTING_STRATEGIES.MIXED_SIZE) {
    return runCapacityDrivenMixedSizeNestingMode({
      sizeList,
      createNester,
      config,
      metadata,
    });
  }

  const totalPairs = getTotalPairs(activeSizes);
  if (totalPairs >= CLUSTER_TILING_PAIR_THRESHOLD) {
    return runClusterTilingNestingMode({
      sizeList,
      createNester,
      config,
      metadata,
    });
  }

  return runCapacityDrivenSingleSizeNestingMode({
    sizeList,
    createNester,
    config,
    metadata,
  });
}
