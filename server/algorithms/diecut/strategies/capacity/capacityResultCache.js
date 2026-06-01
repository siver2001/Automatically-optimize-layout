import fs from 'fs';
import path from 'path';
import { isMainThread } from 'worker_threads';

// Smart, dynamic limits with environment variable overrides and dynamic fallback
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (persisted indefinitely for deterministic layout calculations)
const DEFAULT_MAX_CACHE_ENTRIES = 512;

const IGNORED_CONFIG_FIELDS = new Set([
  'maxTimeMs',
  'parallelSizes',
  'parallelWorkerCount'
]);

const capacityResultCache = new Map();
let isCacheLoaded = false;

function ensureCacheLoaded() {
  if (isCacheLoaded) return;
  isCacheLoaded = true;

  try {
    const dir = path.join(process.cwd(), '.codex');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const cacheFilePath = path.join(dir, 'capacity_cache.json');
    if (fs.existsSync(cacheFilePath)) {
      const data = fs.readFileSync(cacheFilePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        capacityResultCache.clear();
        const now = Date.now();
        for (const [key, entry] of parsed) {
          if (entry && entry.expiresAt > now) {
            capacityResultCache.set(key, entry);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Cache] Failed to load on-disk cache:', e);
  }
}

function saveCacheToDisk() {
  if (!isMainThread) return;
  try {
    const dir = path.join(process.cwd(), '.codex');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const cacheFilePath = path.join(dir, 'capacity_cache.json');
    const entries = Array.from(capacityResultCache.entries());
    fs.writeFileSync(cacheFilePath, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('[Cache] Failed to save on-disk cache:', e);
  }
}

/**
 * Gets the configured cache TTL (Time to Live) in milliseconds.
 */
function getCacheTtlMs() {
  if (typeof process !== 'undefined' && process.env?.CACHE_TTL_MS) {
    const parsed = parseInt(process.env.CACHE_TTL_MS, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_TTL_MS;
}

/**
 * Dynamically gets the maximum allowed cache entries based on memory usage
 * to prevent Out Of Memory (OOM) crashes.
 */
function getDynamicMaxEntries() {
  if (typeof process !== 'undefined' && process.env?.MAX_CACHE_ENTRIES) {
    const envVal = parseInt(process.env.MAX_CACHE_ENTRIES, 10);
    if (!isNaN(envVal) && envVal > 0) return envVal;
  }

  // Adaptive memory management: Scale down cache limits if memory is low
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    try {
      const { heapUsed } = process.memoryUsage();
      if (heapUsed > 1200 * 1024 * 1024) {
        return Math.max(20, Math.floor(DEFAULT_MAX_CACHE_ENTRIES * 0.2));
      }
      if (heapUsed > 800 * 1024 * 1024) {
        return Math.max(50, Math.floor(DEFAULT_MAX_CACHE_ENTRIES * 0.5));
      }
    } catch (e) {
      // Graceful fallback
    }
  }

  return DEFAULT_MAX_CACHE_ENTRIES;
}

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
  const limit = getDynamicMaxEntries();
  while (capacityResultCache.size > limit) {
    const oldestKey = capacityResultCache.keys().next().value;
    if (oldestKey == null) break;
    capacityResultCache.delete(oldestKey);
  }
}

/**
 * Builds a stable, unique cache key for a specific strategy, size, and config.
 */
export function buildCapacityResultCacheKey(strategyKey, size, config) {
  return JSON.stringify({
    strategyKey,
    sizeName: size?.sizeName ?? null,
    sizeValue: normalizeNumber(size?.sizeValue),
    polygon: normalizePolygon(size?.polygon),
    config: normalizeConfig(config)
  });
}

/**
 * Retrieves a cached capacity test result if it exists and has not expired.
 */
export function getCachedCapacityResult(cacheKey) {
  ensureCacheLoaded();

  if (typeof process !== 'undefined' && process.env?.BYPASS_CAPACITY_CACHE === 'true') {
    return null;
  }

  const entry = capacityResultCache.get(cacheKey);
  if (entry) {
    const now = Date.now();
    if (entry.expiresAt > now) {
      touchCacheEntry(cacheKey, entry);
      return cloneCacheValue(entry.value);
    } else {
      capacityResultCache.delete(cacheKey);
      saveCacheToDisk();
    }
  }
  return null;
}

/**
 * Stores a capacity test result in the cache with the given TTL.
 */
export function setCachedCapacityResult(cacheKey, value, ttlMs = null) {
  ensureCacheLoaded();

  const now = Date.now();
  pruneExpiredEntries(now);

  const finalTtl = ttlMs != null ? ttlMs : getCacheTtlMs();

  touchCacheEntry(cacheKey, {
    value: cloneCacheValue(value),
    expiresAt: now + Math.max(1000, finalTtl)
  });

  enforceCacheLimit();
  saveCacheToDisk();
}

/**
 * Clears the capacity result cache completely.
 */
export function clearCapacityResultCache() {
  capacityResultCache.clear();
  try {
    const cacheFilePath = path.join(process.cwd(), '.codex', 'capacity_cache.json');
    if (fs.existsSync(cacheFilePath)) {
      fs.unlinkSync(cacheFilePath);
    }
  } catch (e) {}
}
