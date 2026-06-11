import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size4_5 = shapes.find(s => s.sizeName === '4.5');
  if (!size4_5) {
    console.error('Size 4.5 not found in DXF');
    return;
  }

  // 1. Run at 1070x1970 (baseline)
  console.log('\n=======================================');
  console.log('RUNNING AT 1070x1970 (EXPECTED: 58 PAIRS)');
  console.log('=======================================');
  const config1070 = {
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
  const engine1070 = new CapacityTestDoubleInsoleDoubleContourPattern(config1070);
  const res1070 = await engine1070.testCapacity([size4_5], config1070);
  console.log(`Result 1070x1970: ${res1070.summary[0].pairs} pairs, efficiency: ${res1070.summary[0].efficiency}%`);

  // 2. Run at 1080x1980 (buggy)
  console.log('\n=======================================');
  console.log('RUNNING AT 1080x1980 (EXPECTED: >= 58 PAIRS)');
  console.log('=======================================');
  const config1080 = {
    sheetWidth: 1080,
    sheetHeight: 1980,
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
  const engine1080 = new CapacityTestDoubleInsoleDoubleContourPattern(config1080);
  const res1080 = await engine1080.testCapacity([size4_5], config1080);
  console.log(`Result 1080x1980: ${res1080.summary[0].pairs} pairs, efficiency: ${res1080.summary[0].efficiency}%`);
}

run().catch(console.error);
