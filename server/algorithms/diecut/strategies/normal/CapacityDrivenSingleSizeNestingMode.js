import { area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestComplementaryPattern } from '../capacity/CapacityTestComplementaryPattern.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { CapacityTestSameSidePattern } from '../capacity/CapacityTestSameSidePattern.js';
import { finalizeNestingResult } from './nestingPlanUtils.js';

function toPairQuantity(size) {
  const raw = size?.quantity ?? size?.pairQuantity ?? 0;
  const parsed = Math.ceil(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveSameSideCapacityLayoutMode(config = {}) {
  return config.capacityLayoutMode === 'same-side-double-contour'
    || config.sameSidePreparedVariant === 'double-contour'
    ? 'same-side-double-contour'
    : 'same-side-banded';
}

function buildCapacityConfig(config = {}) {
  const pairingStrategy = config.pairingStrategy === 'same-side' || config.mirrorPairs === false
    ? 'same-side'
    : 'pair';

  return {
    ...config,
    mirrorPairs: pairingStrategy !== 'same-side',
    pairingStrategy,
    capacityLayoutMode: pairingStrategy === 'same-side'
      ? resolveSameSideCapacityLayoutMode(config)
      : 'pair-complementary',
    parallelSizes: false,
    maxTimeMs: config.maxTimeMs || 60000
  };
}

function createCapacityNester(config = {}) {
  if (config.pairingStrategy === 'same-side' || config.mirrorPairs === false) {
    const sameSideMode = resolveSameSideCapacityLayoutMode(config);
    if (sameSideMode === 'same-side-double-contour') {
      return new CapacityTestDoubleInsoleDoubleContourPattern({
        ...config,
        pairingStrategy: 'same-side',
        mirrorPairs: false,
        capacityLayoutMode: sameSideMode
      });
    }

    return new CapacityTestSameSidePattern({
      ...config,
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      capacityLayoutMode: sameSideMode
    });
  }

  return new CapacityTestComplementaryPattern({
    ...config,
    pairingStrategy: 'pair',
    mirrorPairs: true,
    capacityLayoutMode: 'pair-complementary'
  });
}

function createFullSheet(sheet, pieceArea, config, sheetIndex, sizeName) {
  const placedCount = sheet?.placedCount || 0;
  const usedArea = sheet?.usedArea
    ?? (sheet?.placed || []).reduce((sum, item) => sum + Math.max(0, item?.areaMm2 || pieceArea || 0), 0);
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);

  return {
    ...sheet,
    sheetIndex,
    sizeScope: sizeName,
    placed: sheet?.placed || [],
    placedCount,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

function trimSheet(sheet, targetPlacedCount, pieceArea, config, sheetIndex, sizeName) {
  const nextPlaced = (sheet?.placed || []).slice(0, targetPlacedCount);
  const usedArea = nextPlaced.reduce((sum, item) => sum + Math.max(0, item?.areaMm2 || pieceArea || 0), 0);
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);

  return {
    ...sheet,
    sheetIndex,
    sizeScope: sizeName,
    placed: nextPlaced,
    placedCount: nextPlaced.length,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

async function buildCapacitySheetMap(sizeList, config) {
  if (!sizeList.length) {
    return new Map();
  }

  const batchConfig = {
    ...config,
    parallelSizes: sizeList.length > 1
  };
  const nester = createCapacityNester(batchConfig);
  const result = await nester.testCapacity(sizeList, batchConfig);
  const sheetMap = new Map();

  for (const size of sizeList) {
    sheetMap.set(size.sizeName, result?.sheetsBySize?.[size.sizeName] || null);
  }

  return sheetMap;
}

export async function runCapacityDrivenSingleSizeNestingMode({
  sizeList,
  createNester,
  config,
  metadata = {}
}) {
  const scopedSizes = sizeList.filter((size) => toPairQuantity(size) > 0);
  const mergedSheets = [];
  let placedCount = 0;
  let totalItems = 0;
  let timeMs = 0;
  let nextSheetIndex = 0;
  const capacityConfig = buildCapacityConfig(config);
  const capacityStartedAt = Date.now();
  const capacitySheetMap = await buildCapacitySheetMap(scopedSizes, capacityConfig);
  timeMs += Date.now() - capacityStartedAt;

  for (const size of scopedSizes) {
    const totalPiecesForSize = toPairQuantity(size) * 2;
    totalItems += totalPiecesForSize;

    const startedAt = Date.now();
    const capacitySheet = capacitySheetMap.get(size.sizeName);

    if (capacitySheet?.placedCount) {
      const pieceArea = polygonArea(size.polygon);
      const fullSheetCount = Math.floor(totalPiecesForSize / capacitySheet.placedCount);
      const remainderPieces = totalPiecesForSize % capacitySheet.placedCount;

      for (let index = 0; index < fullSheetCount; index++) {
        mergedSheets.push(createFullSheet(capacitySheet, pieceArea, config, nextSheetIndex, size.sizeName));
        placedCount += capacitySheet.placedCount;
        nextSheetIndex += 1;
      }

      if (remainderPieces > 0) {
        mergedSheets.push(trimSheet(capacitySheet, remainderPieces, pieceArea, config, nextSheetIndex, size.sizeName));
        placedCount += remainderPieces;
        nextSheetIndex += 1;
      }

      timeMs += Date.now() - startedAt;
      continue;
    }

    const fallbackResult = await createNester().nest([size], config);
    const normalizedSheets = (fallbackResult.sheets || []).map((sheet) => ({
      ...sheet,
      sheetIndex: nextSheetIndex++,
      sizeScope: size.sizeName
    }));

    mergedSheets.push(...normalizedSheets);
    placedCount += fallbackResult.placedCount
      ?? normalizedSheets.reduce((sum, sheet) => sum + (sheet.placedCount || 0), 0);
    timeMs += (Date.now() - startedAt) + (fallbackResult.timeMs || 0);
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
