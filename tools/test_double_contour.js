import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  console.log(`Successfully parsed ${shapes.length} shapes from DXF.`);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 1,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    doubleContourPreferredAngles: [0]
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  const testList = [shapes[11]].map(shape => ({
    ...shape,
    sizeName: shape.sizeName || 'Test-Size-9'
  }));

  console.log(`Running fast capacity test for size: ${testList[0].sizeName}`);
  const result = await nester.testCapacity(testList, config);
  
  if (result && result.success) {
    console.log('\n--- Capacity Test Results ---');
    result.summary.forEach(item => {
      console.log(`Size: ${item.sizeName}`);
      console.log(`Total Placed (pieces): ${item.placedCount}`);
      console.log(`Efficiency: ${item.efficiency}%`);
    });
  } else {
    console.error('Capacity test failed:', result);
  }
}

run().catch(console.error);
