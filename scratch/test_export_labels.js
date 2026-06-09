import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { normalizeDieCutExportData } from '../server/utils/diecutExportUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  for (const shape of shapes) {
    const sizeName = String(shape.sizeName || shape.name);
    console.log(`\n================= SIZE ${sizeName} =================`);
    
    const res = await engine.testCapacity([shape], config);
    const sheet = res.sheetsBySize[sizeName];
    if (!sheet) {
      console.log(`  No sheet generated for Size ${sizeName}`);
      continue;
    }

    const exportPayload = {
      sheets: [sheet],
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      sizeList: [{ sizeName, sizeValue: parseFloat(sizeName) }],
      labelMode: 'prepared-sequence',
      title: `Test Size ${sizeName}`
    };

    const normalizedData = normalizeDieCutExportData(exportPayload);
    const normalizedSheet = normalizedData.sheets[0];
    const placed = normalizedSheet.placed;

    // Group items by horizontal rows using their centroid.y coordinate
    const sortedByY = [...placed].sort((a, b) => b.centroid.y - a.centroid.y);
    const rows = [];
    const Y_THRESHOLD = 75.0;

    for (const item of sortedByY) {
      if (rows.length === 0) {
        rows.push([item]);
      } else {
        const lastRow = rows[rows.length - 1];
        const avgY = lastRow.reduce((sum, k) => sum + k.centroid.y, 0) / lastRow.length;
        if (Math.abs(item.centroid.y - avgY) < Y_THRESHOLD) {
          lastRow.push(item);
        } else {
          rows.push([item]);
        }
      }
    }

    console.log(`  Total pieces: ${placed.length}`);
    console.log(`  Rows grouped: ${rows.length}`);
    
    rows.forEach((row, rowIndex) => {
      const yValues = row.map(k => k.centroid.y);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);
      const diffY = maxY - minY;
      const isStaggered = diffY > 15.0 && row.length > 1;
      
      console.log(`    Row ${rowIndex + 1} (len=${row.length}): Y range = [${minY.toFixed(1)}, ${maxY.toFixed(1)}] | diffY = ${diffY.toFixed(1)} | isStaggered = ${isStaggered}`);
    });
  }
}

run().catch(console.error);
