import fs from 'fs';
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
  
  // Filter for size 6 and 6.5 to compare
  const size6 = shapes.find(s => s.sizeName === '6');
  const size65 = shapes.find(s => s.sizeName === '6.5');

  if (!size6 || !size65) {
    console.error('Could not find size 6 or 6.5 in the DXF file.');
    process.exit(1);
  }

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
    parallelSizes: false, // Set to false to use the manual limits I'll pass in testCapacity
    preparedSplitFillCandidateLimit: 100, // HIGH LIMIT FOR DEEP SEARCH
    preparedSplitFillDeep: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  console.log('--- TESTING SIZE 6.5 (Reference) ---');
  const res65 = await engine.testCapacity([size65], config);
  console.log(`Size 6.5: ${res65.summary[0].pairs} pairs\n`);

  console.log('--- TESTING SIZE 6 (Standard Limit: 2) ---');
  const res6Standard = await engine.testCapacity([size6], { ...config, preparedSplitFillCandidateLimit: 2 });
  console.log(`Size 6 (Standard): ${res6Standard.summary[0].pairs} pairs\n`);

  console.log('--- TESTING SIZE 6 (Deep Search: 100) ---');
  const res6Deep = await engine.testCapacity([size6], { ...config, preparedSplitFillCandidateLimit: 100 });
  console.log(`Size 6 (Deep): ${res6Deep.summary[0].pairs} pairs\n`);

  if (res6Deep.summary[0].pairs > res6Standard.summary[0].pairs) {
    console.log(`SUCCESS: Deep search found a better layout for Size 6: ${res6Deep.summary[0].pairs} pairs!`);
  } else {
    console.log('Deep search did not improve the result for Size 6 with current logic.');
  }
}

run().catch(console.error);
