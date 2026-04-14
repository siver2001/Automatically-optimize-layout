import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';

import { parseCadBufferToSizedShapesWithAnalysis } from '../server/algorithms/diecut/core/dxfParser.js';
import { NestingNormalPairing } from '../server/algorithms/diecut/strategies/normal/NestingNormalPairing.js';
import { NestingNormalPiece } from '../server/algorithms/diecut/strategies/normal/NestingNormalPiece.js';
import {
  applyLayersToSizeList,
  buildNestingPlanSummary,
  finalizeNestingResult,
  normalizeLayers,
  normalizeNestingStrategy,
} from '../server/algorithms/diecut/strategies/normal/nestingPlanUtils.js';
import { runNestingMode } from '../server/algorithms/diecut/strategies/normal/runNestingMode.js';

const ROOT = process.cwd();
const DXF_FILE =
  'PUMA-DC-HE-019(DAOGOLUXIN)-UKFS-VMC-D-0393-2024-07-31(DINH DANG LUXIN).dxf';
const EXCEL_FILE = 'FORM TÍNH TOÁN CÔNG VIỆC MÁY LUXIN 2.0.xlsm';

function extractExcelCellValue(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.result != null) return value.result;
    if (typeof value.text === 'string') return value.text;
    if (typeof value.hyperlink === 'string') return value.text || value.hyperlink;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || '').join('');
    }
    return null;
  }
  return value;
}

function normalizeExcelText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0110\u0111]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getWorksheetPrimitiveValues(row) {
  return row.values.map(extractExcelCellValue);
}

function getNumericSizeValues(values) {
  return values.filter((value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 3 && num <= 20;
  });
}

function isPreferredSizeHeaderRow(values) {
  const normalizedCells = values.map(normalizeExcelText);
  const joined = normalizedCells.join(' | ');
  return joined.includes('size') || joined.includes('size rpro');
}

function isPreferredTotalRow(values) {
  const leadText = normalizeExcelText(values.slice(0, 3).filter(Boolean).join(' '));
  if (!leadText) return false;
  return (
    leadText.includes('tong so doi') ||
    leadText.includes('tong doi') ||
    leadText === 'tong' ||
    leadText.includes('total pair') ||
    leadText.includes('total')
  );
}

async function parseExcelQuantities(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const result = [];

  workbook.eachSheet((worksheet) => {
    let headerRow = null;
    let totalRow = null;
    let fallbackHeaderRow = null;

    worksheet.eachRow((row) => {
      const vals = getWorksheetPrimitiveValues(row);
      const numericVals = getNumericSizeValues(vals);

      if (numericVals.length >= 3) {
        if (!fallbackHeaderRow) fallbackHeaderRow = vals;
        if (!headerRow && isPreferredSizeHeaderRow(vals)) {
          headerRow = vals;
        }
      }

      const candidateNumbers = vals.filter((value) => {
        const num = Number(value);
        return Number.isFinite(num) && num >= 0;
      });

      if (candidateNumbers.length >= 3) {
        if (headerRow && isPreferredTotalRow(vals)) {
          totalRow = { vals, rowNumber: row.number };
        }
      }
    });

    headerRow = headerRow || fallbackHeaderRow;
    if (!headerRow || !totalRow) return;

    const sizeMap = {};
    headerRow.forEach((val, idx) => {
      const num = Number(val);
      if (Number.isFinite(num) && num >= 3 && num <= 20) {
        sizeMap[idx] = num.toFixed(1);
      }
    });

    const quantities = {};
    totalRow.vals.forEach((val, idx) => {
      if (sizeMap[idx] == null) return;
      const qty = Math.round(Number(String(val).replace(/,/g, '')));
      if (Number.isFinite(qty) && qty > 0) {
        quantities[sizeMap[idx]] = (quantities[sizeMap[idx]] || 0) + qty;
      }
    });

    const orderName = worksheet.name;
    Object.entries(quantities).forEach(([sizeName, pairQty]) => {
      result.push({
        orderName,
        sizeName,
        sizeValue: Number.parseFloat(sizeName),
        pairQuantity: pairQty,
        pieceQuantity: pairQty * 2,
      });
    });
  });

  return result;
}

function mergeShapesAndQuantities(shapes, quantities) {
  return shapes.map((shape) => {
    const match = quantities.find((entry) => entry.sizeName === shape.sizeName);
    return {
      ...shape,
      quantity: match ? match.pairQuantity : 0,
      pairQuantity: match ? match.pairQuantity : 0,
      pieceQuantity: match ? match.pieceQuantity : 0,
    };
  });
}

function applyRecommendedMode(config, importAnalysis) {
  const recommendation = importAnalysis?.recommendation;
  if (!recommendation?.autoApply) {
    if (
      config.capacityLayoutMode === 'same-side-double-contour' ||
      config.capacityLayoutMode === 'same-side-prepaired-tight'
    ) {
      return {
        ...config,
        mirrorPairs: true,
        pairingStrategy: 'pair',
        capacityLayoutMode: 'pair-complementary',
      };
    }

    if (config.pairingStrategy === 'same-side' || config.mirrorPairs === false) {
      return {
        ...config,
        mirrorPairs: false,
        pairingStrategy: 'same-side',
        capacityLayoutMode:
          recommendation?.capacityLayoutMode === 'same-side-double-contour'
            ? 'same-side-double-contour'
            : 'same-side-banded',
      };
    }

    return {
      ...config,
      mirrorPairs: true,
      pairingStrategy: 'pair',
      capacityLayoutMode: 'pair-complementary',
    };
  }

  return {
    ...config,
    mirrorPairs: false,
    pairingStrategy: 'same-side',
    capacityLayoutMode:
      recommendation?.capacityLayoutMode === 'same-side-double-contour'
        ? 'same-side-double-contour'
        : 'same-side-banded',
  };
}

async function loadCaseData() {
  const dxfPath = path.join(ROOT, DXF_FILE);
  const excelPath = path.join(ROOT, EXCEL_FILE);
  const dxfBuffer = await fs.readFile(dxfPath);
  const { shapes, importAnalysis } = await parseCadBufferToSizedShapesWithAnalysis(
    dxfBuffer,
    DXF_FILE,
    3.0,
    0.5,
  );
  const quantities = await parseExcelQuantities(excelPath);
  const sizeList = mergeShapesAndQuantities(shapes, quantities).filter(
    (size) => (size.quantity || 0) > 0,
  );
  return { sizeList, importAnalysis };
}

async function runBenchmark() {
  const { sizeList, importAnalysis } = await loadCaseData();
  const baseConfig = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    spacing: 3,
    staggerSpacing: 3,
    marginX: 5,
    marginY: 5,
    allowRotate90: true,
    allowRotate180: true,
    mirrorPairs: true,
    pairingStrategy: 'pair',
    capacityLayoutMode: 'pair-complementary',
    gridStep: 0.5,
    layers: 1,
    nestingStrategy: 'mixed-size-area',
    maxTimeMs: 60000,
  };
  const config = applyRecommendedMode(baseConfig, importAnalysis);
  config.layers = normalizeLayers(config.layers);
  config.nestingStrategy = normalizeNestingStrategy(config.nestingStrategy);

  const createNester = () =>
    config.pairingStrategy === 'same-side' || config.mirrorPairs === false
      ? new NestingNormalPiece(config)
      : new NestingNormalPairing(config);

  const plannedSizeList = applyLayersToSizeList(sizeList, config.layers);
  const planSummary = buildNestingPlanSummary(sizeList, plannedSizeList, config);

  const startedAt = performance.now();
  const rawResult = await runNestingMode({
    sizeList: plannedSizeList,
    createNester,
    config,
    metadata: {
      layers: config.layers,
      nestingStrategy: config.nestingStrategy,
      planningSummary: planSummary,
    },
  });
  const elapsedMs = performance.now() - startedAt;
  const result = finalizeNestingResult(rawResult, config, {
    layers: config.layers,
    nestingStrategy: config.nestingStrategy,
    planningSummary: planSummary,
  });

  const sheets = result.sheets || [];
  console.log(JSON.stringify({
    file: DXF_FILE,
    excel: EXCEL_FILE,
    recommendation: importAnalysis?.recommendation || null,
    config,
    totalSizes: sizeList.length,
    totalSheets: result.totalSheets,
    placedCount: result.placedCount,
    unplacedCount: result.unplacedCount,
    efficiency: result.efficiency,
    elapsedMs: Math.round(elapsedMs),
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    lastSheets: sheets.slice(-8).map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      placedCount: sheet.placedCount || 0,
      efficiency: sheet.efficiency || 0,
    })),
  }, null, 2));
}

runBenchmark().catch((error) => {
  console.error(error);
  process.exit(1);
});
