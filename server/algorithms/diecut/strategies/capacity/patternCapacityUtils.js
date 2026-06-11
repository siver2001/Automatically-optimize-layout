import { getBoundingBox, polygonsOverlap as rawPolygonsOverlap } from '../../core/polygonUtils.js';

const DEFAULT_MAX_OVERLAP_CACHE_ENTRIES = 500000;
const DEFAULT_MAX_LOCAL_VALIDATION_CACHE_ENTRIES = 100000;

// Exporting constants to maintain backwards compatibility if they are referenced anywhere else
export const MAX_OVERLAP_CACHE_ENTRIES = DEFAULT_MAX_OVERLAP_CACHE_ENTRIES;
export const MAX_LOCAL_VALIDATION_CACHE_ENTRIES = DEFAULT_MAX_LOCAL_VALIDATION_CACHE_ENTRIES;

const objectIdCache = new WeakMap();
const overlapCache = new Map();
let overlapCacheSize = 0;
const localValidationCache = new Map();
let nextObjectId = 1;

export function clearPatternCapacityCaches() {
  overlapCache.clear();
  localValidationCache.clear();
  overlapCacheSize = 0;
  // We keep objectIdCache as it's a WeakMap and safe from leaks
}

function getObjectId(object) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) {
    return String(object);
  }

  let id = objectIdCache.get(object);
  if (!id) {
    id = nextObjectId++;
    objectIdCache.set(object, id);
  }
  return id;
}

/**
 * Dynamically gets the maximum allowed cache entries based on environment variables
 * and system/V8 heap memory usage to prevent Out Of Memory (OOM) crashes.
 */
function getDynamicMaxEntries(defaultLimit, envVarName) {
  // 1. Allow environment variable overrides
  if (typeof process !== 'undefined' && process.env) {
    const envVal = process.env[envVarName];
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  // 2. Adaptive Memory Sizing: Scale down limits if Node.js V8 heap is under pressure
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    try {
      const { heapUsed } = process.memoryUsage();
      
      // If heap is > 1.2 GB, scale down to 20% of the default limit
      if (heapUsed > 1200 * 1024 * 1024) {
        return Math.max(1000, Math.floor(defaultLimit * 0.2));
      }
      // If heap is > 800 MB, scale down to 50% of the default limit
      if (heapUsed > 800 * 1024 * 1024) {
        return Math.max(2000, Math.floor(defaultLimit * 0.5));
      }
    } catch (e) {
      // Graceful fallback if process.memoryUsage() throws or fails
    }
  }

  return defaultLimit;
}

/**
 * Gets an entry from the Map cache and refreshes its position (Least Recently Used - LRU)
 */
function getLruCacheEntry(cache, key) {
  if (cache.has(key)) {
    const value = cache.get(key);
    // Delete and re-set moves the key to the end of insertion order in modern JS Map,
    // marking it as the most recently accessed entry.
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  return undefined;
}

/**
 * Sets a cache entry, restricting the cache size to maxEntries.
 * Uses a while loop in case maxEntries dynamically drops due to memory pressure.
 */
function setBoundedCacheEntry(cache, key, value, maxEntries) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}

function formatCacheMetric(value) {
  return Number.isFinite(value) ? roundMetric(value, 3) : value;
}

function buildOverlapCacheKey(polyA, polyB, offsetA, offsetB, spacing) {
  const idA = getObjectId(polyA);
  const idB = getObjectId(polyB);
  let dx = formatCacheMetric((offsetB?.x ?? 0) - (offsetA?.x ?? 0));
  let dy = formatCacheMetric((offsetB?.y ?? 0) - (offsetA?.y ?? 0));

  if (idA > idB) {
    return `${idB}|${idA}|${-dx}|${-dy}|${formatCacheMetric(spacing ?? 0)}`;
  }

  return `${idA}|${idB}|${dx}|${dy}|${formatCacheMetric(spacing ?? 0)}`;
}

function buildEnvelopeFromIndexed(indexedPlacements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placement of indexedPlacements) {
    minX = Math.min(minX, placement.bb.minX);
    minY = Math.min(minY, placement.bb.minY);
    maxX = Math.max(maxX, placement.bb.maxX);
    maxY = Math.max(maxY, placement.bb.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function buildLocalValidationCacheKey(rebasedPlacements, workWidth, workHeight, spacing) {
  const parts = [`${formatCacheMetric(workWidth)}:${formatCacheMetric(workHeight)}:${formatCacheMetric(spacing ?? 0)}`];

  for (const placement of rebasedPlacements) {
    parts.push(
      `${getObjectId(placement.orient)}@${formatCacheMetric(placement.x)},${formatCacheMetric(placement.y)}`
    );
  }

  return parts.join('|');
}

export function cachedPolygonsOverlap(polyA, polyB, offsetA = { x: 0, y: 0 }, offsetB = { x: 0, y: 0 }, spacing = 0, bbA = null, bbB = null) {
  const pad = Math.max(0, spacing || 0);
  
  // 1. Fast early exit using bounding boxes (extremely cheap, no key construction)
  const boxA = bbA || getOrientBounds({ polygon: polyA });
  const boxB = bbB || getOrientBounds({ polygon: polyB });
  
  if (
    offsetA.x + boxA.maxX + pad < offsetB.x + boxB.minX - 1e-9 ||
    offsetA.x + boxA.minX - pad > offsetB.x + boxB.maxX + 1e-9 ||
    offsetA.y + boxA.maxY + pad < offsetB.y + boxB.minY - 1e-9 ||
    offsetA.y + boxA.minY - pad > offsetB.y + boxB.maxY + 1e-9
  ) {
    return false;
  }

  // 2. Build flat cache key and check Cache
  const idA = getObjectId(polyA);
  const idB = getObjectId(polyB);
  const dx = formatCacheMetric((offsetB?.x ?? 0) - (offsetA?.x ?? 0));
  const dy = formatCacheMetric((offsetB?.y ?? 0) - (offsetA?.y ?? 0));
  const s = formatCacheMetric(spacing ?? 0);

  let firstId = idA;
  let secondId = idB;
  let finalDx = dx;
  let finalDy = dy;
  if (idA > idB) {
    firstId = idB;
    secondId = idA;
    finalDx = -dx;
    finalDy = -dy;
  }

  const key = firstId + '|' + secondId + '|' + finalDx + '|' + finalDy + '|' + s;

  const cachedVal = overlapCache.get(key);
  if (cachedVal !== undefined) {
    return cachedVal;
  }

  // 3. Multi-resolution check: Fast early exit using low-resolution simplified polygons
  const lowResA = polyA.polygonLowRes;
  const lowResB = polyB.polygonLowRes;
  if (lowResA && lowResB) {
    const padLow = pad + 1.6; // spacing + 2 * (low-res tolerance 0.8)
    const isOverlapLow = rawPolygonsOverlap(lowResA, lowResB, offsetA, offsetB, padLow, boxA, boxB);
    if (!isOverlapLow) {
      const dynamicMax = getDynamicMaxEntries(DEFAULT_MAX_OVERLAP_CACHE_ENTRIES, 'MAX_OVERLAP_CACHE_ENTRIES');
      if (overlapCache.size >= dynamicMax) {
        overlapCache.clear();
      }
      overlapCache.set(key, false);
      return false; // Guaranteed no overlap
    }
  }

  // 4. Raw overlap check (expensive, runs SAT)
  const result = rawPolygonsOverlap(polyA, polyB, offsetA, offsetB, spacing, boxA, boxB);
  
  const dynamicMax = getDynamicMaxEntries(DEFAULT_MAX_OVERLAP_CACHE_ENTRIES, 'MAX_OVERLAP_CACHE_ENTRIES');
  if (overlapCache.size >= dynamicMax) {
    overlapCache.clear();
  }
  overlapCache.set(key, result);

  return result;
}

export function roundMetric(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function quantizeToStep(value, step) {
  if (step <= 0) return value;
  const factor = 1 / step;
  return Math.round(value * factor) / factor;
}

export function buildShiftCandidates(rangeMm, step, maxSamples = 25) {
  const limit = Math.max(0, quantizeToStep(rangeMm, step));
  if (limit <= 0) return [0];

  const totalSteps = Math.floor(limit / step);
  const values = [];

  if (totalSteps * 2 + 1 <= maxSamples) {
    for (let unit = -totalSteps; unit <= totalSteps; unit++) {
      values.push(unit * step);
    }
  } else {
    const slots = Math.max(3, maxSamples);
    for (let i = 0; i < slots; i++) {
      const t = slots === 1 ? 0 : i / (slots - 1);
      const value = -limit + t * limit * 2;
      values.push(quantizeToStep(value, step));
    }
    values.push(0);
  }

  return [...new Set(values)]
    .sort((a, b) => {
      const absDiff = Math.abs(a) - Math.abs(b);
      if (absDiff !== 0) return absDiff;
      return a - b;
    });
}

export function findMinimalQuantizedValue(minMm, maxMm, step, isSafe) {
  const minUnits = Math.ceil(minMm / step);
  const maxUnits = Math.floor(maxMm / step);
  if (minUnits > maxUnits) return null;

  if (!isSafe(maxUnits * step)) return null;

  let low = minUnits;
  let high = maxUnits;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (isSafe(mid * step)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low * step;
}

export function getOrientBounds(orient) {
  if (orient.bb) return orient.bb;
  return getBoundingBox(orient.polygon);
}

export function computeEnvelope(placements) {
  if (!placements.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    minX = Math.min(minX, placement.x + bb.minX);
    minY = Math.min(minY, placement.y + bb.minY);
    maxX = Math.max(maxX, placement.x + bb.maxX);
    maxY = Math.max(maxY, placement.y + bb.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function rebasePlacements(placements, padding = 0) {
  const bounds = computeEnvelope(placements);
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;

  return {
    bounds,
    workWidth: Math.max(0, bounds.width + padding * 2),
    workHeight: Math.max(0, bounds.height + padding * 2),
    placements: placements.map((placement) => ({
      ...placement,
      x: placement.x + offsetX,
      y: placement.y + offsetY
    }))
  };
}

export function validatePatternPlacements(placements, workWidth, workHeight, spacing) {
  if (!placements.length) {
    return {
      valid: false,
      reason: 'empty-layout',
      bounds: computeEnvelope(placements)
    };
  }

  const indexed = placements.map((placement, index) => {
    const localBounds = getOrientBounds(placement.orient);
    return {
      ...placement,
      index,
      localBounds,
      bb: {
        minX: placement.x + localBounds.minX,
        minY: placement.y + localBounds.minY,
        maxX: placement.x + localBounds.maxX,
        maxY: placement.y + localBounds.maxY,
        width: localBounds.width,
        height: localBounds.height
      }
    };
  });
  const envelope = buildEnvelopeFromIndexed(indexed);

  for (const item of indexed) {
    if (
      item.bb.minX < -1e-6 ||
      item.bb.minY < -1e-6 ||
      item.bb.maxX > workWidth + 1e-6 ||
      item.bb.maxY > workHeight + 1e-6
    ) {
      return {
        valid: false,
        reason: 'out-of-bounds',
        bounds: envelope
      };
    }
  }

  const avgSpan = indexed.reduce((sum, item) => sum + Math.max(item.bb.width, item.bb.height), 0) / indexed.length;
  const cellSize = Math.max(10, avgSpan + spacing);
  const buckets = new Map();
  const compared = new Set();

  for (const item of indexed) {
    const minCellX = Math.floor(item.bb.minX / cellSize);
    const maxCellX = Math.floor(item.bb.maxX / cellSize);
    const minCellY = Math.floor(item.bb.minY / cellSize);
    const maxCellY = Math.floor(item.bb.maxY / cellSize);

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const key = `${cx}:${cy}`;
        const existing = buckets.get(key) || [];
        for (const other of existing) {
          const pairKey = item.index > other.index
            ? `${other.index}:${item.index}`
            : `${item.index}:${other.index}`;
          if (compared.has(pairKey)) continue;
          compared.add(pairKey);

          if (
            cachedPolygonsOverlap(
              item.orient.polygon,
              other.orient.polygon,
              { x: item.x, y: item.y },
              { x: other.x, y: other.y },
              spacing,
              item.localBounds,
              other.localBounds
            )
          ) {
            return {
              valid: false,
              reason: 'overlap',
              bounds: envelope,
              pair: [other.id, item.id]
            };
          }
        }
        existing.push(item);
        buckets.set(key, existing);
      }
    }
  }

  return {
    valid: true,
    bounds: envelope
  };
}

export function validateLocalPlacements(placements, spacing, padding = 10) {
  const rebased = rebasePlacements(placements, padding);
  const cacheKey = buildLocalValidationCacheKey(
    rebased.placements,
    rebased.workWidth,
    rebased.workHeight,
    spacing
  );

  const cachedVal = getLruCacheEntry(localValidationCache, cacheKey);
  if (cachedVal !== undefined) {
    return cachedVal;
  }

  const result = validatePatternPlacements(rebased.placements, rebased.workWidth, rebased.workHeight, spacing);
  const dynamicMax = getDynamicMaxEntries(DEFAULT_MAX_LOCAL_VALIDATION_CACHE_ENTRIES, 'MAX_LOCAL_VALIDATION_CACHE_ENTRIES');
  return setBoundedCacheEntry(localValidationCache, cacheKey, result, dynamicMax);
}

export function comparePatternCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.envelopeWasteMm2 !== bestCandidate.envelopeWasteMm2) {
    return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  const nextShift = Math.abs(nextCandidate.rowShiftXmm) + Math.abs(nextCandidate.colShiftYmm);
  const bestShift = Math.abs(bestCandidate.rowShiftXmm) + Math.abs(bestCandidate.colShiftYmm);
  if (nextShift !== bestShift) {
    return nextShift - bestShift;
  }
  if (nextCandidate.topBandUsed !== bestCandidate.topBandUsed) {
    return nextCandidate.topBandUsed ? -1 : 1;
  }
  return 0;
}

export function compareComplementaryCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.envelopeWasteMm2 !== bestCandidate.envelopeWasteMm2) {
    return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.patternFamily !== bestCandidate.patternFamily) {
    if (nextCandidate.patternFamily === 'checkerboard') return -1;
    if (bestCandidate.patternFamily === 'checkerboard') return 1;
  }
  if (nextCandidate.topBandUsed !== bestCandidate.topBandUsed) {
    return nextCandidate.topBandUsed ? -1 : 1;
  }
  return 0;
}

export function rotateVector(vector, angleDegrees) {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

export function resolveAxisSideFromVector(vector) {
  if (!vector) return null;
  if (Math.abs(vector.x) >= Math.abs(vector.y)) {
    return vector.x >= 0 ? 'right' : 'left';
  }
  return vector.y >= 0 ? 'bottom' : 'top';
}

export function isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex = null) {
  const splitSide = orient?.splitOutwardSide;
  if (!splitSide) return true;

  const bb = orient.bb || getBoundingBox(orient.polygon);
  const minX = x + bb.minX;
  const maxX = x + bb.maxX;
  const minY = y + bb.minY;
  const maxY = y + bb.maxY;

  let corridor = null;
  if (splitSide === 'left' && minX > 1e-6) {
    corridor = { minX: 0, maxX: minX, minY, maxY };
  } else if (splitSide === 'right' && maxX < workWidth - 1e-6) {
    corridor = { minX: maxX, maxX: workWidth, minY, maxY };
  } else if (splitSide === 'top' && maxY < workHeight - 1e-6) {
    corridor = { minX, maxX, minY: maxY, maxY: workHeight };
  } else if (splitSide === 'bottom' && minY > 1e-6) {
    corridor = { minX, maxX, minY: 0, maxY: minY };
  }

  if (!corridor) return true;

  if (spatialIndex && spatialIndex.grid) {
    const { grid, cellSize } = spatialIndex;
    const startCellX = Math.max(0, Math.floor(corridor.minX / cellSize));
    const endCellX = Math.floor(corridor.maxX / cellSize);
    const startCellY = Math.max(0, Math.floor(corridor.minY / cellSize));
    const endCellY = Math.floor(corridor.maxY / cellSize);

    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        const cell = grid.get(`${cx},${cy}`);
        if (!cell) continue;
        for (const entry of cell) {
          const overlaps = !(
            entry.maxX <= corridor.minX + 1e-6 ||
            entry.minX >= corridor.maxX - 1e-6 ||
            entry.maxY <= corridor.minY + 1e-6 ||
            entry.minY >= corridor.maxY - 1e-6
          );
          if (overlaps) return false;
        }
      }
    }
  } else {
    for (const entry of occupiedPlacements) {
      const entryBB = entry.orient.bb || getBoundingBox(entry.orient.polygon);
      const eMinX = entry.x + entryBB.minX;
      const eMaxX = entry.x + entryBB.maxX;
      const eMinY = entry.y + entryBB.minY;
      const eMaxY = entry.y + entryBB.maxY;

      const overlaps = !(
        eMaxX <= corridor.minX + 1e-6 ||
        eMinX >= corridor.maxX - 1e-6 ||
        eMaxY <= corridor.minY + 1e-6 ||
        eMinY >= corridor.maxY - 1e-6
      );
      if (overlaps) return false;
    }
  }

  return true;
}
