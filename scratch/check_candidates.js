import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size4_5 = shapes.find(s => s.sizeName === '4.5');

  const config = {
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

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // We want to intercept the candidate pool. Since we can't easily modify the code live to return it,
  // we can run a custom version of the strategy logic or print the candidates in the pool.
  // Wait, let's copy the strategy file or import it and call the internal candidate generation loop.
  // Actually, we can just edit the main strategy file temporarily to print the candidate pool right before sorting and filtering, and run it.
  console.log('We will run the strategy file which has console.log inside it.');
}

run().catch(console.error);
