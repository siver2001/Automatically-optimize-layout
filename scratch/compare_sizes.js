import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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

  for (const sizeName of ['4.5', '5', '5.5']) {
    console.log(`\n================= SIZE ${sizeName} =================`);
    const shape = shapes.find(s => String(s.sizeName || s.name) === sizeName);
    if (!shape) continue;

    const res = await engine.testCapacity([shape], config);
    const sheet = res.sheetsBySize[sizeName];
    if (!sheet) continue;

    // We will group the original placed items (without DXF coordinate transformations)
    const placed = sheet.placed;
    const sortedByY = [...placed].sort((a, b) => b.y - a.y);
    const rows = [];
    const Y_THRESHOLD = 75.0;

    for (const item of sortedByY) {
      if (rows.length === 0) {
        rows.push([item]);
      } else {
        const lastRow = rows[rows.length - 1];
        const avgY = lastRow.reduce((sum, k) => sum + k.y, 0) / lastRow.length;
        if (Math.abs(item.y - avgY) < Y_THRESHOLD) {
          lastRow.push(item);
        } else {
          rows.push([item]);
        }
      }
    }

    // Print the bottom row (which is the first row since sortedByY is descending Y, so bottom of the sheet first)
    const bottomRow = rows[0];
    const sortedRow = [...bottomRow].sort((a, b) => a.x - b.x);
    console.log(`Bottom Row (len=${sortedRow.length}):`);
    for (const item of sortedRow) {
      console.log(`  X: ${item.x.toFixed(1)} | Y: ${item.y.toFixed(1)} | Foot: ${item.foot} | Size: ${item.sizeName} | Angle: ${item.angle}`);
    }
  }
}

run().catch(console.error);
