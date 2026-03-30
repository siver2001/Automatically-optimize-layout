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
import { parseDxfToPolygons, assignSizesToPolygons } from '../algorithms/diecut/core/dxfParser.js';
// Các thuật toán cũ (giữ lại để tương thích nếu cần, hoặc có thể xóa sau)
import { TrueShapeNesting } from '../algorithms/diecut/TrueShapeNesting.js';
// Các thuật toán mới tách ra
import { NestingNormalPairing } from '../algorithms/diecut/strategies/normal/NestingNormalPairing.js';
import { NestingNormalPiece } from '../algorithms/diecut/strategies/normal/NestingNormalPiece.js';
import { applyLayersToSizeList, buildNestingPlanSummary, normalizeLayers, normalizeNestingStrategy } from '../algorithms/diecut/strategies/normal/nestingPlanUtils.js';
import { runNestingMode } from '../algorithms/diecut/strategies/normal/runNestingMode.js';
import { CapacityTestPairing } from '../algorithms/diecut/strategies/capacity/CapacityTestPairing.js';
import { CapacityTestSameSidePattern } from '../algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestComplementaryPattern } from '../algorithms/diecut/strategies/capacity/CapacityTestComplementaryPattern.js';
import { generateDieCutPdf } from '../utils/diecutPdfGenerator.js';
import { generateDieCutDxf } from '../utils/diecutDxfGenerator.js';
import { sanitizeExportFileName } from '../utils/diecutExportUtils.js';
import {
  getDieCutNestingResult,
  getDieCutNestingSheetDetail,
  storeDieCutNestingResult
} from '../utils/diecutNestingResultCache.js';

import { area as polygonArea } from '../algorithms/diecut/core/polygonUtils.js';
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

    let allPolygons = [];

    for (const file of req.files) {
      const dxfText = file.buffer.toString('utf-8');
      const polygons = parseDxfToPolygons(dxfText);
      allPolygons = allPolygons.concat(polygons);
    }

    if (allPolygons.length === 0) {
      return res.status(400).json({ error: 'Không tìm thấy biên dạng hợp lệ trong file DXF' });
    }

    const sizedShapes = assignSizesToPolygons(allPolygons, startSize, stepSize);

    res.json({
      success: true,
      shapes: sizedShapes,
      count: sizedShapes.length
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
      layers,
      nestingStrategy
    } = req.body;

    if (!sizeList || sizeList.length === 0) {
      return res.status(400).json({ error: 'Danh sách size rỗng' });
    }

    const config = {
      sheetWidth: sheetWidth || 1400,
      sheetHeight: sheetHeight || 700,
      spacing: spacing ?? 2,
      staggerSpacing: staggerSpacing ?? spacing ?? 2,
      marginX: marginX ?? 5,
      marginY: marginY ?? 5,
      allowRotate90: allowRotate90 !== false,
      allowRotate180: allowRotate180 !== false,
      mirrorPairs: mirrorPairs !== false,
      pairingStrategy: pairingStrategy || (mirrorPairs !== false ? 'pair' : 'same-side'),
      gridStep: gridStep ?? 0.5,
      layers: normalizeLayers(layers),
      nestingStrategy: normalizeNestingStrategy(nestingStrategy),
      maxTimeMs: 60000
    };

    const { nestStrategy } = req.body; // 'pair' hoặc 'piece'
    const createNester = () => {
      if (nestStrategy === 'piece' || (!config.mirrorPairs && config.pairingStrategy === 'same-side')) {
        return new NestingNormalPiece(config);
      }
      return new NestingNormalPairing(config);
    };

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

    const compactResult = storeDieCutNestingResult(result);
    res.json({ success: true, ...compactResult });
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

    const resolvedPairingStrategy = pairingStrategy || (mirrorPairs !== false ? 'pair' : 'same-side');
    const resolvedCapacityLayoutMode = capacityLayoutMode === 'legacy-pair'
      ? 'legacy-pair'
      : resolvedPairingStrategy === 'pair'
        ? 'pair-complementary'
        : 'same-side-banded';

    const config = {
      sheetWidth: sheetWidth || 1400,
      sheetHeight: sheetHeight || 700,
      spacing: spacing ?? 2,
      staggerSpacing: staggerSpacing ?? spacing ?? 2,
      marginX: marginX ?? 5,
      marginY: marginY ?? 5,
      allowRotate90: allowRotate90 !== false,
      allowRotate180: allowRotate180 !== false,
      mirrorPairs: mirrorPairs !== false,
      pairingStrategy: resolvedPairingStrategy,
      gridStep: gridStep || 2,
      maxTimeMs: 120000,
      capacityLayoutMode: resolvedCapacityLayoutMode
    };

    const totalArea = config.sheetWidth * config.sheetHeight;
    const startTime = Date.now();

    let nester;

    if (config.pairingStrategy === 'same-side' || config.mirrorPairs === false) {
      nester = new CapacityTestSameSidePattern({
        ...config,
        capacityLayoutMode: 'same-side-banded',
        pairingStrategy: 'same-side',
        mirrorPairs: false
      });
    } else if (config.capacityLayoutMode === 'legacy-pair') {
      nester = new CapacityTestPairing(config);
    } else if (config.pairingStrategy === 'pair' && config.mirrorPairs !== false) {
      nester = new CapacityTestComplementaryPattern({
        ...config,
        capacityLayoutMode: 'pair-complementary',
        pairingStrategy: 'pair',
        mirrorPairs: true
      });
    } else {
      nester = new CapacityTestPairing(config);
    }

    const result = await nester.testCapacity(sizeList, config);

    // Kết quả từ testCapacity đã bao gồm summary và sheetsBySize
    res.json(result);
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

    const safeFileName = `${sanitizeExportFileName(fileNameBase, 'diecut-layouts')}.pdf`;
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
    let { sheets, sheetWidth, sheetHeight, sizeList, title, subtitle, fileNameBase, resultId } = req.body;

    if ((!Array.isArray(sheets) || sheets.length === 0) && resultId) {
      const cachedResult = getDieCutNestingResult(resultId);
      sheets = cachedResult?.sheets || [];
      sheetWidth = sheetWidth || cachedResult?.sheets?.[0]?.sheetWidth;
      sheetHeight = sheetHeight || cachedResult?.sheets?.[0]?.sheetHeight;
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: 'Khong co du lieu sheet de xuat DXF.' });
    }

    const safeFileName = `${sanitizeExportFileName(fileNameBase, 'diecut-layouts')}.dxf`;
    const dxfContent = generateDieCutDxf({
      sheets,
      sheetWidth,
      sheetHeight,
      sizeList,
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

export default router;
