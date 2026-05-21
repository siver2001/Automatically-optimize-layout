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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate90: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const targetSizeNames = ['3.5', '4', '4.5', '7'];
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => targetSizeNames.includes(shape.sizeName));

  console.log(`Running test for sizes: ${targetSizeNames.join(', ')}...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== SUMMARY RESULT ===");
  for (const item of (res.summary || [])) {
    console.log(`Size: ${item.sizeName} | Pairs: ${item.pairs} | Efficiency: ${item.efficiency.toFixed(1)}%`);
    const sheet = res.sheetsBySize[item.sizeName];
    const placements = sheet ? (sheet.placed || sheet.placements) : null;
    if (sheet && placements) {
      console.log(`Placed count: ${placements.length}`);
      const splits = placements.filter(p => p.foot.startsWith('split-') || p.isSplit);
      console.log(`Splits count: ${splits.length}`);
    }
  }
}

run().catch(console.error);
