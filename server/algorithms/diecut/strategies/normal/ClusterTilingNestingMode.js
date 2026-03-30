/**
 * ClusterTilingNestingMode.js
 * 
 * Chiến lược nesting tối ưu cho số lượng lớn (hàng nghìn đôi trở lên).
 * 
 * Ý tưởng cốt lõi:
 *   1. Chạy testCapacity() MỘT LẦN cho mỗi size → nhận được "template sheet"
 *      (bố trí tối ưu trên 1 tấm PU)
 *   2. Tính toán số tấm PU cần thiết = totalPieces / piecesPerSheet
 *   3. Nhân bản template bằng phép chia số học đơn giản → O(1) per sheet
 *      thay vì chạy lại thuật toán hình học cho từng tấm
 * 
 * Kết quả IDENTICAL với CapacityDrivenSingleSizeNestingMode vì dùng cùng
 * engine testCapacity(), chỉ khác biệt ở cách nhân bản ra nhiều sheet.
 */

import { area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestComplementaryPattern } from '../capacity/CapacityTestComplementaryPattern.js';
import { CapacityTestSameSidePattern } from '../capacity/CapacityTestSameSidePattern.js';
import { finalizeNestingResult } from './nestingPlanUtils.js';

// ─── Helpers ─────────────────────────────────────────────

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

// ─── Template Builder (Heavy computation — runs ONCE per size) ───

async function buildCapacityTemplate(size, config) {
  const nester = createCapacityNester(config);
  const result = await nester.testCapacity([size], config);
  return result?.sheetsBySize?.[size.sizeName] || null;
}

// ─── Sheet Factory (Lightweight — runs per batch) ───

function createFullSheet(templateSheet, pieceArea, sheetIndex, config) {
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);
  const placedCount = templateSheet.placedCount;
  const usedArea = placedCount * Math.max(0, pieceArea || 0);

  return {
    ...templateSheet,
    sheetIndex,
    // Share the same placed array reference — no clone needed for full sheets
    placed: templateSheet.placed,
    placedCount,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

function createPartialSheet(templateSheet, takeCount, pieceArea, sheetIndex, config) {
  const totalArea = (config.sheetWidth || 0) * (config.sheetHeight || 0);
  const placed = templateSheet.placed.slice(0, takeCount);
  const usedArea = takeCount * Math.max(0, pieceArea || 0);

  return {
    ...templateSheet,
    sheetIndex,
    placed,
    placedCount: takeCount,
    usedArea,
    efficiency: totalArea > 0
      ? parseFloat(((usedArea / totalArea) * 100).toFixed(1))
      : 0
  };
}

// ─── Main Entry Point ───────────────────────────────────

export async function runClusterTilingNestingMode({
  sizeList,
  createNester,
  config,
  metadata = {}
}) {
  const startedAt = Date.now();
  const scopedSizes = sizeList.filter((size) => toPairQuantity(size) > 0);
  const capacityConfig = buildCapacityConfig(config);

  // ═══════════════════════════════════════════════════════
  // PHASE 1: Build capacity templates (HEAVY — once per unique size)
  // ═══════════════════════════════════════════════════════
  const templateMap = new Map();
  let templateBuildTimeMs = 0;

  for (const size of scopedSizes) {
    const tStart = Date.now();
    const template = await buildCapacityTemplate(size, capacityConfig);
    templateBuildTimeMs += Date.now() - tStart;

    if (template && template.placedCount > 0) {
      templateMap.set(size.sizeName, {
        template,
        piecesPerSheet: template.placedCount,
        pieceArea: polygonArea(size.polygon)
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  // PHASE 2: Tile sheets (LIGHTWEIGHT — pure math)
  // ═══════════════════════════════════════════════════════
  const tilingStartedAt = Date.now();
  const allSheets = [];
  let totalPlacedCount = 0;
  let totalItems = 0;

  for (const size of scopedSizes) {
    const totalPiecesForSize = toPairQuantity(size) * 2;
    totalItems += totalPiecesForSize;

    const cached = templateMap.get(size.sizeName);

    if (!cached || cached.piecesPerSheet <= 0) {
      // Fallback: dùng nester cũ nếu capacity test không cho kết quả
      const fallbackResult = await createNester().nest([size], config);
      for (const sheet of (fallbackResult.sheets || [])) {
        allSheets.push({
          ...sheet,
          sheetIndex: allSheets.length
        });
        totalPlacedCount += sheet.placedCount || 0;
      }
      continue;
    }

    const { template, piecesPerSheet, pieceArea } = cached;

    // Tính toán số tấm cần — pure arithmetic, O(1)
    const fullSheetCount = Math.floor(totalPiecesForSize / piecesPerSheet);
    const remainderPieces = totalPiecesForSize % piecesPerSheet;

    // Tạo các tấm đầy đủ — chỉ tạo metadata, reference chung placed array
    for (let i = 0; i < fullSheetCount; i++) {
      allSheets.push(createFullSheet(template, pieceArea, allSheets.length, config));
      totalPlacedCount += piecesPerSheet;
    }

    // Tạo tấm cuối (nếu có dư)
    if (remainderPieces > 0) {
      allSheets.push(createPartialSheet(template, remainderPieces, pieceArea, allSheets.length, config));
      totalPlacedCount += remainderPieces;
    }
  }

  const tilingTimeMs = Date.now() - tilingStartedAt;
  const totalTimeMs = Date.now() - startedAt;

  // ═══════════════════════════════════════════════════════
  // PHASE 3: Finalize result
  // ═══════════════════════════════════════════════════════
  return finalizeNestingResult(
    {
      sheets: allSheets,
      placedCount: totalPlacedCount,
      totalItems,
      timeMs: totalTimeMs,
      // Metadata bổ sung cho debugging/profiling
      _clusterTilingStats: {
        templateBuildTimeMs,
        tilingTimeMs,
        templateCount: templateMap.size,
        totalSheets: allSheets.length,
        method: 'cluster-tiling'
      }
    },
    config,
    metadata
  );
}
