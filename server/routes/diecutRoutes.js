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
import { CapacityTestPairing } from '../algorithms/diecut/strategies/capacity/CapacityTestPairing.js';
import { CapacityTestSameSidePattern } from '../algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestComplementaryPattern } from '../algorithms/diecut/strategies/capacity/CapacityTestComplementaryPattern.js';

import { area as polygonArea } from '../algorithms/diecut/core/polygonUtils.js';
import ExcelJS from 'exceljs';

const router = express.Router();

// Multer: lưu file upload vào RAM (memoryStorage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

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

      worksheet.eachRow((row) => {
        const vals = row.values;

        const numericVals = vals.filter(v => {
          const n = parseFloat(v);
          return !isNaN(n) && n >= 3 && n <= 20;
        });

        if (numericVals.length >= 3 && !headerRow) {
          headerRow = vals;
        }

        const str = JSON.stringify(vals).toLowerCase();
        if ((str.includes('tổng') || str.includes('total')) && headerRow) {
          const candidates = vals.filter(v => {
            const n = parseInt(v);
            return !isNaN(n) && n >= 0;
          });

          if (candidates.length >= 3) {
            totalRow = { vals };
          }
        }
      });

      if (!headerRow || !totalRow) return;

      const sizeMap = {};
      headerRow.forEach((val, idx) => {
        const n = parseFloat(val);
        if (!isNaN(n) && n >= 3 && n <= 20) {
          sizeMap[idx] = n.toFixed(1);
        }
      });

      const quantities = {};
      totalRow.vals.forEach((val, idx) => {
        if (sizeMap[idx] !== undefined) {
          const qty = parseInt(String(val).replace(/,/g, ''), 10);
          if (!isNaN(qty) && qty > 0) {
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
      marginX,
      marginY,
      allowRotate90,
      allowRotate180,
      gridStep,
      mirrorPairs,
      pairingStrategy
    } = req.body;

    if (!sizeList || sizeList.length === 0) {
      return res.status(400).json({ error: 'Danh sách size rỗng' });
    }

    const config = {
      sheetWidth: sheetWidth || 1400,
      sheetHeight: sheetHeight || 700,
      spacing: spacing ?? 2,
      marginX: marginX ?? 5,
      marginY: marginY ?? 5,
      allowRotate90: allowRotate90 !== false,
      allowRotate180: allowRotate180 !== false,
      mirrorPairs: mirrorPairs !== false,
      pairingStrategy: pairingStrategy || (mirrorPairs !== false ? 'pair' : 'same-side'),
      gridStep: gridStep || 2,
      maxTimeMs: 60000
    };

    const { nestStrategy } = req.body; // 'pair' hoặc 'piece'
    let nester;

    if (nestStrategy === 'piece' || (mirrorPairs === false && pairingStrategy === 'same-side')) {
      nester = new NestingNormalPiece(config);
    } else {
      nester = new NestingNormalPairing(config);
    }

    const result = await nester.nest(sizeList, config);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[DieCut] nest error:', err);
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

export default router;
