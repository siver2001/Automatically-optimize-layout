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
  const size11 = shapes.find(shape => (shape.sizeName || shape.name) === '11');

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
  const result = await engine.testCapacity([size11], config);
  const sheet = result.sheetsBySize['11'];

  console.log("Placed count:", sheet.placed.length);
  for (const p of sheet.placed) {
    const bb = getBoundingBox(p.polygon);
    console.log(`Placed ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | Polygon BB: [${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}, ${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}] | size: ${(bb.maxX - bb.minX).toFixed(1)}x${(bb.maxY - bb.minY).toFixed(1)}`);
  }
}

run().catch(console.error);
