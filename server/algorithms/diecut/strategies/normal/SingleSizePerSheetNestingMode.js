import { finalizeNestingResult } from './nestingPlanUtils.js';

export async function runSingleSizePerSheetNestingMode({ sizeList, createNester, config, metadata = {} }) {
  const scopedSizes = sizeList.filter((size) => (size.quantity ?? size.pairQuantity ?? 0) > 0);
  const mergedSheets = [];
  let placedCount = 0;
  let totalItems = 0;
  let timeMs = 0;

  for (const size of scopedSizes) {
    const sizeResult = await createNester().nest([size], config);
    const normalizedSheets = (sizeResult.sheets || []).map((sheet) => ({
      ...sheet,
      sizeScope: size.sizeName
    }));

    mergedSheets.push(...normalizedSheets);
    placedCount += sizeResult.placedCount ?? normalizedSheets.reduce((sum, sheet) => sum + (sheet.placedCount || 0), 0);
    totalItems += sizeResult.totalItems ?? ((size.quantity ?? 0) * 2);
    timeMs += sizeResult.timeMs ?? 0;
  }

  return finalizeNestingResult(
    {
      sheets: mergedSheets,
      placedCount,
      totalItems,
      timeMs
    },
    config,
    metadata
  );
}
