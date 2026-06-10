import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
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
  })).filter(shape => shape.sizeName === '7'); // Test Size 7 from the screenshot

  console.log(`Running placements check for Size 7...`);
  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize && res.sheetsBySize['7'];
  if (!sheet || !sheet.placed) {
    console.error("No sheet placed for size 7");
    return;
  }

  // Placed pieces
  const placements = sheet.placed;
  placements.sort((a, b) => {
    const bbA = getBoundingBox(a.polygon);
    const bbB = getBoundingBox(b.polygon);
    const yA = (bbA.minY + bbA.maxY) / 2;
    const yB = (bbB.minY + bbB.maxY) / 2;
    if (Math.abs(yA - yB) > 50) return yA - yB;
    return bbA.minX - bbB.minX;
  });

  console.log("\n=== Placements for Size 7 (sorted by Row then X) ===");
  for (const p of placements) {
    const bb = getBoundingBox(p.polygon);
    console.log(` - ID: ${p.id.padEnd(20)} | Foot: ${p.foot.padEnd(12)} | X: [${bb.minX.toFixed(1).padStart(6)} to ${bb.maxX.toFixed(1).padStart(6)}] | Y: [${bb.minY.toFixed(1).padStart(6)} to ${bb.maxY.toFixed(1).padStart(6)}]`);
  }
}

run().catch(console.error);
