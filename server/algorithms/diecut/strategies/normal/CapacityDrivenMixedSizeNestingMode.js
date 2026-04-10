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
import { cachedPolygonsOverlap } from '../capacity/patternCapacityUtils.js';
import { finalizeNestingResult, sortSizesByDescendingArea } from './nestingPlanUtils.js';

const MIN_FREE_RECT_SIZE = 20;
const MAX_FREE_RECT_DEPTH = 9;
const MIN_BATCH_FULL_SHEETS = 4;
const RESERVED_FULL_SHEETS_FOR_MIXING = 2;
const MAX_SALVAGE_RECTS = 3;
const MAX_SALVAGE_SIZE_CANDIDATES = 4;
const MAX_SALVAGE_INSERTIONS = 2;

function toPairQuantity(size) {
  const raw = size?.quantity ?? size?.pairQuantity ?? 0;
  const parsed = Math.ceil(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundMetric(value, digits = 2) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function getRectArea(rect) {
  return Math.max(0, rect?.width || 0) * Math.max(0, rect?.height || 0);
}

function resolveMixedBehavior(config = {}) {
  return {
    minBatchFullSheets: MIN_BATCH_FULL_SHEETS,
    reservedFullSheetsForMixing: RESERVED_FULL_SHEETS_FOR_MIXING,
    candidateBoost: 0,
    salvageRects: MAX_SALVAGE_RECTS,
    salvageCandidateSizes: MAX_SALVAGE_SIZE_CANDIDATES,
    salvageInsertions: MAX_SALVAGE_INSERTIONS,
    salvageMinArea: 30000,
    salvageEfficiencyThreshold: 86,
    salvageFreeAreaThreshold: 45000,
    stripFillWeight: 10000,
    lookaheadWeight: 0.55,
    fragmentationPenaltyWeight: 0.05,
    emptyBoundsPenaltyWeight: 0.05,
    irregular: true,
    orderingMode: config.nestingOrderingMode === 'input' ? 'input' : 'area'
  };
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

function comparePlacedTopLeft(a, b) {
  return a.y - b.y
    || a.x - b.x
    || String(a.sizeName || '').localeCompare(String(b.sizeName || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function groupPlacedRows(placed = []) {
  const sorted = [...placed].sort(comparePlacedTopLeft);
  const rows = [];
  for (const item of sorted) {
    const y = Number(item.y.toFixed(2));
    const lastRow = rows[rows.length - 1];
    if (!lastRow || Math.abs(lastRow.y - y) > 1) {
      rows.push({ y, items: [item] });
    } else {
      lastRow.items.push(item);
    }
  }
  return rows;
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

function getUsableSheetRect(config = {}) {
  return {
    x: config.marginX || 0,
    y: config.marginY || 0,
    width: (config.sheetWidth || 0) - 2 * (config.marginX || 0),
    height: (config.sheetHeight || 0) - 2 * (config.marginY || 0)
  };
}

async function buildFullSheetTemplate(size, config, cache) {
  const usableWidth = Math.max(5, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(5, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const cacheKey = [
    'template',
    size.sizeName,
    usableWidth,
    usableHeight,
    config.pairingStrategy,
    config.spacing,
    config.gridStep,
    config.allowRotate90,
    config.allowRotate180
  ].join('|');

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const capacityConfig = buildCapacityConfig(config, usableWidth, usableHeight);
  const nester = createCapacityNester(capacityConfig);
  const result = await nester.testCapacity([size], capacityConfig);
  const sheet = result?.sheetsBySize?.[size.sizeName] || null;
  const materializedPlaced = materializeCapacityItems(size, { x: 0, y: 0 }, sheet).sort(comparePlacedTopLeft);
  const response = {
    sheet,
    placedCount: sheet?.placedCount || 0,
    placed: materializedPlaced,
    bounds: computePlacedBounds(materializedPlaced),
    usedArea: (sheet?.placedCount || 0) * polygonArea(size.polygon)
  };

  cache.set(cacheKey, response);
  return response;
}

async function buildFullSheetTemplateMap(sizeList, config, cache) {
  const usableWidth = Math.max(5, (config.sheetWidth || 0) - 2 * (config.marginX || 0));
  const usableHeight = Math.max(5, (config.sheetHeight || 0) - 2 * (config.marginY || 0));
  const capacityConfig = {
    ...buildCapacityConfig(config, usableWidth, usableHeight),
    parallelSizes: true
  };
  const uncachedSizes = sizeList.filter((size) => {
    const cacheKey = [
      'template',
      size.sizeName,
      usableWidth,
      usableHeight,
      config.pairingStrategy,
      config.spacing,
      config.gridStep,
      config.allowRotate90,
      config.allowRotate180
    ].join('|');
    return !cache.has(cacheKey);
  });

  if (uncachedSizes.length) {
    const nester = createCapacityNester(capacityConfig);
    const result = await nester.testCapacity(uncachedSizes, capacityConfig);
    for (const size of uncachedSizes) {
      const sheet = result?.sheetsBySize?.[size.sizeName] || null;
      const materializedPlaced = materializeCapacityItems(size, { x: 0, y: 0 }, sheet).sort(comparePlacedTopLeft);
      const response = {
        sheet,
        placedCount: sheet?.placedCount || 0,
        placed: materializedPlaced,
        bounds: computePlacedBounds(materializedPlaced),
        usedArea: (sheet?.placedCount || 0) * polygonArea(size.polygon)
      };
      const cacheKey = [
        'template',
        size.sizeName,
        usableWidth,
        usableHeight,
        config.pairingStrategy,
        config.spacing,
        config.gridStep,
        config.allowRotate90,
        config.allowRotate180
      ].join('|');
      cache.set(cacheKey, response);
    }
  }

  const map = new Map();
  for (const size of sizeList) {
    map.set(size.sizeName, await buildFullSheetTemplate(size, config, cache));
  }
  return map;
}

function cropTemplateToRect(template, rect) {
  if (!template?.placedCount) {
    return {
      sheet: template?.sheet || null,
      placedCount: 0,
      placed: [],
      bounds: null,
      usedArea: 0
    };
  }

  const placed = [];
  for (const item of template.placed || []) {
    const itemBounds = getBoundingBox(item.polygon);
    if (
      itemBounds.minX < -1e-6 ||
      itemBounds.minY < -1e-6 ||
      itemBounds.maxX > rect.width + 1e-6 ||
      itemBounds.maxY > rect.height + 1e-6
    ) {
      continue;
    }

    placed.push({
      ...item,
      x: roundMetric(rect.x + item.x),
      y: roundMetric(rect.y + item.y),
      polygon: translate(item.polygon, rect.x, rect.y)
    });
  }

  return {
    sheet: template.sheet,
    placedCount: placed.length,
    placed,
    bounds: computePlacedBounds(placed),
    usedArea: placed.length > 0 && template.placedCount > 0
      ? (template.usedArea / template.placedCount) * placed.length
      : 0
  };
}

function buildLayoutVariant(layout, placed) {
  const sortedPlaced = [...placed].sort(comparePlacedTopLeft);
  return {
    sheet: layout.sheet,
    placedCount: sortedPlaced.length,
    placed: sortedPlaced,
    bounds: computePlacedBounds(sortedPlaced),
    usedArea: sortedPlaced.length > 0 && layout.placedCount > 0
      ? (layout.usedArea / layout.placedCount) * sortedPlaced.length
      : 0
  };
}

function buildPlacedBandBounds(placed = []) {
  return groupPlacedRows(placed)
    .map((row) => {
      const bounds = computePlacedBounds(row.items);
      return bounds ? { ...bounds, items: row.items } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);
}

function buildLayoutVariants(layout, rect) {
  if (!layout?.placedCount || rect.depth > 0) {
    return layout ? [layout] : [];
  }

  const rows = groupPlacedRows(layout.placed);
  if (rows.length <= 1) {
    return [layout];
  }

  const variants = [layout];
  let cumulative = 0;
  const seenCounts = new Set([layout.placedCount]);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    cumulative += row.items.length;
    const rowEndCount = cumulative;
    if (rowEndCount > 0 && rowEndCount < layout.placedCount && !seenCounts.has(rowEndCount)) {
      variants.push(buildLayoutVariant(layout, layout.placed.slice(0, rowEndCount)));
      seenCounts.add(rowEndCount);
    }

    const removable = Math.min(3, row.items.length - 1);
    for (let removeCount = 1; removeCount <= removable; removeCount++) {
      const nextCount = rowEndCount - removeCount;
      if (nextCount <= 0 || nextCount >= layout.placedCount || seenCounts.has(nextCount)) continue;
      variants.push(buildLayoutVariant(layout, layout.placed.slice(0, nextCount)));
      seenCounts.add(nextCount);
    }
  }

  return variants.filter((variant) => variant?.placedCount > 0 && variant.bounds);
}

function splitFreeRect(rect, bounds, spacing = 0) {
  if (!rect || !bounds) return [];

  const rectMaxX = rect.x + rect.width;
  const rectMaxY = rect.y + rect.height;
  const occupiedMinX = Math.max(rect.x, bounds.minX - spacing);
  const occupiedMinY = Math.max(rect.y, bounds.minY - spacing);
  const occupiedMaxX = Math.min(rectMaxX, bounds.maxX + spacing);
  const occupiedMaxY = Math.min(rectMaxY, bounds.maxY + spacing);
  const centerWidth = Math.max(0, occupiedMaxX - occupiedMinX);
  const nextRects = [];

  const candidates = [
    {
      x: rect.x,
      y: rect.y,
      width: occupiedMinX - rect.x,
      height: rect.height
    },
    {
      x: occupiedMaxX,
      y: rect.y,
      width: rectMaxX - occupiedMaxX,
      height: rect.height
    },
    {
      x: occupiedMinX,
      y: rect.y,
      width: centerWidth,
      height: occupiedMinY - rect.y
    },
    {
      x: occupiedMinX,
      y: occupiedMaxY,
      width: centerWidth,
      height: rectMaxY - occupiedMaxY
    }
  ];

  for (const candidate of candidates) {
    const width = roundMetric(candidate.width);
    const height = roundMetric(candidate.height);
    if (width <= MIN_FREE_RECT_SIZE || height <= MIN_FREE_RECT_SIZE) continue;
    nextRects.push({
      x: roundMetric(candidate.x),
      y: roundMetric(candidate.y),
      width,
      height
    });
  }

  return nextRects;
}

function splitFreeRectByBands(rect, placed, spacing = 0) {
  if (!rect || !placed?.length) return [];

  const bands = buildPlacedBandBounds(placed);
  if (!bands.length) return [];

  const rectMaxX = rect.x + rect.width;
  const rectMaxY = rect.y + rect.height;
  const nextRects = [];
  let cursorY = rect.y;

  for (const band of bands) {
    const bandMinY = Math.max(rect.y, band.minY - spacing);
    const bandMaxY = Math.min(rectMaxY, band.maxY + spacing);
    const bandHeight = bandMaxY - bandMinY;
    if (bandHeight <= MIN_FREE_RECT_SIZE) continue;

    if (bandMinY - cursorY > MIN_FREE_RECT_SIZE) {
      nextRects.push({
        x: rect.x,
        y: cursorY,
        width: rect.width,
        height: bandMinY - cursorY
      });
    }

    const leftWidth = Math.max(0, Math.min(rect.width, band.minX - spacing - rect.x));
    if (leftWidth > MIN_FREE_RECT_SIZE) {
      nextRects.push({
        x: rect.x,
        y: bandMinY,
        width: leftWidth,
        height: bandHeight
      });
    }

    const rightX = Math.max(rect.x, Math.min(rectMaxX, band.maxX + spacing));
    if (rectMaxX - rightX > MIN_FREE_RECT_SIZE) {
      nextRects.push({
        x: rightX,
        y: bandMinY,
        width: rectMaxX - rightX,
        height: bandHeight
      });
    }

    cursorY = Math.max(cursorY, bandMaxY);
  }

  if (rectMaxY - cursorY > MIN_FREE_RECT_SIZE) {
    nextRects.push({
      x: rect.x,
      y: cursorY,
      width: rect.width,
      height: rectMaxY - cursorY
    });
  }

  return normalizeFreeRects(nextRects);
}

function rectContainsRect(outer, inner) {
  return outer.x <= inner.x + 1e-6
    && outer.y <= inner.y + 1e-6
    && outer.x + outer.width >= inner.x + inner.width - 1e-6
    && outer.y + outer.height >= inner.y + inner.height - 1e-6;
}

function normalizeFreeRects(rects = []) {
  const filtered = rects
    .filter((rect) => rect && rect.width > MIN_FREE_RECT_SIZE && rect.height > MIN_FREE_RECT_SIZE)
    .map((rect) => ({
      ...rect,
      x: roundMetric(rect.x),
      y: roundMetric(rect.y),
      width: roundMetric(rect.width),
      height: roundMetric(rect.height)
    }));

  filtered.sort((a, b) =>
    a.y - b.y
    || a.x - b.x
    || getRectArea(b) - getRectArea(a)
  );

  const result = [];
  for (const rect of filtered) {
    if (result.some((existing) => rectContainsRect(existing, rect))) {
      continue;
    }
    for (let index = result.length - 1; index >= 0; index--) {
      if (rectContainsRect(rect, result[index])) {
        result.splice(index, 1);
      }
    }
    result.push(rect);
  }

  return result;
}

function compareFreeRects(a, b) {
  return a.y - b.y
    || a.x - b.x
    || getRectArea(b) - getRectArea(a)
    || (a.depth || 0) - (b.depth || 0);
}

function canSizePotentiallyFit(size, rect, config) {
  const bb = getBoundingBox(size?.polygon || []);
  if (!Number.isFinite(bb?.width) || !Number.isFinite(bb?.height)) return false;
  const fitsNormal = bb.width <= rect.width + 1e-6 && bb.height <= rect.height + 1e-6;
  const fitsRotated = config.allowRotate90 !== false
    && bb.height <= rect.width + 1e-6
    && bb.width <= rect.height + 1e-6;
  return fitsNormal || fitsRotated;
}

function buildSalvageCandidateSizes(prioritizedSizes, remainingPieces, rect, config) {
  const fitSizes = prioritizedSizes
    .filter((size) => (remainingPieces.get(size.sizeName) || 0) > 0)
    .filter((size) => canSizePotentiallyFit(size, rect, config))
    .map((size) => {
      const pieceArea = Math.max(1, polygonArea(size.polygon));
      const rectArea = Math.max(1, getRectArea(rect));
      return {
        size,
        pieceArea,
        fitRatio: pieceArea / rectArea,
        remaining: remainingPieces.get(size.sizeName) || 0
      };
    });

  const selected = [];
  const seen = new Set();
  const pushEntry = (entry) => {
    if (!entry || seen.has(entry.size.sizeName)) return;
    seen.add(entry.size.sizeName);
    selected.push(entry.size);
  };

  for (const entry of [...fitSizes].sort((left, right) =>
    left.pieceArea - right.pieceArea || right.remaining - left.remaining
  )) {
    pushEntry(entry);
    if (selected.length >= MAX_SALVAGE_SIZE_CANDIDATES) break;
  }

  return selected;
}

function isStripLikeRect(rect) {
  return rect.width <= 260 || rect.height <= 260;
}

function resolveCandidateLimit(rect, activeCount, behavior) {
  const area = getRectArea(rect);
  if (area >= 700000) return Math.min(activeCount, 6 + behavior.candidateBoost);
  if (area >= 250000) return Math.min(activeCount, 8 + behavior.candidateBoost);
  return Math.min(activeCount, 12 + behavior.candidateBoost);
}

function buildCandidateSizes(prioritizedSizes, remainingPieces, rect, config, behavior) {
  const rectArea = Math.max(1, getRectArea(rect));
  const orderedEntries = prioritizedSizes
    .filter((size) => (remainingPieces.get(size.sizeName) || 0) > 0)
    .filter((size) => canSizePotentiallyFit(size, rect, config))
    .map((size) => {
      const pieceArea = Math.max(1, polygonArea(size.polygon));
      const remaining = remainingPieces.get(size.sizeName) || 0;
      const estimatedPieces = Math.max(1, Math.floor(rectArea / pieceArea));
      const estimatedUseArea = Math.min(remaining, estimatedPieces) * pieceArea;
      return {
        size,
        estimatedUseArea,
        pieceArea,
        remaining
      };
    });

  const available = behavior.orderingMode === 'input'
    ? orderedEntries
    : orderedEntries.sort((left, right) =>
        right.estimatedUseArea - left.estimatedUseArea
        || right.remaining - left.remaining
        || right.pieceArea - left.pieceArea
      );

  if (available.length <= 1) {
    return available.map((entry) => entry.size);
  }

  const limit = resolveCandidateLimit(rect, available.length, behavior);
  const selected = [];
  const seen = new Set();
  const pushEntry = (entry) => {
    if (!entry || seen.has(entry.size.sizeName)) return;
    seen.add(entry.size.sizeName);
    selected.push(entry.size);
  };

  for (const entry of available.slice(0, limit)) {
    pushEntry(entry);
  }

  const narrowStrip = rect.width <= 180 || rect.height <= 180;
  if (narrowStrip && behavior.orderingMode !== 'input') {
    for (const entry of [...available].sort((left, right) => left.pieceArea - right.pieceArea)) {
      pushEntry(entry);
      if (selected.length >= Math.max(limit + 2 + behavior.candidateBoost, 8 + behavior.candidateBoost)) break;
    }
  }

  return selected;
}

async function getCapacityLayoutForRect(size, rect, config, cache) {
  const rectWidth = Math.max(5, Math.floor(rect.width / 5) * 5);
  const rectHeight = Math.max(5, Math.floor(rect.height / 5) * 5);
  const fullArea = Math.max(1, ((config.sheetWidth || 0) - 2 * (config.marginX || 0)) * ((config.sheetHeight || 0) - 2 * (config.marginY || 0)));
  const areaRatio = (rectWidth * rectHeight) / fullArea;
  const cacheKey = [
    size.sizeName,
    rectWidth,
    rectHeight,
    rect.depth || 0,
    config.pairingStrategy,
    config.spacing,
    config.gridStep,
    config.allowRotate90,
    config.allowRotate180
  ].join('|');

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const template = await buildFullSheetTemplate(size, config, cache);
  let response = cropTemplateToRect(template, rect);

  if (!response.placedCount && areaRatio >= 0.15) {
    const maxTimeMs = areaRatio >= 0.7
      ? Math.min(config.maxTimeMs || 60000, 9000)
      : Math.min(config.maxTimeMs || 60000, 3500);
    const capacityConfig = {
      ...buildCapacityConfig(config, rectWidth, rectHeight),
      maxTimeMs
    };
    const nester = createCapacityNester(capacityConfig);
    const result = await nester.testCapacity([size], capacityConfig);
    const sheet = result?.sheetsBySize?.[size.sizeName] || null;
    const materializedPlaced = materializeCapacityItems(size, rect, sheet).sort(comparePlacedTopLeft);
    response = {
      sheet,
      placedCount: sheet?.placedCount || 0,
      placed: materializedPlaced,
      bounds: computePlacedBounds(materializedPlaced),
      usedArea: (sheet?.placedCount || 0) * polygonArea(size.polygon)
    };
  }

  cache.set(cacheKey, response);
  return response;
}

async function getExactCapacityLayoutForRect(size, rect, config, cache) {
  const rectWidth = Math.max(5, Math.floor(rect.width / 5) * 5);
  const rectHeight = Math.max(5, Math.floor(rect.height / 5) * 5);
  const cacheKey = [
    'exact',
    size.sizeName,
    rectWidth,
    rectHeight,
    config.pairingStrategy,
    config.spacing,
    config.gridStep,
    config.allowRotate90,
    config.allowRotate180
  ].join('|');

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const capacityConfig = {
    ...buildCapacityConfig(config, rectWidth, rectHeight),
    maxTimeMs: Math.min(config.maxTimeMs || 60000, 2200)
  };
  const nester = createCapacityNester(capacityConfig);
  const result = await nester.testCapacity([size], capacityConfig);
  const sheet = result?.sheetsBySize?.[size.sizeName] || null;
  const materializedPlaced = materializeCapacityItems(size, rect, sheet).sort(comparePlacedTopLeft);
  const response = {
    sheet,
    placedCount: sheet?.placedCount || 0,
    placed: materializedPlaced,
    bounds: computePlacedBounds(materializedPlaced),
    usedArea: (sheet?.placedCount || 0) * polygonArea(size.polygon)
  };

  cache.set(cacheKey, response);
  return response;
}

function trimPlacementToRemaining(capacityPlacement, remainingPieces) {
  if (!capacityPlacement?.placedCount || remainingPieces <= 0) return null;
  const takeCount = Math.min(remainingPieces, capacityPlacement.placedCount);
  const sortedPlaced = [...capacityPlacement.placed].sort(comparePlacedTopLeft);

  let placed = sortedPlaced.slice(0, takeCount);
  if (takeCount < sortedPlaced.length) {
    const rows = groupPlacedRows(sortedPlaced);
    const candidates = [placed];
    let consumed = 0;
    for (const row of rows) {
      const rowItems = [...row.items].sort((a, b) => a.x - b.x || a.y - b.y);
      if (consumed + rowItems.length < takeCount) {
        consumed += rowItems.length;
        continue;
      }

      const neededFromRow = Math.max(0, takeCount - consumed);
      const prefixRows = sortedPlaced
        .filter((item) => item.y < rowItems[0].y - 1 || (Math.abs(item.y - rowItems[0].y) <= 1 && item.x < rowItems[0].x));
      if (neededFromRow > 0 && neededFromRow <= rowItems.length) {
        candidates.push([...prefixRows, ...rowItems.slice(0, neededFromRow)].sort(comparePlacedTopLeft));
      }
      break;
    }

    placed = candidates
      .map((candidatePlaced) => ({
        placed: candidatePlaced,
        bounds: computePlacedBounds(candidatePlaced)
      }))
      .filter((entry) => entry.bounds)
      .sort((left, right) =>
        (left.bounds.width * left.bounds.height - left.placed.length) - (right.bounds.width * right.bounds.height - right.placed.length)
        || left.bounds.maxY - right.bounds.maxY
        || left.bounds.maxX - right.bounds.maxX
      )[0]?.placed || placed;
  }

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

function shiftPlacedCluster(placed = [], dx = 0, dy = 0) {
  if ((!dx && !dy) || !placed.length) return placed;
  return placed.map((item) => ({
    ...item,
    x: roundMetric(item.x + dx),
    y: roundMetric(item.y + dy),
    polygon: translate(item.polygon, dx, dy)
  }));
}

function snapPlacedClusterToRect(placed, rect) {
  if (!placed?.length) return null;
  const bounds = computePlacedBounds(placed);
  if (!bounds) return null;
  const dx = roundMetric(rect.x - bounds.minX);
  const dy = roundMetric(rect.y - bounds.minY);
  const snapped = shiftPlacedCluster(placed, dx, dy);
  const snappedBounds = computePlacedBounds(snapped);
  if (!snappedBounds) return null;
  if (
    snappedBounds.minX < rect.x - 1e-6 ||
    snappedBounds.minY < rect.y - 1e-6 ||
    snappedBounds.maxX > rect.x + rect.width + 1e-6 ||
    snappedBounds.maxY > rect.y + rect.height + 1e-6
  ) {
    return null;
  }
  return {
    placed: snapped,
    bounds: snappedBounds
  };
}

function buildNearbyExistingPlacements(existingPlacedIndex, bounds, spacing = 0) {
  if (!existingPlacedIndex?.length || !bounds) return [];
  const expandedBounds = {
    minX: bounds.minX - spacing,
    minY: bounds.minY - spacing,
    maxX: bounds.maxX + spacing,
    maxY: bounds.maxY + spacing
  };

  return existingPlacedIndex
    .filter(({ bb }) => !(
      bb.maxX < expandedBounds.minX ||
      bb.minX > expandedBounds.maxX ||
      bb.maxY < expandedBounds.minY ||
      bb.minY > expandedBounds.maxY
    ));
}

function hasCrossSizeNeighbor(existingPlacedIndex, bounds, sizeName, spacing = 0) {
  return buildNearbyExistingPlacements(existingPlacedIndex, bounds, spacing)
    .some(({ item }) => item.sizeName !== sizeName);
}

function isClusterSafeAgainstExisting(placed, existingPlacedIndex, spacing = 0) {
  if (!placed?.length) return false;
  if (!existingPlacedIndex?.length) return true;

  const candidateEntries = placed.map((item) => ({
    item,
    bb: getBoundingBox(item.polygon)
  }));
  const clusterBounds = computePlacedBounds(placed);
  const nearbyExisting = buildNearbyExistingPlacements(existingPlacedIndex, clusterBounds, spacing);
  if (!nearbyExisting.length) return true;

  for (const candidate of candidateEntries) {
    for (const existing of nearbyExisting) {
      if (
        candidate.bb.maxX + spacing < existing.bb.minX ||
        candidate.bb.minX - spacing > existing.bb.maxX ||
        candidate.bb.maxY + spacing < existing.bb.minY ||
        candidate.bb.minY - spacing > existing.bb.maxY
      ) {
        continue;
      }

      if (
        cachedPolygonsOverlap(
          candidate.item.polygon,
          existing.item.polygon,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          spacing,
          candidate.bb,
          existing.bb
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function adjustClusterWithinRect(placed, rect, existingPlacedIndex, config) {
  if (!placed?.length) return null;

  const step = Math.max(0.5, config.gridStep || 0.5);
  const spacing = config.spacing || 0;
  const snapped = snapPlacedClusterToRect(placed, rect);
  if (!snapped) return null;
  if (isClusterSafeAgainstExisting(snapped.placed, existingPlacedIndex, spacing)) {
    return snapped;
  }

  const slackX = Math.max(0, roundMetric(rect.x + rect.width - snapped.bounds.maxX, 3));
  const slackY = Math.max(0, roundMetric(rect.y + rect.height - snapped.bounds.maxY, 3));
  const maxShiftX = Math.min(slackX, Math.max(step * 8, spacing * 2));
  const maxShiftY = Math.min(slackY, Math.max(step * 24, spacing * 4));
  const shiftCandidatesX = [0];
  const shiftCandidatesY = [0];

  for (let value = step; value <= maxShiftX + 1e-6; value += step) {
    shiftCandidatesX.push(roundMetric(value, 3));
  }
  for (let value = step; value <= maxShiftY + 1e-6; value += step) {
    shiftCandidatesY.push(roundMetric(value, 3));
  }

  for (const dy of shiftCandidatesY) {
    for (const dx of shiftCandidatesX) {
      if (dx === 0 && dy === 0) continue;
      const shifted = shiftPlacedCluster(snapped.placed, dx, dy);
      if (!isClusterSafeAgainstExisting(shifted, existingPlacedIndex, spacing)) continue;
      const shiftedBounds = computePlacedBounds(shifted);
      if (!shiftedBounds) continue;
      return {
        placed: shifted,
        bounds: shiftedBounds
      };
    }
  }

  return null;
}

function shouldAttemptClusterAdjustment(rect, bounds, existingPlacedIndex, sizeName, spacing = 0) {
  if (!bounds || !existingPlacedIndex?.length) return false;
  const narrowRect = rect.width <= 260 || rect.height <= 260 || (rect.depth || 0) > 0;
  if (!narrowRect) return false;
  return hasCrossSizeNeighbor(existingPlacedIndex, bounds, sizeName, spacing);
}

function shouldRunSheetSalvage(sheetPlaced, remainingPieces, config, behavior) {
  if (!sheetPlaced?.length) return false;
  const remainingTotal = [...remainingPieces.values()].reduce((sum, value) => sum + value, 0);
  if (remainingTotal <= 0) return false;

  const usableRect = getUsableSheetRect(config);
  const totalArea = Math.max(1, usableRect.width * usableRect.height);
  const usedArea = sheetPlaced.reduce((sum, item) => sum + polygonArea(item.polygon), 0);
  const freeArea = totalArea - usedArea;
  const efficiency = (usedArea / totalArea) * 100;
  const distinctRemaining = [...remainingPieces.values()].filter((value) => value > 0).length;
  return freeArea >= behavior.salvageFreeAreaThreshold && efficiency < behavior.salvageEfficiencyThreshold && distinctRemaining >= 1;
}

function buildSalvageFreeRects(sheetPlaced, config, behavior) {
  const usableRect = getUsableSheetRect(config);
  if (!sheetPlaced?.length) return [usableRect];

  return splitFreeRectByBands(usableRect, sheetPlaced, config.spacing || 0)
    .filter((rect) => getRectArea(rect) >= behavior.salvageMinArea)
    .filter((rect) => behavior.irregular || isStripLikeRect(rect))
    .sort((left, right) =>
      getRectArea(right) - getRectArea(left)
      || left.y - right.y
      || left.x - right.x
    )
    .slice(0, behavior.salvageRects);
}

async function runSheetSalvagePass({
  sheetPlaced,
  sheetPlacedIndex,
  remainingPieces,
  prioritizedSizes,
  config,
  capacityCache,
  behavior
}) {
  if (!shouldRunSheetSalvage(sheetPlaced, remainingPieces, config, behavior)) {
    return false;
  }

  let insertedAnything = false;

  for (let insertionIndex = 0; insertionIndex < behavior.salvageInsertions; insertionIndex++) {
    const salvageRects = buildSalvageFreeRects(sheetPlaced, config, behavior);
    let bestCandidate = null;

    for (const rect of salvageRects) {
      const candidateSizes = buildSalvageCandidateSizes(prioritizedSizes, remainingPieces, rect, config)
        .slice(0, behavior.salvageCandidateSizes);
      const rectArea = getRectArea(rect);
      const shouldTryExact = rectArea <= (behavior.irregular ? 110000 : 70000);

      for (const size of candidateSizes) {
        const cachedLayout = await getCapacityLayoutForRect(size, rect, config, capacityCache);
        let trimmed = trimPlacementToRemaining(cachedLayout, remainingPieces.get(size.sizeName) || 0);
        if ((!trimmed?.placedCount || trimmed.placedCount <= 1) && shouldTryExact) {
          const exactLayout = await getExactCapacityLayoutForRect(size, rect, config, capacityCache);
          trimmed = trimPlacementToRemaining(exactLayout, remainingPieces.get(size.sizeName) || 0);
        }
        if (!trimmed?.placedCount || !trimmed.bounds) continue;

        const snapped = snapPlacedClusterToRect(trimmed.placed, rect);
        if (!snapped) continue;
        if (!isClusterSafeAgainstExisting(snapped.placed, sheetPlacedIndex, config.spacing || 0)) continue;

        const fillRatio = trimmed.usedArea / Math.max(1, rectArea);
        const score = trimmed.usedArea + fillRatio * behavior.stripFillWeight + trimmed.placedCount * 300;

        if (
          !bestCandidate ||
          score > bestCandidate.score ||
          (score === bestCandidate.score && trimmed.placedCount > bestCandidate.trimmed.placedCount)
        ) {
          bestCandidate = {
            size,
            score,
            trimmed: {
              ...trimmed,
              placed: snapped.placed,
              bounds: snapped.bounds
            }
          };
        }
      }
    }

    if (!bestCandidate) break;

    for (const item of bestCandidate.trimmed.placed) {
      sheetPlaced.push(item);
      sheetPlacedIndex.push({
        item,
        bb: getBoundingBox(item.polygon)
      });
    }
    remainingPieces.set(
      bestCandidate.size.sizeName,
      Math.max(0, (remainingPieces.get(bestCandidate.size.sizeName) || 0) - bestCandidate.trimmed.placedCount)
    );
    insertedAnything = true;
  }

  return insertedAnything;
}


function buildBatchSheetFromTemplate(sheetIndex, template, config) {
  const rect = getUsableSheetRect(config);
  const layout = cropTemplateToRect(template, rect);
  return buildSheetResult(sheetIndex, layout.placed, config);
}

function resolveBatchCandidate(prioritizedSizes, remainingPieces, templateMap, behavior) {
  for (const size of prioritizedSizes) {
    const remaining = remainingPieces.get(size.sizeName) || 0;
    const template = templateMap.get(size.sizeName);
    const piecesPerSheet = template?.placedCount || 0;
    if (piecesPerSheet <= 0) continue;
    const fullSheetCount = Math.floor(remaining / piecesPerSheet);
    if (fullSheetCount < behavior.minBatchFullSheets) continue;
    const batchCount = Math.max(0, fullSheetCount - behavior.reservedFullSheetsForMixing);
    if (batchCount <= 0) continue;
    return {
      size,
      template,
      piecesPerSheet,
      batchCount
    };
  }
  return null;
}

async function estimateLookaheadUsedArea(rect, leftoverRects, candidateSizes, currentSizeName, config, cache) {
  if ((rect.depth || 0) > 0 || !leftoverRects.length) return 0;

  const targetRect = [...leftoverRects].sort(compareFreeRects)[0];
  if (!targetRect) return 0;

  let bestUsedArea = 0;
  const followUpSizes = candidateSizes
    .filter((size) => size.sizeName !== currentSizeName)
    .slice(0, 5);

  for (const size of followUpSizes) {
    const layout = await getCapacityLayoutForRect(size, targetRect, config, cache);
    if ((layout?.usedArea || 0) > bestUsedArea) {
      bestUsedArea = layout.usedArea || 0;
    }
  }

  return bestUsedArea;
}

export async function runCapacityDrivenMixedSizeNestingMode({
  sizeList,
  createNester,
  config,
  metadata = {}
}) {
  const behavior = resolveMixedBehavior(config);
  const prioritizedSizes = (behavior.orderingMode === 'input'
    ? [...sizeList]
    : sortSizesByDescendingArea(sizeList)
  ).filter((size) => toPairQuantity(size) > 0);
  const remainingPieces = new Map(prioritizedSizes.map((size) => [size.sizeName, toPairQuantity(size) * 2]));
  const placedSheets = [];
  const capacityCache = new Map();
  const startedAt = Date.now();
  const fullTemplateMap = await buildFullSheetTemplateMap(prioritizedSizes, config, capacityCache);

  while ([...remainingPieces.values()].some((value) => value > 0)) {
    const batchCandidate = resolveBatchCandidate(prioritizedSizes, remainingPieces, fullTemplateMap, behavior);
    if (batchCandidate) {
      for (let index = 0; index < batchCandidate.batchCount; index++) {
        placedSheets.push(buildBatchSheetFromTemplate(placedSheets.length, batchCandidate.template, config));
      }
      remainingPieces.set(
        batchCandidate.size.sizeName,
        Math.max(0, (remainingPieces.get(batchCandidate.size.sizeName) || 0) - batchCandidate.batchCount * batchCandidate.piecesPerSheet)
      );
      continue;
    }

    const sheetPlaced = [];
    const sheetPlacedIndex = [];
    const freeRects = [{ ...getUsableSheetRect(config), depth: 0 }];

    let placedSomething = false;

    while (freeRects.length > 0) {
      freeRects.sort(compareFreeRects);
      const rect = freeRects.shift();
      if (!rect || rect.width <= MIN_FREE_RECT_SIZE || rect.height <= MIN_FREE_RECT_SIZE) continue;

      const candidateSizes = buildCandidateSizes(prioritizedSizes, remainingPieces, rect, config, behavior);
      const rankedCandidates = [];

      for (const size of candidateSizes) {
        const layout = await getCapacityLayoutForRect(size, rect, config, capacityCache);
        const variants = buildLayoutVariants(layout, rect);

        for (const variant of variants) {
          const trimmed = trimPlacementToRemaining(variant, remainingPieces.get(size.sizeName) || 0);
          if (!trimmed?.placedCount || !trimmed.bounds) continue;

          const leftoverRects = rect.depth <= 1
            ? splitFreeRectByBands(rect, trimmed.placed, config.spacing || 0)
            : splitFreeRect(rect, trimmed.bounds, config.spacing || 0);
          const fragmentationPenalty = leftoverRects.reduce((sum, nextRect) => {
            const nextArea = getRectArea(nextRect);
            return sum + (nextArea < 120000 ? nextArea * behavior.fragmentationPenaltyWeight : 0);
          }, 0);
          const lookaheadUsedArea = await estimateLookaheadUsedArea(
            rect,
            leftoverRects,
            candidateSizes,
            size.sizeName,
            config,
            capacityCache
          );
          const rectArea = Math.max(1, getRectArea(rect));
          const fillRatio = trimmed.usedArea / rectArea;
          const stripFillBonus = isStripLikeRect(rect)
            ? fillRatio * behavior.stripFillWeight + trimmed.placedCount * 180
            : 0;
          const score = trimmed.usedArea
            + stripFillBonus
            + lookaheadUsedArea * behavior.lookaheadWeight
            - (trimmed.bounds.width * trimmed.bounds.height - trimmed.usedArea) * behavior.emptyBoundsPenaltyWeight
            - fragmentationPenalty;
          rankedCandidates.push({
            size,
            score,
            trimmed,
            leftoverRects
          });
        }
      }

      rankedCandidates.sort((left, right) =>
        right.score - left.score
        || right.trimmed.placedCount - left.trimmed.placedCount
      );

      let bestCandidate = null;
      for (const candidate of rankedCandidates.slice(0, 2)) {
        const snapped = snapPlacedClusterToRect(candidate.trimmed.placed, rect);
        if (!snapped) continue;
        const requiresAdjustment = shouldAttemptClusterAdjustment(
          rect,
          snapped.bounds,
          sheetPlacedIndex,
          candidate.size.sizeName,
          config.spacing || 0
        );
        const adjusted = requiresAdjustment
          ? adjustClusterWithinRect(candidate.trimmed.placed, rect, sheetPlacedIndex, config)
          : snapped;
        if (!adjusted) continue;
        bestCandidate = {
          ...candidate,
          trimmed: {
            ...candidate.trimmed,
            placed: adjusted.placed,
            bounds: adjusted.bounds
          },
          leftoverRects: rect.depth <= 1
            ? splitFreeRectByBands(rect, adjusted.placed, config.spacing || 0)
            : splitFreeRect(rect, adjusted.bounds, config.spacing || 0)
        };
        break;
      }

      if (!bestCandidate) {
        bestCandidate = rankedCandidates[0] || null;
      }

      if (!bestCandidate) continue;

      for (const item of bestCandidate.trimmed.placed) {
        sheetPlaced.push(item);
        sheetPlacedIndex.push({
          item,
          bb: getBoundingBox(item.polygon)
        });
      }
      remainingPieces.set(
        bestCandidate.size.sizeName,
        Math.max(0, (remainingPieces.get(bestCandidate.size.sizeName) || 0) - bestCandidate.trimmed.placedCount)
      );
      placedSomething = true;

      const nextRects = rect.depth >= MAX_FREE_RECT_DEPTH
        ? []
        : (bestCandidate.leftoverRects || (
          rect.depth <= 1
            ? splitFreeRectByBands(rect, bestCandidate.trimmed.placed, config.spacing || 0)
            : splitFreeRect(rect, bestCandidate.trimmed.bounds, config.spacing || 0)
        )).map((nextRect) => ({
          ...nextRect,
          depth: rect.depth + 1
        }));
      freeRects.push(...normalizeFreeRects(nextRects));
      const normalizedExisting = normalizeFreeRects(freeRects);
      freeRects.length = 0;
      freeRects.push(...normalizedExisting);
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

    await runSheetSalvagePass({
      sheetPlaced,
      sheetPlacedIndex,
      remainingPieces,
      prioritizedSizes,
      config,
      capacityCache,
      behavior
    });

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
