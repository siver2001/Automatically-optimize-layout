import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    return;
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  console.log("All available size names in DXF:");
  console.log(shapes.map(s => s.sizeName || s.name));

  const size9_5 = shapes.find(shape => {
    const name = shape.sizeName || shape.name;
    return name === '9.5' || name === '9_5' || name === '95';
  });

  if (!size9_5) {
    console.error("Size 9.5 not found!");
    return;
  }

  console.log("Found Size 9.5 shape! Polygon vertices count:", size9_5.polygon.length);

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
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const result = await engine.testCapacity([size9_5], config);
  const sheet = result.sheetsBySize['9.5'] || result.sheetsBySize['9_5'] || Object.values(result.sheetsBySize)[0];

  if (!sheet) {
    console.error("No sheet resulted for size 9.5!");
    return;
  }

  console.log("--- Size 9.5 Layout Result ---");
  console.log("Total Placed pieces:", sheet.placedCount);
  console.log("Actual Pairs:", sheet.actualPairs);

  console.log("\n--- PLACEMENTS DETAILS ---");
  for (const p of sheet.placed) {
    const bb = getBoundingBox(p.polygon);
    console.log(`ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | BB: [${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}, ${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}] | width: ${(bb.maxX - bb.minX).toFixed(1)} | height: ${(bb.maxY - bb.minY).toFixed(1)} | isHalf: ${p.isHalf}`);
  }
}

run().catch(console.error);
