import { finalizeNestingResult } from './nestingPlanUtils.js';

export async function runOrderedNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const result = await createNester().nest(sizeList, config);
  return finalizeNestingResult(result, config, metadata);
}
