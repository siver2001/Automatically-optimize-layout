import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';

async function run() {
  clearCapacityResultCache();
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
    parallelSizes: false // Run sequentially
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const size8 = shapes.find(shape => (shape.sizeName || shape.name) === '8');
  if (!size8) {
    console.error('Size 8 not found');
    return;
  }
  const testSizes = [size8];

  console.log(`Running test for Size 8...`);
  const startTime = performance.now();
  const res = await engine.testCapacity(testSizes, config, (size, status) => {
    console.log(`Progress for ${size}: ${status}`);
  });
  const endTime = performance.now();
  const durationSec = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log("\n=== SIZE 8 CAPACITY RESULTS ===");
  for (const item of (res.summary || [])) {
    console.log(`Size: ${item.sizeName} | Pairs: ${item.pairs} | Efficiency: ${item.efficiency.toFixed(1)}% | Time: ${durationSec}s`);
  }
}

run().catch(console.error);
