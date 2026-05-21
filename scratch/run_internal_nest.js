import fs from 'fs';
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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate90: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '4.5' || shape.sizeName === '4,5' || shape.sizeName === '4_5');

  if (testSizes.length === 0) {
    console.error("Size 4.5 not found!");
    return;
  }

  const res = await engine.testCapacity(testSizes, config);
  console.log("sheetsBySize keys:", Object.keys(res.sheetsBySize || {}));
  const key = Object.keys(res.sheetsBySize || {})[0];
  const sheet = res.sheetsBySize[key];
  if (sheet) {
    const placements = sheet.placed || sheet.placements || [];
    console.log("Placements count:", placements.length);
    placements.forEach((p, idx) => {
      console.log(`[${idx}] ID: ${p.id} | x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)} | angle: ${p.angle}`);
    });
  } else {
    console.log("No sheet found at all");
  }
}

run().catch(console.error);
