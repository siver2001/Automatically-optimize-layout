import { NESTING_STRATEGIES, normalizeNestingStrategy } from './nestingPlanUtils.js';
import { runOrderedNestingMode } from './OrderedNestingMode.js';
import { runMixedSizeAreaNestingMode } from './MixedSizeAreaNestingMode.js';
import { runCapacityDrivenSingleSizeNestingMode } from './CapacityDrivenSingleSizeNestingMode.js';
import { runCapacityDrivenMixedSizeNestingMode } from './CapacityDrivenMixedSizeNestingMode.js';

export async function runNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);
  const activeSizes = (sizeList || []).filter((size) => {
    const quantity = Math.ceil(Number(size?.quantity ?? size?.pairQuantity ?? 0));
    return Number.isFinite(quantity) && quantity > 0;
  });

  if (nestingStrategy === NESTING_STRATEGIES.SINGLE_SIZE) {
    return runCapacityDrivenSingleSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  if (activeSizes.length === 1) {
    return runCapacityDrivenSingleSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  if (nestingStrategy === NESTING_STRATEGIES.MIXED_SIZE) {
    return runCapacityDrivenMixedSizeNestingMode({ sizeList, createNester, config, metadata });
  }

  return runOrderedNestingMode({ sizeList, createNester, config, metadata });
}
