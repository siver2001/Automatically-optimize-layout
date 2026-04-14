import { area as polygonArea } from '../../core/polygonUtils.js';

export const NESTING_STRATEGIES = {
  ORDERED: 'ordered',
  MIXED_SIZE: 'mixed-size-area',
  SINGLE_SIZE: 'single-size-per-sheet'
};

export function normalizeLayers(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function normalizeNestingStrategy(value) {
  switch (value) {
    case NESTING_STRATEGIES.MIXED_SIZE:
    case NESTING_STRATEGIES.SINGLE_SIZE:
      return value;
    default:
      return NESTING_STRATEGIES.ORDERED;
  }
}

function toPairQuantity(size) {
  const raw = size?.quantity ?? size?.pairQuantity ?? 0;
  const parsed = Math.ceil(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function applyLayersToSizeList(sizeList = [], layers = 1) {
  const resolvedLayers = normalizeLayers(layers);

  return sizeList.map((size) => {
    const originalPairQuantity = toPairQuantity(size);
    const plannedPairQuantity = Math.ceil(originalPairQuantity / resolvedLayers);

    return {
      ...size,
      quantity: plannedPairQuantity,
      pairQuantity: plannedPairQuantity,
      pieceQuantity: plannedPairQuantity * 2,
      originalPairQuantity,
      originalPieceQuantity: originalPairQuantity * 2,
      plannedPairQuantity,
      plannedPieceQuantity: plannedPairQuantity * 2,
      layers: resolvedLayers
    };
  });
}

export function buildNestingPlanSummary(originalSizeList = [], plannedSizeList = [], config = {}) {
  const layers = normalizeLayers(config.layers);
  const nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);
  const plannedMap = new Map(plannedSizeList.map((size) => [size.sizeName, size]));

  const originalPairs = originalSizeList.reduce((sum, size) => sum + toPairQuantity(size), 0);
  const plannedPairs = plannedSizeList.reduce((sum, size) => sum + toPairQuantity(size), 0);
  const sizes = originalSizeList.map((size) => {
    const planned = plannedMap.get(size.sizeName) || {};
    const originalPairQuantity = toPairQuantity(size);
    const nextPlannedPairs = toPairQuantity(planned);

    return {
      sizeName: size.sizeName,
      originalPairs: originalPairQuantity,
      originalPieces: originalPairQuantity * 2,
      plannedPairs: nextPlannedPairs,
      plannedPieces: nextPlannedPairs * 2
    };
  });

  return {
    layers,
    nestingStrategy,
    originalPairs,
    originalPieces: originalPairs * 2,
    plannedPairs,
    plannedPieces: plannedPairs * 2,
    sizeCount: plannedSizeList.filter((size) => toPairQuantity(size) > 0).length,
    sizes
  };
}

export function sortSizesByDescendingArea(sizeList = []) {
  return [...sizeList].sort((a, b) => {
    const areaDelta = polygonArea(b.polygon) - polygonArea(a.polygon);
    if (Math.abs(areaDelta) > 1e-6) return areaDelta;

    const qtyDelta = toPairQuantity(b) - toPairQuantity(a);
    if (qtyDelta !== 0) return qtyDelta;

    return String(a.sizeName ?? '').localeCompare(String(b.sizeName ?? ''), undefined, { numeric: true });
  });
}

export function finalizeNestingResult(rawResult = {}, config = {}, metadata = {}) {
  const { planningSummary: metadataPlanningSummary, planSummary: metadataPlanSummary, ...restMetadata } = metadata || {};
  const normalizedSheets = (rawResult.sheets || []).map((sheet, index) => ({
    ...sheet,
    sheetIndex: index,
    sheetWidth: sheet.sheetWidth ?? config.sheetWidth,
    sheetHeight: sheet.sheetHeight ?? config.sheetHeight
  }));

  const totalSheets = normalizedSheets.length;
  const placedCount = rawResult.placedCount ?? normalizedSheets.reduce((sum, sheet) => sum + (sheet.placedCount || 0), 0);
  const planSummary = metadata.planningSummary || metadata.planSummary || null;
  const placedBySize = normalizedSheets.reduce((acc, sheet) => {
    for (const item of sheet.placed || []) {
      const sizeName = item?.sizeName || 'Unknown';
      acc[sizeName] = (acc[sizeName] || 0) + (item?.pieceCount || 1);
    }
    return acc;
  }, {});
  const enrichedPlanSummary = planSummary
    ? {
        ...planSummary,
        sizes: (planSummary.sizes || []).map((size) => {
          const placedPieces = placedBySize[size.sizeName] || 0;
          return {
            ...size,
            placedPieces,
            placedPairs: Math.floor(placedPieces / 2)
          };
        })
      }
    : null;
  const totalItems = rawResult.totalItems ?? planSummary?.plannedPieces ?? placedCount;
  const unplacedCount = Math.max(0, totalItems - placedCount);
  const usedArea = normalizedSheets.reduce(
    (sum, sheet) => sum + (
      sheet.usedArea
      ?? (sheet.placed || []).reduce((sheetSum, item) => sheetSum + polygonArea(item.polygon), 0)
    ),
    0
  );
  const totalSheetArea = totalSheets * (config.sheetWidth || 0) * (config.sheetHeight || 0);
  const efficiency = totalSheetArea > 0
    ? parseFloat(((usedArea / totalSheetArea) * 100).toFixed(1))
    : 0;

  return {
    ...rawResult,
    sheets: normalizedSheets,
    totalSheets,
    totalItems,
    placedCount,
    unplacedCount,
    efficiency,
    timeMs: rawResult.timeMs ?? 0,
    planningSummary: enrichedPlanSummary,
    ...restMetadata
  };
}
