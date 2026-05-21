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

  console.log("Config: ", JSON.stringify(config, null, 2));

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '4.5' || shape.sizeName === '4,5' || shape.sizeName === '4_5');

  if (testSizes.length === 0) {
    console.error("Size 4.5 not found!");
    process.exit(1);
  }

  console.log(`Running test for Size 4.5...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== RESULT ===");
  for (const item of (res.summary || [])) {
    console.log(`Size: ${item.sizeName} | Pairs: ${item.pairs} | Efficiency: ${item.efficiency.toFixed(1)}%`);
    const sheet = res.sheetsBySize[item.sizeName];
    const placements = sheet ? (sheet.placed || sheet.placements) : null;
    if (sheet && placements) {
      console.log(`Placed count: ${placements.length}`);
      
      const sortedPlacements = [...placements].sort((a, b) => a.y - b.y || a.x - b.x);
      sortedPlacements.forEach((p, i) => {
        const isSplit = p.id.includes('split') || p.isSplit;
        console.log(`Item [${i}] ID: ${p.id} | isSplit: ${isSplit} | x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)} | angle: ${p.angle}`);
      });
    }
  }
}

run().catch(console.error);
