import fs from 'fs/promises';
import ExcelJS from 'exceljs';
import { parseCadBufferToSizedShapesWithAnalysis } from './server/algorithms/diecut/core/dxfParser.js';
import { runNestingMode } from './server/algorithms/diecut/strategies/normal/runNestingMode.js';
import { NestingNormalPairing } from './server/algorithms/diecut/strategies/normal/NestingNormalPairing.js';
import { getBoundingBox, polygonsOverlap } from './server/algorithms/diecut/core/polygonUtils.js';

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

async function parseExcel(filePath) {
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

      if (candidateNumbers.length >= 3 && headerRow && isPreferredTotalRow(vals)) {
        totalRow = { vals, rowNumber: row.number };
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

    Object.entries(quantities).forEach(([sizeName, pairQty]) => {
      result.push({
        orderName: worksheet.name,
        sizeName,
        sizeValue: Number(sizeName),
        pairQuantity: pairQty,
        pieceQuantity: pairQty * 2
      });
    });
  });

  return result;
}

function mergeShapesAndQuantities(shapes, quantities) {
  return shapes.map((shape) => {
    const match = quantities.find((item) => item.sizeName === shape.sizeName);
    return {
      ...shape,
      quantity: match ? match.pairQuantity : 0,
      pairQuantity: match ? match.pairQuantity : 0,
      pieceQuantity: match ? match.pieceQuantity : 0
    };
  });
}

function inspectSheetSpacing(sheet, spacing) {
  const placed = sheet?.placed || [];
  let violations = 0;
  const samples = [];
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    const bbA = getBoundingBox(a.polygon);
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      const bbB = getBoundingBox(b.polygon);
      if (polygonsOverlap(a.polygon, b.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, spacing, bbA, bbB)) {
        violations += 1;
        if (samples.length < 6) {
          samples.push({
            a: { sizeName: a.sizeName, foot: a.foot, x: a.x, y: a.y, angle: a.angle },
            b: { sizeName: b.sizeName, foot: b.foot, x: b.x, y: b.y, angle: b.angle }
          });
        }
      }
    }
  }
  return { violations, samples };
}

const dxfPath = './SOLEWORK-DC-UN-001-MS FS-AUGUST SPORTS-D-0704-ATOM-2026-03-09.dxf';
const excelPath = './FORM TÍNH TOÁN CÔNG VIỆC MÁY LUXIN 2.0.xlsm';
const config = {
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
  gridStep: 0.5,
  layers: 1,
  nestingStrategy: process.env.DIECUT_NESTING_STRATEGY || 'mixed-size-area',
  maxTimeMs: 60000
};

const cadBuffer = await fs.readFile(dxfPath);
const { shapes } = await parseCadBufferToSizedShapesWithAnalysis(cadBuffer, dxfPath, 3.5, 0.5);
const quantities = await parseExcel(excelPath);
const sizeList = mergeShapesAndQuantities(shapes, quantities).filter((item) => (item.quantity || 0) > 0);

const result = await runNestingMode({
  sizeList,
  createNester: () => new NestingNormalPairing(config),
  config,
  metadata: {}
});
const tailSheets = [...(result.sheets || [])]
  .slice(-6)
  .map((sheet) => ({
    sheetIndex: sheet.sheetIndex,
    efficiency: sheet.efficiency,
    placedCount: sheet.placedCount,
    spacingCheck: inspectSheetSpacing(sheet, config.spacing)
  }));
const lowestSheets = [...(result.sheets || [])]
  .sort((a, b) => a.efficiency - b.efficiency)
  .slice(0, 8)
  .map((sheet) => ({
    sheetIndex: sheet.sheetIndex,
    efficiency: sheet.efficiency,
    placedCount: sheet.placedCount,
    spacingCheck: inspectSheetSpacing(sheet, config.spacing)
  }));

console.log(JSON.stringify({
  timeMs: result.timeMs,
  totalSheets: result.totalSheets,
  efficiency: result.efficiency,
  placedCount: result.placedCount,
  tailSheets,
  lowestSheets
}, null, 2));
