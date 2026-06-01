import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    doubleContourDeepSearch: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['7.5'];
  const placements = sheet ? sheet.placed : [];
  
  console.log(`Placed ${placements.length} pieces. Details:`);
  for (const p of placements) {
    const bb = getBoundingBox(p.polygon);
    console.log(`ID: ${p.id} | x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)} | angle: ${p.orient?.angle ?? p.angle} | BB: [${bb.minX.toFixed(2)}, ${bb.maxX.toFixed(2)}, ${bb.minY.toFixed(2)}, ${bb.maxY.toFixed(2)}] | W: ${bb.width.toFixed(2)}, H: ${bb.height.toFixed(2)}`);
  }
}

run().catch(console.error);
