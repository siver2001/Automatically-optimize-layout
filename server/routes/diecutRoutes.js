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
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { generateDieCutPdf } from '../utils/diecutPdfGenerator.js';
import { generateDieCutDxf } from '../utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../utils/diecutCycGenerator.js';
import { sanitizeExportFileName } from '../utils/diecutExportUtils.js';
import {
  getDieCutNestingResult,
  getDieCutNestingSheetDetail,
  getDieCutNestingSheetDetails,
  storeDieCutNestingResult
} from '../utils/diecutNestingResultCache.js';

const DEFAULT_DIECUT_UI_CONFIG = {
  sheetWidth: 1100,
  sheetHeight: 2000,
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
  if (pairingStrategy === 'pair') return 'pair-complementary';
  if (capacityLayoutMode === 'same-side-double-contour') return 'same-side-double-contour';
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

    const config = {
      ...buildDieCutConfigFromUi(req.body, { maxTimeMs: 120000 }),
      parallelSizes: true,
      preparedSplitFillDeep: false
    };

    const totalArea = config.sheetWidth * config.sheetHeight;
    const startTime = Date.now();

    let nester;

    if (config.pairingStrategy === 'pair' && config.mirrorPairs !== false) {
      nester = new CapacityTestComplementaryPattern({
        ...config,
        capacityLayoutMode: 'pair-complementary',
        pairingStrategy: 'pair',
        mirrorPairs: true
      });
    } else if (config.capacityLayoutMode === 'same-side-double-contour') {
      nester = new CapacityTestDoubleInsoleDoubleContourPattern({
        ...config,
        capacityLayoutMode: 'same-side-double-contour',
        pairingStrategy: 'same-side',
        mirrorPairs: false
      });
    } else {
      nester = new CapacityTestSameSidePattern({
        ...config,
        capacityLayoutMode: config.capacityLayoutMode,
        pairingStrategy: 'same-side',
        mirrorPairs: false
      });
    }

    const result = await nester.testCapacity(sizeList, config);

    // Kết quả từ testCapacity đã bao gồm summary và sheetsBySize
    res.json({
      ...result,
      effectiveConfig: config
    });
    return; // Kết thúc sớm vì result đã chứa dữ liệu trả về mong muốn
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

router.post('/export-dxf', (req, res) => {
  try {
    let { sheets, sheetWidth, sheetHeight, sizeList, title, subtitle, fileNameBase, resultId, labelMode } = req.body;

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
    const sizeStr = `${sheetWidth}x${sheetHeight}`;
    let baseName = fileNameBase;
    
    if (!baseName) {
      if (sheetCount === 1 && sheets[0].sheetIndex !== undefined) {
        baseName = `nesting-diecut-${sizeStr}-sheet${sheets[0].sheetIndex + 1}`;
      } else {
        baseName = `nesting-diecut-${sizeStr}-${sheetCount}sheets`;
      }
    } else {
      // Append info even if fileNameBase exists to ensure uniqueness as requested
      if (!baseName.includes(sizeStr)) baseName += `-${sizeStr}`;
      if (!baseName.includes('sheet')) baseName += `-${sheetCount}sheets`;
    }

    const safeFileName = `${sanitizeExportFileName(baseName, 'nesting-diecut')}.dxf`;
    const dxfContent = generateDieCutDxf({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
      labelMode,
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


    const sizeStr = `${sheetWidth}x${sheetHeight}`;
    let baseName = fileNameBase;

    if (!baseName) {
      if (sheets[0].sheetIndex !== undefined) {
        baseName = `nesting-diecut-cyc-${sizeStr}-sheet${sheets[0].sheetIndex + 1}`;
      } else {
        baseName = `nesting-diecut-cyc-${sizeStr}`;
      }
    } else {
      if (!baseName.includes(sizeStr)) baseName += `-${sizeStr}`;
      if (!baseName.includes('sheet') && sheets[0].sheetIndex !== undefined) {
        baseName += `-sheet${sheets[0].sheetIndex + 1}`;
      }
    }

    const safeFileName = `${sanitizeExportFileName(baseName, 'nesting-diecut-cyc')}.CYC`;
    const cycContent = generateDieCutCyc({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
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
