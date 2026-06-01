import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  console.log(`Running single test for Size 7.5 and checking final candidates...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("Result summary:", res.summary);
  if (res.sheetsBySize['7.5']) {
    const placements = res.sheetsBySize['7.5'].placed || [];
    console.log(`Placed count: ${placements.length}`);
    for (const p of placements) {
      console.log(`  Piece: ${p.id} | x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)} | angle: ${p.angle}`);
    }
  }
}

run().catch(console.error);
