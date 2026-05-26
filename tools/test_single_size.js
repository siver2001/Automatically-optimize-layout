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
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  if (testSizes.length === 0) {
    console.error("Size 7.5 not found!");
    process.exit(1);
  }

  console.log(`Running single test for Size 7.5...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== SINGLE SIZE 7.5 CAPACITY RESULT ===");
  for (const item of (res.summary || [])) {
    console.log(`Size: ${item.sizeName} | Pairs: ${item.pairs} | Efficiency: ${item.efficiency.toFixed(1)}%`);
    const sheet = res.sheetsBySize[item.sizeName];
    const placements = sheet ? (sheet.placed || sheet.placements) : null;
    if (sheet && placements) {
      console.log(`\nPlaced count: ${placements.length}`);
      for (const p of placements) {
        const bb = p.orient?.bb || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        console.log(` - ID: ${p.id} | x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} | angle: ${p.orient?.angle ?? p.angle} | BB: [${(p.x + bb.minX).toFixed(1)}, ${(p.x + bb.maxX).toFixed(1)}, ${(p.y + bb.minY).toFixed(1)}, ${(p.y + bb.maxY).toFixed(1)}] | isSplit: ${!!(p.isSplit || p.id?.includes('split') || p.id?.startsWith('margin_fill_'))}`);
      }
    }
  }
}

run().catch(console.error);
