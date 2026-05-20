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
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: false, // Turn OFF margin filling to see initial placements
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '11');

  console.log(`Running initial placements check for Size 11...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== DEBUG RESULT ===");
  console.log(`testSizes length: ${testSizes.length}`);
  console.log(`res keys: ${Object.keys(res || {})}`);
  if (res && res.sheetsBySize) {
    console.log(`sheetsBySize keys: ${Object.keys(res.sheetsBySize)}`);
  }
  
  console.log("\n=== PLACEMENTS LIST ===");
  const sheet = res.sheetsBySize && res.sheetsBySize['11'];
  if (sheet && sheet.placed) {
    console.log(`Total: ${sheet.placed.length}`);
    for (const p of sheet.placed) {
      console.log(` - ID: ${p.id} | x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} | foot: ${p.foot} | pieceCount: ${p.pieceCount}`);
    }
  }
}

run().catch(console.error);
