const CACHE_VERSION = 'capacity-cache-v16';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

const resultCache = new Map();

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function roundNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function sanitizeConfig(config = {}) {
  const {
    maxTimeMs,
    parallelSizes,
    parallelWorkerCount,
    ...rest
  } = config;

  const normalized = {};
  for (const key of Object.keys(rest).sort()) {
    const value = rest[key];
    if (typeof value === 'function' || value === undefined) continue;
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => (Number.isFinite(item) ? roundNumber(item) : item));
      continue;
    }
    normalized[key] = Number.isFinite(value) ? roundNumber(value) : value;
  }
  return normalized;
}

function normalizePolygon(polygon) {
  return (polygon || []).map((point) => ({
    x: roundNumber(point.x),
    y: roundNumber(point.y)
  }));
}

function touchEntry(cacheKey, entry) {
  resultCache.delete(cacheKey);
  resultCache.set(cacheKey, entry);
}

function pruneExpiredEntries(now) {
  for (const [cacheKey, entry] of resultCache.entries()) {
    if (entry.expiresAt <= now) {
      resultCache.delete(cacheKey);
    }
  }
}

function enforceCapacityLimit() {
  while (resultCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey == null) break;
    resultCache.delete(oldestKey);
  }
}

export function buildCapacityResultCacheKey(strategyKey, size, config) {
  return JSON.stringify({
    version: CACHE_VERSION,
    strategyKey,
    sizeName: size?.sizeName ?? null,
    sizeValue: roundNumber(size?.sizeValue),
    polygon: normalizePolygon(size?.polygon),
    config: sanitizeConfig(config)
  });
}

export function getCachedCapacityResult(cacheKey) {
  const entry = resultCache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt <= now) {
    resultCache.delete(cacheKey);
    return null;
  }

  touchEntry(cacheKey, entry);
  return cloneValue(entry.value);
}

export function setCachedCapacityResult(cacheKey, value, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  pruneExpiredEntries(now);
  const entry = {
    value: cloneValue(value),
    expiresAt: now + Math.max(1000, ttlMs)
  };
  touchEntry(cacheKey, entry);
  enforceCapacityLimit();
}
