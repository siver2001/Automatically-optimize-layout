import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const result = await engine.testCapacity(shapes, config);
  
  for (const sizeName of Object.keys(result.sheetsBySize)) {
    const sheet = result.sheetsBySize[sizeName];
    const marginSplits = sheet.placed.filter(p => p.id?.startsWith('margin_fill_'));
    const totalSplits = sheet.placed.filter(p => p.id?.includes('split'));
    console.log(`Size: ${sizeName.padEnd(5)} | Total Placed: ${sheet.placed.length} | Margin Fill Splits: ${marginSplits.length} | Other Splits: ${totalSplits.length}`);
  }
}
run().catch(console.error);
