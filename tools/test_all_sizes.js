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
  console.log(`Parsed ${shapes.length} shapes.\n`);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 1,
    preparedSplitFillEnabled: false,
    capacityLayoutMode: 'same-side-double-contour',
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  for (let i = 0; i < shapes.length; i++) {
    const testSize = {
      ...shapes[i],
      sizeName: shapes[i].sizeName || shapes[i].name || `Size-${i}`
    };

    console.log(`--- Testing size: ${testSize.sizeName} (index ${i}) ---`);
    const startTime = Date.now();
    const result = await nester.testCapacity([testSize], config);
    const elapsed = Date.now() - startTime;

    if (result && result.success) {
      const item = result.summary[0];
      console.log(`Placed: ${item.placedCount} pieces (${item.efficiency}%), time: ${elapsed}ms\n`);
    } else {
      console.log('Failed to test\n');
    }
  }
}

run().catch(console.error);
