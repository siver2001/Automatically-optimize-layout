import {
  area as polygonArea,
  flipX,
  getBoundingBox,
  normalizeToOrigin,
  rotatePolygon,
  translate
} from '../../core/polygonUtils.js';
import { CapacityTestComplementaryPattern } from '../capacity/CapacityTestComplementaryPattern.js';
import { CapacityTestSameSidePattern } from '../capacity/CapacityTestSameSidePattern.js';
import { finalizeNestingResult, sortSizesByDescendingArea } from './nestingPlanUtils.js';

function toPairQuantity(size) {
  const raw = size?.quantity ?? size?.pairQuantity ?? 0;
  const parsed = Math.ceil(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundMetric(value, digits = 2) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function buildCapacityConfig(config = {}, width, height) {
  const pairingStrategy = config.pairingStrategy === 'same-side' || config.mirrorPairs === false
    ? 'same-side'
    : 'pair';

  return {
    ...config,
    sheetWidth: width,
    sheetHeight: height,
    marginX: 0,
    marginY: 0,
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

function getBasePolygonForFoot(size, foot) {
  if (foot === 'R') return normalizeToOrigin(flipX(size.polygon));
  return normalizeToOrigin(size.polygon);
}

function materializeCapacityItems(size, rect, capacitySheet) {
  return (capacitySheet?.placed || []).map((item) => {
    const basePolygon = getBasePolygonForFoot(size, item.foot);
    const rotated = normalizeToOrigin(rotatePolygon(basePolygon, ((item.angle || 0) * Math.PI) / 180));
    const x = rect.x + (item.x || 0);
    const y = rect.y + (item.y || 0);

    return {
      ...item,
      x: roundMetric(x),
      y: roundMetric(y),
      polygon: translate(rotated, x, y)
    };
  });
}

function computePlacedBounds(placed = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of placed) {
    const bb = getBoundingBox(item.polygon);
    minX = Math.min(minX, bb.minX);
    minY = Math.min(minY, bb.minY);
    maxX = Math.max(maxX, bb.maxX);
    maxY = Math.max(maxY, bb.maxY);
  }

  if (!Number.isFinite(minX)) return null;
  return {
    minX: roundMetric(minX),
    minY: roundMetric(minY),
    maxX: roundMetric(maxX),
    maxY: roundMetric(maxY),
    width: roundMetric(maxX - minX),
    height: roundMetric(maxY - minY)
  };
}

function splitFreeRect(rect, bounds) {
  if (!rect || !bounds) return [];

  const rectMaxX = rect.x + rect.width;
  const rectMaxY = rect.y + rect.height;
  const nextRects = [];

  const rightWidth = rectMaxX - bounds.maxX;
  const rightHeight = Math.max(0, bounds.maxY - rect.y);
  if (rightWidth > 5 && rightHeight > 5) {
    nextRects.push({
      x: bounds.maxX,
      y: rect.y,
      width: rightWidth,
      height: rightHeight
    });
  }

  const bottomHeight = rectMaxY - bounds.maxY;
  if (rect.width > 5 && bottomHeight > 5) {
    nextRects.push({
      x: rect.x,
      y: bounds.maxY,
      width: rect.width,
      height: bottomHeight
    });
  }

  return nextRects.sort((a, b) => (b.width * b.height) - (a.width * a.height));
}

async function getCapacityLayoutForRect(size, rect, config, cache) {
  const rectWidth = Math.max(5, Math.floor(rect.width / 5) * 5);
  const rectHeight = Math.max(5, Math.floor(rect.height / 5) * 5);
  const fullArea = Math.max(1, ((config.sheetWidth || 0) - 2 * (config.marginX || 0)) * ((config.sheetHeight || 0) - 2 * (config.marginY || 0)));
  const areaRatio = (rectWidth * rectHeight) / fullArea;
  const maxTimeMs = areaRatio >= 0.7
    ? Math.min(config.maxTimeMs || 60000, 9000)
    : areaRatio >= 0.35
      ? Math.min(config.maxTimeMs || 60000, 3500)
      : 1500;
  const cacheKey = [
    size.sizeName,
    rectWidth,
    rectHeight,
    config.pairingStrategy,
    config.spacing,
    config.gridStep,
    config.allowRotate90,
    config.allowRotate180,
    maxTimeMs
  ].join('|');

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const capacityConfig = {
    ...buildCapacityConfig(config, rectWidth, rectHeight),
    maxTimeMs
  };
  const nester = createCapacityNester(capacityConfig);
  const result = await nester.testCapacity([size], capacityConfig);
  const sheet = result?.sheetsBySize?.[size.sizeName] || null;
  const materializedPlaced = materializeCapacityItems(size, rect, sheet);
  const bounds = computePlacedBounds(materializedPlaced);
  const response = {
    sheet,
    placedCount: sheet?.placedCount || 0,
    placed: materializedPlaced,
    bounds,
    usedArea: (sheet?.placedCount || 0) * polygonArea(size.polygon)
  };

  cache.set(cacheKey, response);
  return response;
}

function trimPlacementToRemaining(capacityPlacement, remainingPieces) {
  if (!capacityPlacement?.placedCount || remainingPieces <= 0) return null;
  const takeCount = Math.min(remainingPieces, capacityPlacement.placedCount);
  const placed = capacityPlacement.placed.slice(0, takeCount);
  const bounds = computePlacedBounds(placed);
  return {
    placed,
    placedCount: takeCount,
    usedArea: takeCount > 0 && capacityPlacement.placedCount > 0
      ? (capacityPlacement.usedArea / capacityPlacement.placedCount) * takeCount
      : 0,
    bounds
  };
}

function buildSheetResult(sheetIndex, placed, config) {
  const usedArea = placed.reduce((sum, item) => sum + polygonArea(item.polygon), 0);
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);

  return {
    sheetIndex,
    placed,
    placedCount: placed.length,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

export async function runCapacityDrivenMixedSizeNestingMode({
  sizeList,
  createNester,
  config,
  metadata = {}
}) {
  const prioritizedSizes = sortSizesByDescendingArea(sizeList).filter((size) => toPairQuantity(size) > 0);
  const remainingPieces = new Map(prioritizedSizes.map((size) => [size.sizeName, toPairQuantity(size) * 2]));
  const placedSheets = [];
  const capacityCache = new Map();
  const startedAt = Date.now();

  while ([...remainingPieces.values()].some((value) => value > 0)) {
    const sheetPlaced = [];
    const freeRects = [{
      x: config.marginX || 0,
      y: config.marginY || 0,
      width: (config.sheetWidth || 0) - 2 * (config.marginX || 0),
      height: (config.sheetHeight || 0) - 2 * (config.marginY || 0),
      depth: 0
    }];

    let placedSomething = false;

    while (freeRects.length > 0) {
      const rect = freeRects.shift();
      if (!rect || rect.width <= 20 || rect.height <= 20) continue;

      const candidateLimit = 1;
      const candidateSizes = prioritizedSizes
        .filter((size) => (remainingPieces.get(size.sizeName) || 0) > 0)
        .slice(0, candidateLimit);

      let bestCandidate = null;

      for (const size of candidateSizes) {
        const layout = await getCapacityLayoutForRect(size, rect, config, capacityCache);
        const trimmed = trimPlacementToRemaining(layout, remainingPieces.get(size.sizeName) || 0);
        if (!trimmed?.placedCount || !trimmed.bounds) continue;

        const score = trimmed.usedArea - (trimmed.bounds.width * trimmed.bounds.height - trimmed.usedArea) * 0.15;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            size,
            score,
            trimmed
          };
        }
      }

      if (!bestCandidate) continue;

      sheetPlaced.push(...bestCandidate.trimmed.placed);
      remainingPieces.set(
        bestCandidate.size.sizeName,
        Math.max(0, (remainingPieces.get(bestCandidate.size.sizeName) || 0) - bestCandidate.trimmed.placedCount)
      );
      placedSomething = true;

      const nextRects = rect.depth >= 1
        ? []
        : splitFreeRect(rect, bestCandidate.trimmed.bounds).map((nextRect) => ({
          ...nextRect,
          depth: rect.depth + 1
        }));
      freeRects.push(...nextRects);
      freeRects.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    }

    if (!placedSomething) {
      const fallbackResult = await createNester().nest(
        prioritizedSizes
          .filter((size) => (remainingPieces.get(size.sizeName) || 0) > 0)
          .map((size) => ({
            ...size,
            quantity: Math.ceil((remainingPieces.get(size.sizeName) || 0) / 2)
          })),
        config
      );

      const fallbackSheet = fallbackResult.sheets?.[0];
      if (!fallbackSheet?.placed?.length) break;

      placedSheets.push({
        ...fallbackSheet,
        sheetIndex: placedSheets.length
      });

      for (const item of fallbackSheet.placed || []) {
        remainingPieces.set(item.sizeName, Math.max(0, (remainingPieces.get(item.sizeName) || 0) - 1));
      }
      continue;
    }

    placedSheets.push(buildSheetResult(placedSheets.length, sheetPlaced, config));
  }

  const totalItems = prioritizedSizes.reduce((sum, size) => sum + toPairQuantity(size) * 2, 0);
  const placedCount = placedSheets.reduce((sum, sheet) => sum + (sheet.placedCount || 0), 0);

  return finalizeNestingResult(
    {
      sheets: placedSheets,
      totalItems,
      placedCount,
      timeMs: Date.now() - startedAt
    },
    config,
    metadata
  );
}
