import { NESTING_STRATEGIES, normalizeNestingStrategy } from './nestingPlanUtils.js';
import { runOrderedNestingMode } from './OrderedNestingMode.js';
import { runMixedSizeAreaNestingMode } from './MixedSizeAreaNestingMode.js';
import { runSingleSizePerSheetNestingMode } from './SingleSizePerSheetNestingMode.js';

export async function runNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);

  if (nestingStrategy === NESTING_STRATEGIES.MIXED_SIZE) {
    return runMixedSizeAreaNestingMode({ sizeList, createNester, config, metadata });
  }

  if (nestingStrategy === NESTING_STRATEGIES.SINGLE_SIZE) {
    return runSingleSizePerSheetNestingMode({ sizeList, createNester, config, metadata });
  }

  return runOrderedNestingMode({ sizeList, createNester, config, metadata });
}
