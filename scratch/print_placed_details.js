import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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

  console.log("placed is array:", Array.isArray(sheet.placed));
  console.log("placed length:", sheet.placed?.length);
  
  if (sheet.placed && sheet.placed.length > 0) {
    console.log("Placed[0] keys:", Object.keys(sheet.placed[0]));
    console.log("Placed[0] sample:", JSON.stringify({
      id: sheet.placed[0].id,
      name: sheet.placed[0].name,
      x: sheet.placed[0].x,
      y: sheet.placed[0].y,
      rotation: sheet.placed[0].rotation,
      isHalf: sheet.placed[0].isHalf,
      splitOutwardSide: sheet.placed[0].splitOutwardSide
    }, null, 2));

    // Print all placements near the top-right corner of the sheet (in portrait: x > 750, y < 350)
    console.log("\n--- Placements in/near top-right portrait corner (x > 750, y < 350) ---");
    const cornerPlacements = sheet.placed.filter(p => p.x > 750 && p.y < 350);
    for (const p of cornerPlacements) {
      console.log(`ID: ${p.id} | Name: ${p.name} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | rot: ${p.rotation} | isHalf: ${p.isHalf}`);
    }
  }
}

run().catch(console.error);
