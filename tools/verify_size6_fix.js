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
  
  const size6 = shapes.find(s => s.sizeName === '6');
  const size65 = shapes.find(s => s.sizeName === '6.5');

  if (!size6 || !size65) {
      console.error('Could not find size 6 or 6.5');
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
    parallelSizes: true,
    // Force very deep search for this test
    preparedSplitFillCandidateLimit: 100,
    preparedSplitFillDeep: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  console.log('--- FINAL VALIDATION TEST ---');
  console.log('Testing Size 6 with optimized search parameters...');
  
  const startTime = Date.now();
  const res = await engine.testCapacity([size6], config);
  const duration = (Date.now() - startTime) / 1000;

  const result = res.summary[0];
  console.log(`\nRESULTS FOR SIZE 6:`);
  console.log(`- Pairs: ${result.pairs}`);
  console.log(`- Pieces: ${result.totalPieces}`);
  console.log(`- Efficiency: ${result.efficiency.toFixed(1)}%`);
  console.log(`- Time: ${duration.toFixed(1)}s`);
  
  if (result.pairs >= 53) {
      console.log('\nSUCCESS: Size 6 now reaches 53 pairs (matching or exceeding Size 6.5)!');
  } else {
      console.log(`\nSize 6 reached ${result.pairs} pairs. If this is still less than 53, we may need to adjust the interlocking shift step.`);
  }
}

run().catch(console.error);
