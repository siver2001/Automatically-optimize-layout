import { runCapacityDrivenMixedSizeNestingMode } from './CapacityDrivenMixedSizeNestingMode.js';

export async function runOrderedNestingMode({ sizeList, createNester, config, metadata = {} }) {
  return runCapacityDrivenMixedSizeNestingMode({
    sizeList,
    createNester,
    config: {
      ...config,
      nestingOrderingMode: 'input'
    },
    metadata
  });
}
