import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '4.5' || shape.sizeName === '4,5' || shape.sizeName === '4_5');

  if (testSizes.length === 0) {
    console.error("Size 4.5 not found!");
    return;
  }

  const shape = testSizes[0];
  console.log("Shape keys:", Object.keys(shape));
  console.log("Shape sizeName:", shape.sizeName);
  
  const bb = getBoundingBox(shape.polygon);
  console.log("Whole piece BB:", bb, "width:", bb.maxX - bb.minX, "height:", bb.maxY - bb.minY);

  if (shape.internals && shape.internals.length > 0) {
    console.log("Internals count:", shape.internals.length);
  }
  
  // Let's import buildSplitHalfDefinitions from CapacityTestDoubleInsoleDoubleContourPattern
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const { rotatePolygon } = await import('../server/algorithms/diecut/core/polygonUtils.js');
  const halves = buildSplitHalfDefinitions(shape.polygon, shape.internals?.[0] || []);
  console.log("Halves count:", halves.length);
  for (const h of halves) {
    const hbb = getBoundingBox(h.polygon);
    console.log(`Half [${h.foot || h.name}]:`, hbb, "width:", hbb.maxX - hbb.minX, "height:", hbb.maxY - hbb.minY);
    for (const angle of [90, 270]) {
      const rotatedPoly = rotatePolygon(h.polygon, angle * Math.PI / 180);
      const rbb = getBoundingBox(rotatedPoly);
      console.log(`  Angle ${angle}:`, rbb, "width:", rbb.maxX - rbb.minX, "height:", rbb.maxY - rbb.minY);
    }
  }
}

run().catch(console.error);
