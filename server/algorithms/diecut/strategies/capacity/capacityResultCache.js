// In-memory cache for per-size capacity test results.
// This cache lives only for the current server process and is not persisted.
// Change CAPACITY_VERSION_TAG in capacityVersion.js when result semantics change.

import { CAPACITY_CACHE_KEY_VERSION } from './capacityVersion.js';

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

const IGNORED_CONFIG_FIELDS = new Set([
  'maxTimeMs',
  'parallelSizes',
  'parallelWorkerCount'
]);

const capacityResultCache = new Map();

function cloneCacheValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function normalizeConfigValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (Number.isFinite(item) ? normalizeNumber(item) : item));
  }
  return Number.isFinite(value) ? normalizeNumber(value) : value;
}

function normalizeConfig(config = {}) {
  const normalized = {};

  for (const key of Object.keys(config).sort()) {
    if (IGNORED_CONFIG_FIELDS.has(key)) continue;

    const value = config[key];
    if (value === undefined || typeof value === 'function') continue;

    normalized[key] = normalizeConfigValue(value);
  }

  return normalized;
}

function normalizePolygon(polygon = []) {
  return polygon.map((point) => ({
    x: normalizeNumber(point.x),
    y: normalizeNumber(point.y)
  }));
}

function touchCacheEntry(cacheKey, entry) {
  capacityResultCache.delete(cacheKey);
  capacityResultCache.set(cacheKey, entry);
}

function pruneExpiredEntries(now) {
  for (const [cacheKey, entry] of capacityResultCache.entries()) {
    if (entry.expiresAt <= now) {
      capacityResultCache.delete(cacheKey);
    }
  }
}

function enforceCacheLimit() {
  while (capacityResultCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = capacityResultCache.keys().next().value;
    if (oldestKey == null) break;
    capacityResultCache.delete(oldestKey);
  }
}

export function buildCapacityResultCacheKey(strategyKey, size, config) {
  return JSON.stringify({
    version: CAPACITY_CACHE_KEY_VERSION,
    strategyKey,
    sizeName: size?.sizeName ?? null,
    sizeValue: normalizeNumber(size?.sizeValue),
    polygon: normalizePolygon(size?.polygon),
    config: normalizeConfig(config)
  });
}

export function getCachedCapacityResult(cacheKey) {
  const entry = capacityResultCache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt <= now) {
    capacityResultCache.delete(cacheKey);
    return null;
  }

  touchCacheEntry(cacheKey, entry);
  return cloneCacheValue(entry.value);
}

export function setCachedCapacityResult(cacheKey, value, ttlMs = CACHE_TTL_MS) {
  const now = Date.now();
  pruneExpiredEntries(now);

  touchCacheEntry(cacheKey, {
    value: cloneCacheValue(value),
    expiresAt: now + Math.max(1000, ttlMs)
  });

  enforceCacheLimit();
}
