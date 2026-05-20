import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

function getBoundingBox(pts) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const pt of pts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Running tightness analysis for ${testSizes.length} sizes...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=================================== ĐỘ KHÍT CHI TIẾT CÁC SIZE ===================================");
  console.log("Size  | Cặp xếp được | Rìa Biên Phải (Right Splits)      | Rìa Biên Dưới (Bottom Splits)");
  console.log("      |              | X-Gap (Cột với Mảnh Nguyên)       | Y-Gap (Hàng với Mảnh Nguyên)");
  console.log("-------------------------------------------------------------------------------------------------");
  
  for (const item of (res.summary || [])) {
    const sizeName = item.sizeName;
    const sheet = res.sheetsBySize ? res.sheetsBySize[sizeName] : null;
    
    if (!sheet || !sheet.placed || sheet.placed.length === 0) {
      console.log(`Size: ${sizeName.padEnd(5)} | Không có dữ liệu sắp xếp.`);
      continue;
    }
    
    // Filter wholes and splits
    const wholes = [];
    const rightSplits = [];
    const bottomSplits = [];
    
    for (const p of sheet.placed) {
      const isSplit = p.id.startsWith('margin_fill_') || p.id.startsWith('split_') || p.isSplit || p.foot?.startsWith('split-');
      if (!isSplit) {
        wholes.push(p);
      } else {
        const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || p.polygon || []);
        // Match the same logic used to identify right/bottom splits
        const isRightMargin = p.x + bb.maxX > config.sheetWidth - 10 - 350;
        const isBottomMargin = p.y + bb.maxY > config.sheetHeight - 40 - 350;
        const isVertical = bb.height > bb.width;
        const isHorizontal = bb.width > bb.height;
        
        if (isRightMargin && isVertical) {
          rightSplits.push({ p, bb });
        } else if (isBottomMargin && isHorizontal) {
          bottomSplits.push({ p, bb });
        }
      }
    }
    
    // Compute whole envelope
    let maxWholeX = -Infinity;
    let maxWholeY = -Infinity;
    for (const w of wholes) {
      const poly = w.polygon || [];
      for (const pt of poly) {
        if (pt.x > maxWholeX) maxWholeX = pt.x;
        if (pt.y > maxWholeY) maxWholeY = pt.y;
      }
    }
    
    // Compute right splits minX
    let minSplitX = Infinity;
    for (const rs of rightSplits) {
      const poly = rs.p.polygon || [];
      for (const pt of poly) {
        if (pt.x < minSplitX) minSplitX = pt.x;
      }
    }
    
    // Compute bottom splits minY
    let minSplitY = Infinity;
    for (const bs of bottomSplits) {
      const poly = bs.p.polygon || [];
      for (const pt of poly) {
        if (pt.y < minSplitY) minSplitY = pt.y;
      }
    }
    
    const rightGap = rightSplits.length > 0 ? (minSplitX - maxWholeX) : null;
    const bottomGap = bottomSplits.length > 0 ? (minSplitY - maxWholeY) : null;
    
    const rightGapStr = rightGap !== null 
      ? `${rightGap.toFixed(1)} mm ${rightGap <= 5 ? '(Ép Sát Hoàn Hảo ✓)' : '(Còn Khe Hở)'}`
      : 'Không có mảnh biên phải';
      
    const bottomGapStr = bottomGap !== null
      ? `${bottomGap.toFixed(1)} mm ${bottomGap <= 5 ? '(Ép Sát Hoàn Hảo ✓)' : '(Còn Khe Hở)'}`
      : 'Không có mảnh biên dưới';
      
    console.log(
      `${sizeName.padEnd(5)} | ` +
      `${String(item.pairs).padEnd(12)} | ` +
      `${rightGapStr.padEnd(41)} | ` +
      `${bottomGapStr}`
    );
  }
  console.log("=================================================================================================");
}

run().catch(console.error);
