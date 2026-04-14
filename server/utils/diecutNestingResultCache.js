const CACHE_VERSION = 'diecut-nesting-result-v1';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;

const detailCache = new Map();

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function touchEntry(cacheKey, entry) {
  detailCache.delete(cacheKey);
  detailCache.set(cacheKey, entry);
}

function pruneExpiredEntries(now = Date.now()) {
  for (const [cacheKey, entry] of detailCache.entries()) {
    if (entry.expiresAt <= now) {
      detailCache.delete(cacheKey);
    }
  }
}

function enforceCapacityLimit() {
  while (detailCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = detailCache.keys().next().value;
    if (oldestKey == null) break;
    detailCache.delete(oldestKey);
  }
}

function getActiveEntry(resultId) {
  if (!resultId) return null;
  const entry = detailCache.get(resultId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    detailCache.delete(resultId);
    return null;
  }
  touchEntry(resultId, entry);
  return entry;
}

function buildCompactSheetSummary(sheet = {}, index = 0) {
  return {
    sheetIndex: sheet.sheetIndex ?? index,
    sheetWidth: sheet.sheetWidth,
    sheetHeight: sheet.sheetHeight,
    placedCount: sheet.placedCount ?? (sheet.placed || []).length,
    efficiency: sheet.efficiency ?? 0,
    usedArea: sheet.usedArea ?? 0
  };
}

function buildCompactResult(result = {}, cacheKey) {
  const sheets = (result.sheets || []).map((sheet, index) => buildCompactSheetSummary(sheet, index));
  return {
    ...result,
    resultId: cacheKey,
    sheets,
    hasLazySheetDetails: true
  };
}

export function storeDieCutNestingResult(result = {}, ttlMs = DEFAULT_TTL_MS) {
  pruneExpiredEntries();
  const cacheKey = `${CACHE_VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const entry = {
    result: cloneValue(result),
    expiresAt: Date.now() + Math.max(1000, ttlMs)
  };
  touchEntry(cacheKey, entry);
  enforceCapacityLimit();
  return buildCompactResult(result, cacheKey);
}

export function getDieCutNestingResult(resultId) {
  const entry = getActiveEntry(resultId);
  if (!entry) return null;
  return cloneValue(entry.result);
}

export function getDieCutNestingSheetDetail(resultId, sheetIndex) {
  const entry = getActiveEntry(resultId);
  if (!entry?.result) return null;
  const normalizedIndex = Math.max(0, Number(sheetIndex) || 0);
  const sheet = entry.result.sheets?.[normalizedIndex];
  return sheet ? cloneValue(sheet) : null;
}

export function getDieCutNestingSheetDetails(resultId, sheetIndexes = []) {
  const entry = getActiveEntry(resultId);
  if (!entry?.result) return [];

  const normalizedIndexes = [...new Set(
    (sheetIndexes || [])
      .map((value) => Math.max(0, Number(value) || 0))
  )];

  return normalizedIndexes
    .map((index) => (
      entry.result.sheets?.[index]
        ? { sheetIndex: index, sheet: cloneValue(entry.result.sheets[index]) }
        : null
    ))
    .filter(Boolean);
}
