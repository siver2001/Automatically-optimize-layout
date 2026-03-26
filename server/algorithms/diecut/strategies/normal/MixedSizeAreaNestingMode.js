import { finalizeNestingResult, sortSizesByDescendingArea } from './nestingPlanUtils.js';

export async function runMixedSizeAreaNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const prioritizedSizes = sortSizesByDescendingArea(sizeList);
  const result = await createNester().nest(prioritizedSizes, config);
  return finalizeNestingResult(result, config, metadata);
}
