import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, area as polygonArea } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size7 = shapes.find(shape => (shape.sizeName || shape.name) === '7');

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
  
  // Wait, the engine initialization does some parsing.
  // Let's call testCapacity but only to initialize the engine's doubleContourSourceBySize
  await engine.testCapacity([size7], config);

  const sourceShape = engine._doubleContourSourceBySize?.get('7') || size7;
  const polygon = sourceShape.polygon;
  
  const halfDefs = buildSplitHalfDefinitions(polygon, sourceShape.internals?.[0] || []);
  console.log(`\nHalf defs count: ${halfDefs.length}`);
  halfDefs.forEach((h, i) => {
    console.log(`Half [${i}] name: ${h.foot}, area: ${h.areaMm2.toFixed(2)}`);
  });

  const wholeOrient = engine._decorateOrient('7', 'X', polygon, 90, config, 0.5);
  const wholeBB = getBoundingBox(wholeOrient.polygon);
  console.log(`\nWhole piece (90 deg) BB: minX: ${wholeBB.minX.toFixed(2)}, maxX: ${wholeBB.maxX.toFixed(2)}, minY: ${wholeBB.minY.toFixed(2)}, maxY: ${wholeBB.maxY.toFixed(2)}`);
  console.log(`Whole piece width: ${wholeOrient.width.toFixed(2)}, height: ${wholeOrient.height.toFixed(2)}`);
  
  // Let's look at split half orients
  console.log(`\nSplit Half Orients:`);
  for (const halfDef of halfDefs) {
    for (const angle of [90, 270]) {
      const orient = engine._decorateSplitHalfOrient('7', halfDef, angle, config, 0.5);
      const bb = getBoundingBox(orient.polygon);
      console.log(`Half: ${orient.foot} | Angle: ${orient.angle} | BB: minX: ${bb.minX.toFixed(2)}, maxX: ${bb.maxX.toFixed(2)}, minY: ${bb.minY.toFixed(2)}, maxY: ${bb.maxY.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
