import { area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestComplementaryPattern } from '../capacity/CapacityTestComplementaryPattern.js';
import { CapacityTestSameSidePattern } from '../capacity/CapacityTestSameSidePattern.js';
import { finalizeNestingResult } from './nestingPlanUtils.js';

function toPairQuantity(size) {
  const raw = size?.quantity ?? size?.pairQuantity ?? 0;
  const parsed = Math.ceil(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildCapacityConfig(config = {}) {
  const pairingStrategy = config.pairingStrategy === 'same-side' || config.mirrorPairs === false
    ? 'same-side'
    : 'pair';

  return {
    ...config,
    mirrorPairs: pairingStrategy !== 'same-side',
    pairingStrategy,
    capacityLayoutMode: pairingStrategy === 'same-side' ? 'same-side-banded' : 'pair-complementary',
    parallelSizes: false,
    maxTimeMs: config.maxTimeMs || 60000
  };
}

function createCapacityNester(config = {}) {
  if (config.pairingStrategy === 'same-side' || config.mirrorPairs === false) {
    return new CapacityTestSameSidePattern({
      ...config,
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      capacityLayoutMode: 'same-side-banded'
    });
  }

  return new CapacityTestComplementaryPattern({
    ...config,
    pairingStrategy: 'pair',
    mirrorPairs: true,
    capacityLayoutMode: 'pair-complementary'
  });
}

function trimSheet(sheet, targetPlacedCount, pieceArea, config, sheetIndex) {
  const nextPlaced = (sheet?.placed || []).slice(0, targetPlacedCount);
  const usedArea = targetPlacedCount * Math.max(0, pieceArea || 0);
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);

  return {
    ...sheet,
    sheetIndex,
    placed: nextPlaced,
    placedCount: nextPlaced.length,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

async function buildCapacitySheet(size, config) {
  const nester = createCapacityNester(config);
  const result = await nester.testCapacity([size], config);
  return result?.sheetsBySize?.[size.sizeName] || null;
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

  for (const size of scopedSizes) {
    const totalPiecesForSize = toPairQuantity(size) * 2;
    totalItems += totalPiecesForSize;

    let remainingPieces = totalPiecesForSize;
    const startedAt = Date.now();
    const capacitySheet = await buildCapacitySheet(size, capacityConfig);

    if (capacitySheet?.placedCount) {
      const pieceArea = polygonArea(size.polygon);
      while (remainingPieces > 0) {
        const takeCount = Math.min(remainingPieces, capacitySheet.placedCount);
        mergedSheets.push(trimSheet(capacitySheet, takeCount, pieceArea, config, nextSheetIndex));
        placedCount += takeCount;
        remainingPieces -= takeCount;
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
