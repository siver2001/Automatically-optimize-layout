/**
 * diecutRoutes.js - API Endpoint cho Die-Cut Nesting
 *
 * Các route:
 * POST /api/diecut/parse-dxf       - Upload DXF, trả về danh sách polygon + size
 * POST /api/diecut/nest            - Chạy thuật toán True Shape Nesting
 * POST /api/diecut/parse-excel     - Upload Excel Form, trả về danh sách size + số lượng
 * POST /api/diecut/test-capacity   - Test: tính số lượng tối đa xếp được trên 1 tấm PU
 */

import express from 'express';
import multer from 'multer';
import {
  parseCadBufferToPolygons,
  parseCadBufferToSizedShapesWithAnalysis,
  assignSizesToPolygons
} from '../algorithms/diecut/core/dxfParser.js';
import { NestingNormalPairing } from '../algorithms/diecut/strategies/normal/NestingNormalPairing.js';
import { NestingNormalPiece } from '../algorithms/diecut/strategies/normal/NestingNormalPiece.js';
import {
  applyLayersToSizeList,
  buildNestingPlanSummary,
  finalizeNestingResult,
  normalizeLayers,
  normalizeNestingStrategy
} from '../algorithms/diecut/strategies/normal/nestingPlanUtils.js';
import { runNestingMode } from '../algorithms/diecut/strategies/normal/runNestingMode.js';
import { CapacityTestComplementaryPattern } from '../algorithms/diecut/strategies/capacity/CapacityTestComplementaryPattern.js';
import { CapacityTestSameSidePattern } from '../algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { generateDieCutPdf } from '../utils/diecutPdfGenerator.js';

function enforceMonotonicity(summary, sheetsBySize) {
  if (!Array.isArray(summary) || summary.length <= 1) return;

  const sortedSummary = [...summary].sort((a, b) => {
    const valA = typeof a.sizeValue === 'number' ? a.sizeValue : parseFloat(a.sizeValue || 0);
    const valB = typeof b.sizeValue === 'number' ? b.sizeValue : parseFloat(b.sizeValue || 0);
    return valB - valA;
  });

  let runningMaxPlaced = 0;
  let runningMaxPairs = 0;
  const sizeToMonotonicCount = new Map();

  for (const item of sortedSummary) {
    const currentPlaced = item.placedCount || item.totalPieces || 0;
    const currentPairs = item.pairs || 0;

    if (currentPlaced > runningMaxPlaced) {
      runningMaxPlaced = currentPlaced;
    }
    if (currentPairs > runningMaxPairs) {
      runningMaxPairs = currentPairs;
    }

    sizeToMonotonicCount.set(item.sizeName, {
      placedCount: runningMaxPlaced,
      pairs: runningMaxPairs
    });
  }

  for (const item of summary) {
    const enforced = sizeToMonotonicCount.get(item.sizeName);
    if (enforced) {
      if (enforced.placedCount > (item.placedCount || 0)) {
        item.placedCount = enforced.placedCount;
      }
      if (enforced.placedCount > (item.totalPieces || 0)) {
        item.totalPieces = enforced.placedCount;
      }
      if (enforced.pairs > (item.pairs || 0)) {
        item.pairs = enforced.pairs;
      }

      if (sheetsBySize && sheetsBySize[item.sizeName]) {
        const sheet = sheetsBySize[item.sizeName];
        // Keep the physical placement count corresponding strictly to valid elements
        if (sheet.placed && sheet.placed.length > 0) {
          sheet.placedCount = sheet.placed.length;
        }
      }
    }
  }
}

import { generateDieCutDxf } from '../utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../utils/diecutCycGenerator.js';
import { sanitizeExportFileName, getExportBaseName } from '../utils/diecutExportUtils.js';
import {
  getDieCutNestingResult,
  getDieCutNestingSheetDetail,
  getDieCutNestingSheetDetails,
  storeDieCutNestingResult
} from '../utils/diecutNestingResultCache.js';

const DEFAULT_DIECUT_UI_CONFIG = {
  sheetWidth: 1070,
  sheetHeight: 1970,
  spacing: 3,
  staggerSpacing: 3,
  marginX: 5,
  marginY: 5,
  allowRotate90: true,
  allowRotate180: true,
  gridStep: 0.5,
  pairingStrategy: 'pair',
  mirrorPairs: true,
  capacityLayoutMode: 'pair-complementary',
  layers: 1,
  nestingStrategy: 'single-size-per-sheet'
};

function numberFromUi(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveCapacityLayoutMode(pairingStrategy, capacityLayoutMode) {
  if (capacityLayoutMode === 'same-side-double-contour') return 'same-side-double-contour';
  if (pairingStrategy === 'pair') return 'same-side-double-contour';
  if (capacityLayoutMode === 'same-side-orthogonal') return 'same-side-orthogonal';
  return 'same-side-banded';
}

function buildDieCutConfigFromUi(body = {}, options = {}) {
  const resolvedPairingStrategy = body.pairingStrategy
    || (body.mirrorPairs !== false ? 'pair' : 'same-side');
  const resolvedCapacityLayoutMode = resolveCapacityLayoutMode(
    resolvedPairingStrategy,
    body.capacityLayoutMode
  );
  const spacing = numberFromUi(body.spacing, DEFAULT_DIECUT_UI_CONFIG.spacing);

  return {
    sheetWidth: numberFromUi(body.sheetWidth, DEFAULT_DIECUT_UI_CONFIG.sheetWidth),
    sheetHeight: numberFromUi(body.sheetHeight, DEFAULT_DIECUT_UI_CONFIG.sheetHeight),
    spacing,
    staggerSpacing: numberFromUi(body.staggerSpacing, body.staggerSpacing == null ? spacing : DEFAULT_DIECUT_UI_CONFIG.staggerSpacing),
    marginX: numberFromUi(body.marginX, DEFAULT_DIECUT_UI_CONFIG.marginX),
    marginY: numberFromUi(body.marginY, DEFAULT_DIECUT_UI_CONFIG.marginY),
    allowRotate90: body.allowRotate90 ?? DEFAULT_DIECUT_UI_CONFIG.allowRotate90,
    allowRotate180: body.allowRotate180 ?? DEFAULT_DIECUT_UI_CONFIG.allowRotate180,
    mirrorPairs: resolvedPairingStrategy !== 'same-side',
    pairingStrategy: resolvedPairingStrategy,
    capacityLayoutMode: resolvedCapacityLayoutMode,
    gridStep: numberFromUi(body.gridStep, DEFAULT_DIECUT_UI_CONFIG.gridStep),
    layers: normalizeLayers(body.layers ?? DEFAULT_DIECUT_UI_CONFIG.layers),
    nestingStrategy: normalizeNestingStrategy(body.nestingStrategy ?? DEFAULT_DIECUT_UI_CONFIG.nestingStrategy),
    maxTimeMs: options.maxTimeMs ?? 60000
  };
}

import ExcelJS from 'exceljs';

const router = express.Router();

// Multer: lưu file upload vào RAM (memoryStorage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

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

// ─────────────────────────────────────────
// 1. PARSE DXF → POLYGON LIST
// ─────────────────────────────────────────
router.post('/parse-dxf', upload.array('dxfFiles', 20), async (req, res) => {
  try {
    const startSize = parseFloat(req.body.startSize) || 3.0;
    const stepSize = parseFloat(req.body.stepSize) || 0.5;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Chưa upload file DXF' });
    }

    if (req.files.length === 1) {
      const [file] = req.files;
      const { shapes, importAnalysis } = await parseCadBufferToSizedShapesWithAnalysis(
        file.buffer,
        file.originalname,
        startSize,
        stepSize
      );

      if (shapes.length === 0) {
        return res.status(400).json({ error: 'Không tìm thấy biên dạng hợp lệ trong file DXF' });
      }

      // Sắp xếp danh sách shapes theo thứ tự size tăng dần
      shapes.sort((a, b) => (a.sizeValue || 0) - (b.sizeValue || 0));

      return res.json({
        success: true,
        shapes,
        count: shapes.length,
        importAnalysis
      });
    }

    let allPolygons = [];

    for (const file of req.files) {
      const polygons = await parseCadBufferToPolygons(file.buffer, file.originalname);
      allPolygons = allPolygons.concat(polygons);
    }

    if (allPolygons.length === 0) {
      return res.status(400).json({ error: 'Không tìm thấy biên dạng hợp lệ trong file DXF' });
    }

    const sizedShapes = assignSizesToPolygons(allPolygons, startSize, stepSize);

    // Sắp xếp danh sách shapes theo thứ tự size tăng dần
    sizedShapes.sort((a, b) => (a.sizeValue || 0) - (b.sizeValue || 0));

    res.json({
      success: true,
      shapes: sizedShapes,
      count: sizedShapes.length,
      importAnalysis: null
    });
  } catch (err) {
    console.error('[DieCut] parse-dxf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// 2. PARSE EXCEL → SIZE + QUANTITY LIST
// ─────────────────────────────────────────
router.post('/parse-excel', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Chưa upload file Excel' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const result = [];

    workbook.eachSheet((worksheet) => {
      let headerRow = null;
      let totalRow = null;
      let fallbackHeaderRow = null;

      worksheet.eachRow((row) => {
        const vals = getWorksheetPrimitiveValues(row);
        const numericVals = getNumericSizeValues(vals);

        if (numericVals.length >= 3) {
          if (!fallbackHeaderRow) {
            fallbackHeaderRow = vals;
          }
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
        const n = Number(val);
        if (Number.isFinite(n) && n >= 3 && n <= 20) {
          sizeMap[idx] = n.toFixed(1);
        }
      });

      const quantities = {};
      totalRow.vals.forEach((val, idx) => {
        if (sizeMap[idx] !== undefined) {
          const qty = Math.round(Number(String(val).replace(/,/g, '')));
          if (Number.isFinite(qty) && qty > 0) {
            quantities[sizeMap[idx]] = (quantities[sizeMap[idx]] || 0) + qty;
          }
        }
      });

      const orderName = worksheet.name;

      Object.entries(quantities).forEach(([sizeName, pairQty]) => {
        result.push({
          orderName,
          sizeName,
          sizeValue: parseFloat(sizeName),
          pairQuantity: pairQty,
          pieceQuantity: pairQty * 2
        });
      });
    });

    if (result.length === 0) {
      return res.status(400).json({ error: 'Không đọc được dữ liệu size/số lượng từ file Excel' });
    }

    res.json({ success: true, sizeQuantities: result });
  } catch (err) {
    console.error('[DieCut] parse-excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// 3. CHẠY THUẬT TOÁN NESTING
// ─────────────────────────────────────────
router.post('/nest', async (req, res) => {
  try {
    const {
      sizeList,
      sheetWidth,
      sheetHeight,
      spacing,
      staggerSpacing,
      marginX,
      marginY,
      allowRotate90,
      allowRotate180,
      gridStep,
      mirrorPairs,
      pairingStrategy,
      capacityLayoutMode,
      layers,
      nestingStrategy
    } = req.body;

    if (!sizeList || sizeList.length === 0) {
      return res.status(400).json({ error: 'Danh sách size rỗng' });
    }

    const config = buildDieCutConfigFromUi(req.body, { maxTimeMs: 60000 });

    const createNester = () => (
      config.pairingStrategy === 'same-side' || config.mirrorPairs === false
        ? new NestingNormalPiece(config)
        : new NestingNormalPairing(config)
    );

    const plannedSizeList = applyLayersToSizeList(sizeList, config.layers);
    const planSummary = buildNestingPlanSummary(sizeList, plannedSizeList, config);

    if (planSummary.plannedPairs <= 0) {
      return res.status(400).json({ error: 'Khong co so luong hop le de nesting sau khi chia layers' });
    }

    const result = await runNestingMode({
      sizeList: plannedSizeList,
      createNester,
      config,
      metadata: {
        layers: config.layers,
        nestingStrategy: config.nestingStrategy,
        planningSummary: planSummary
      }
    });

    const finalizedResult = finalizeNestingResult(result, config, {
      layers: config.layers,
      nestingStrategy: config.nestingStrategy,
      planningSummary: planSummary
    });

    const compactResult = storeDieCutNestingResult(finalizedResult);
    res.json({
      success: true,
      ...compactResult,
      effectiveConfig: config
    });
  } catch (err) {
    console.error('[DieCut] nest error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/nest-sheet-detail', async (req, res) => {
  try {
    const { resultId, sheetIndex } = req.body || {};
    if (!resultId) {
      return res.status(400).json({ error: 'Thieu resultId de tai chi tiet tam.' });
    }

    const sheet = getDieCutNestingSheetDetail(resultId, sheetIndex);
    if (!sheet) {
      return res.status(404).json({ error: 'Khong tim thay chi tiet tam hoac du lieu da het han.' });
    }

    res.json({ success: true, sheet });
  } catch (err) {
    console.error('[DieCut] nest-sheet-detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/nest-sheet-details', async (req, res) => {
  try {
    const { resultId, sheetIndexes } = req.body || {};
    if (!resultId) {
      return res.status(400).json({ error: 'Thieu resultId de tai chi tiet tam.' });
    }

    const sheets = getDieCutNestingSheetDetails(resultId, sheetIndexes);
    res.json({ success: true, sheets });
  } catch (err) {
    console.error('[DieCut] nest-sheet-details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// 4. TEST CAPACITY: Số lượng tối đa trên 1 tấm PU
// ─────────────────────────────────────────
router.post('/test-capacity', async (req, res) => {
  try {
    const {
      sizeList,
      sheetWidth,
      sheetHeight,
      spacing,
      staggerSpacing,
      marginX,
      marginY,
      allowRotate90,
      allowRotate180,
      gridStep,
      mirrorPairs,
      pairingStrategy,
      capacityLayoutMode
    } = req.body;

    if (!sizeList || sizeList.length === 0) {
      return res.status(400).json({ error: 'Danh sách size rỗng' });
    }

    const configFromUi = buildDieCutConfigFromUi(req.body, { maxTimeMs: 120000 });
    const config = {
      ...configFromUi,
      parallelSizes: true,
      preparedSplitFillEnabled: true,
      preparedSplitFillDeep: true
    };


    const totalArea = config.sheetWidth * config.sheetHeight;
    const startTime = Date.now();

    let nester;

    const io = req.app.get('io');
    const onProgress = (sizeName, status) => {
      if (io) {
        io.emit('test-capacity-progress', { sizeName, status });
      }
    };

    let result;
    if (config.pairingStrategy === 'pair' && config.mirrorPairs !== false) {
      nester = new CapacityTestComplementaryPattern({
        ...config,
        capacityLayoutMode: 'pair-complementary',
        pairingStrategy: 'pair',
        mirrorPairs: true
      });
      result = await nester.testCapacity(sizeList, config, onProgress);

      if (Array.isArray(result.summary)) {
        for (const item of result.summary) {
          const pairs = item.placedCount || item.totalPieces || 0;
          item.placedCount = pairs * 2;
          item.totalPieces = pairs * 2;
          item.pairs = pairs; 
          if (result.sheetsBySize && result.sheetsBySize[item.sizeName]) {
            result.sheetsBySize[item.sizeName].placedCount = pairs * 2;
          }
        }
      }
    } else {
      if (config.capacityLayoutMode === 'same-side-double-contour') {
        nester = new CapacityTestDoubleInsoleDoubleContourPattern({
          ...config,
          capacityLayoutMode: 'same-side-double-contour',
          pairingStrategy: 'same-side',
          mirrorPairs: false
        });
      } else {
        nester = new CapacityTestSameSidePattern({
          ...config,
          capacityLayoutMode: config.capacityLayoutMode || 'same-side-banded',
          pairingStrategy: 'same-side',
          mirrorPairs: false
        });
      }
      
      result = await nester.testCapacity(sizeList, config, onProgress);
    }

    if (result && Array.isArray(result.summary)) {
      const isDoubleContour = result.mode?.includes('double-contour');
      result.summary = result.summary.map(item => {
        if (isDoubleContour) {
          // Preserve backend's accurate pieces and pairs
          return item;
        }

        let rawBlocks = 0;
        if (result.sheetsBySize && result.sheetsBySize[item.sizeName] && result.sheetsBySize[item.sizeName].placed) {
          rawBlocks = result.sheetsBySize[item.sizeName].placed.length;
        } else {
          rawBlocks = item.pairs || item.placedCount || item.totalPieces || 0;
        }
        
        // For non-double strategies, we still need to map blocks to pieces/pairs
        const pieces = rawBlocks * 2;
        const mappedItem = {
          ...item,
          placedCount: pieces,
          totalPieces: pieces,
          pairs: rawBlocks
        };

        if (result.sheetsBySize && result.sheetsBySize[item.sizeName]) {
          result.sheetsBySize[item.sizeName] = {
            ...result.sheetsBySize[item.sizeName],
            placedCount: pieces,
            pairs: rawBlocks
          };
        }

        return mappedItem;
      });
    }

    // Sắp xếp summary theo thứ tự sizeValue tăng dần để đảm bảo giao diện hiển thị đúng thứ tự
    if (result && Array.isArray(result.summary)) {
      const parseSizeNameToValue = (name) => {
        if (typeof name === 'number') return name;
        const str = String(name || '').trim();
        if (!str) return 0;
        const fractionMatch = str.match(/(\d+)\s*[- ]\s*(\d+)\/(\d+)/);
        if (fractionMatch) {
          return parseInt(fractionMatch[1], 10) + (parseInt(fractionMatch[2], 10) / parseInt(fractionMatch[3], 10));
        }
        const pureFractionMatch = str.match(/^(\d+)\/(\d+)$/);
        if (pureFractionMatch) {
          return parseInt(pureFractionMatch[1], 10) / parseInt(pureFractionMatch[2], 10);
        }
        const val = parseFloat(str);
        return Number.isFinite(val) ? val : 0;
      };

      result.summary.sort((a, b) => {
        const valA = typeof a.sizeValue === 'number' ? a.sizeValue : parseSizeNameToValue(a.sizeName || a.name || 0);
        const valB = typeof b.sizeValue === 'number' ? b.sizeValue : parseSizeNameToValue(b.sizeName || b.name || 0);
        return valA - valB;
      });
    }

    // Removed enforceMonotonicity call to ensure UI matches physical layout exactly

    // Performance optimization: strip heavy polygon coordinate arrays from response.
    // The frontend uses renderTemplates (SVG paths) for display, so full polygon data
    // is not needed. This reduces JSON payload from ~15-20MB to ~1-2MB.
    const compactSheetForCapacity = (sheet) => {
      if (!sheet?.placed) return sheet;
      return {
        ...sheet,
        placed: sheet.placed.map(item => {
          const { polygon, internals, ...lightweight } = item;
          return {
            ...lightweight,
            // Preserve area for efficiency calculations
            area: item.areaMm2 || item.area || 0,
            // Preserve cycPolygon for CYC export
            cycPolygon: item.cycPolygon
          };
        })
      };
    };

    if (result.sheetsBySize) {
      for (const sizeName of Object.keys(result.sheetsBySize)) {
        if (result.sheetsBySize[sizeName]) {
          result.sheetsBySize[sizeName] = compactSheetForCapacity(result.sheetsBySize[sizeName]);
        }
      }
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? result.sheetsBySize?.[defaultSizeName] : null;

    if (defaultSheet && result.sheet) {
      result.sheet = {
         ...result.sheet,
         placedCount: defaultSheet.placedCount,
         pairs: defaultSheet.pairs
      };
    }

    const compactResult = {
      ...result,
      success: true,
      effectiveConfig: config,
      timeMs: Date.now() - startTime,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      sheet: defaultSheet || (result.sheet ? compactSheetForCapacity(result.sheet) : result.sheet)
    };

    res.json(compactResult);
    return;


  } catch (err) {
    console.error('[DieCut] test-capacity error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/export-pdf', (req, res) => {
  try {
    let { sheets, sheetWidth, sheetHeight, sizeList, title, subtitle, fileNameBase, resultId } = req.body;

    if ((!Array.isArray(sheets) || sheets.length === 0) && resultId) {
      const cachedResult = getDieCutNestingResult(resultId);
      sheets = cachedResult?.sheets || [];
      sheetWidth = sheetWidth || cachedResult?.sheets?.[0]?.sheetWidth;
      sheetHeight = sheetHeight || cachedResult?.sheets?.[0]?.sheetHeight;
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: 'Khong co du lieu sheet de xuat PDF.' });
    }

    const sheetCount = sheets.length;
    const sizeStr = `${sheetWidth}x${sheetHeight}`;
    let baseName = fileNameBase;
    
    if (!baseName) {
      baseName = `nesting-diecut-${sizeStr}-${sheetCount}sheets`;
    } else {
      if (!baseName.includes(sizeStr)) baseName += `-${sizeStr}`;
      if (!baseName.includes('sheet')) baseName += `-${sheetCount}sheets`;
    }

    const safeFileName = `${sanitizeExportFileName(baseName, 'nesting-diecut')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);

    generateDieCutPdf({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      title,
      subtitle
    }, res);
  } catch (err) {
    console.error('[DieCut] export-pdf error:', err);
    res.status(500).json({ error: err.message || 'Khong the tao file PDF.' });
  }
});

function resolveDieCutExportSizeNames(sheets = [], sizeList = []) {
  const names = new Set();

  for (const sheet of sheets || []) {
    for (const item of sheet?.placed || []) {
      const sizeName = String(item?.sizeName || '').trim();
      if (sizeName) names.add(sizeName);
    }
  }

  if (!names.size) {
    for (const size of sizeList || []) {
      const sizeName = String(size?.sizeName || size || '').trim();
      if (sizeName) names.add(sizeName);
    }
  }

  return [...names].sort((left, right) => {
    const numericLeft = Number(left);
    const numericRight = Number(right);
    if (Number.isFinite(numericLeft) && Number.isFinite(numericRight)) {
      return numericLeft - numericRight;
    }
    return left.localeCompare(right, undefined, { numeric: true });
  });
}

function buildDieCutExportSizePart(sheets = [], sizeList = []) {
  const sizeNames = resolveDieCutExportSizeNames(sheets, sizeList);
  if (sizeNames.length === 1) return `size-${sizeNames[0]}`;
  if (sizeNames.length > 1) return `sizes-${sizeNames.join('-')}`;
  return 'size-unknown';
}

router.post('/export-dxf', (req, res) => {
  try {
    let {
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      title,
      subtitle,
      fileNameBase,
      resultId,
      labelMode,
      toolCodeMap,
      includeSizeInFileName = false
    } = req.body;

    if ((!Array.isArray(sheets) || sheets.length === 0) && resultId) {
      const cachedResult = getDieCutNestingResult(resultId);
      sheets = cachedResult?.sheets || [];
      sheetWidth = sheetWidth || cachedResult?.sheets?.[0]?.sheetWidth;
      sheetHeight = sheetHeight || cachedResult?.sheets?.[0]?.sheetHeight;
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: 'Khong co du lieu sheet de xuat DXF.' });
    }

    const sheetCount = sheets.length;
    const resolvedSheetWidth = sheetWidth || sheets[0]?.sheetWidth;
    const resolvedSheetHeight = sheetHeight || sheets[0]?.sheetHeight;
    const baseName = getExportBaseName({
      fileNameBase,
      sizeList,
      sheetWidth: resolvedSheetWidth,
      sheetHeight: resolvedSheetHeight,
      sheetIndex: sheets[0]?.sheetIndex ?? 0,
      sheetCount
    });

    const safeFileName = `${sanitizeExportFileName(baseName, 'nesting-diecut')}.DXF`;
    const dxfContent = generateDieCutDxf({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      labelMode,
      toolCodeMap,
      title,
      subtitle
    });

    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.send(dxfContent);
  } catch (err) {
    console.error('[DieCut] export-dxf error:', err);
    res.status(500).json({ error: err.message || 'Khong the tao file DXF.' });
  }
});

router.post('/export-cyc', (req, res) => {
  try {
    let {
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      title,
      subtitle,
      fileNameBase,
      resultId,
      labelMode,
      toolCodeMap
    } = req.body;

    if ((!Array.isArray(sheets) || sheets.length === 0) && resultId) {
      const cachedResult = getDieCutNestingResult(resultId);
      sheets = cachedResult?.sheets || [];
      sheetWidth = sheetWidth || cachedResult?.sheets?.[0]?.sheetWidth;
      sheetHeight = sheetHeight || cachedResult?.sheets?.[0]?.sheetHeight;
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: 'Khong co du lieu sheet de xuat CYC.' });
    }

    if (sheets.length !== 1) {
      return res.status(400).json({ error: 'CYC chi cho phep xuat tung tam mot de dam bao giong file mau.' });
    }


    const resolvedSheetWidth = sheetWidth || sheets[0]?.sheetWidth;
    const resolvedSheetHeight = sheetHeight || sheets[0]?.sheetHeight;
    const baseName = getExportBaseName({
      fileNameBase,
      sizeList,
      sheetWidth: resolvedSheetWidth,
      sheetHeight: resolvedSheetHeight,
      sheetIndex: sheets[0]?.sheetIndex ?? 0,
      sheetCount: 1
    });

    const safeFileName = `${sanitizeExportFileName(baseName, 'nesting-diecut')}.CYC`;
    const cycContent = generateDieCutCyc({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      labelMode,
      toolCodeMap,
      title,
      subtitle
    });

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.send(cycContent);
  } catch (err) {
    console.error('[DieCut] export-cyc error:', err);
    res.status(500).json({ error: err.message || 'Khong the tao file CYC.' });
  }
});

export default router;
