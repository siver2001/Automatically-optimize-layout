import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const targetSizes = ['6', '6.5', '7'];
  const sizesToTest = shapes.filter(s => targetSizes.includes(s.sizeName));
  
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

  for (const size of sizesToTest) {
    console.log('\n=======================================');
    console.log(`RUNNING Size ${size.sizeName} AT 1080x1980`);
    console.log('=======================================');
    const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config1080);
    const res = await engine.testCapacity([size], config1080);
    console.log(`Result Size ${size.sizeName}: ${res.summary[0].pairs} pairs, efficiency: ${res.summary[0].efficiency}%`);
  }
}

run().catch(console.error);
