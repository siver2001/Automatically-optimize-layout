import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
  const shape75 = shapes.find(s => (s.sizeName || s.name) === '7.5');

  // Let's get the orients
  const bodyOrient = engine._decorateOrient('7.5', 'X', shape75.polygon, 180, config, config.gridStep);
  const fillerOrient = engine._decorateOrient('7.5', 'X', shape75.polygon, 90, config, config.gridStep);

  console.log(`Body Orient (angle 180): Width = ${bodyOrient.width.toFixed(2)}, Height = ${bodyOrient.height.toFixed(2)}`);
  console.log(`Filler Orient (angle 90): Width = ${fillerOrient.width.toFixed(2)}, Height = ${fillerOrient.height.toFixed(2)}`);

  // Let's find the offset to place Body below Filler (which is what engine._findBodyStartOffsetAfterFillerRow does)
  // filler at (0,0), body at (0, y)
  const bbFiller = fillerOrient.bb || getBoundingBox(fillerOrient.polygon);
  const bbBody = bodyOrient.bb || getBoundingBox(bodyOrient.polygon);

  let deltaBodyBelowFiller = 0;
  for (let y = 0; y < 1000; y += 0.1) {
    let overlap = false;
    if (cachedPolygonsOverlap(
      fillerOrient.polygon,
      bodyOrient.polygon,
      { x: 0, y: 0 },
      { x: 0, y },
      config.spacing,
      bbFiller,
      bbBody
    )) {
      overlap = true;
    }
    if (!overlap) {
      deltaBodyBelowFiller = y;
      break;
    }
  }

  // Let's find the offset to place Filler below Body
  // body at (0,0), filler at (0, y)
  let deltaFillerBelowBody = 0;
  for (let y = 0; y < 1000; y += 0.1) {
    let overlap = false;
    if (cachedPolygonsOverlap(
      bodyOrient.polygon,
      fillerOrient.polygon,
      { x: 0, y: 0 },
      { x: 0, y },
      config.spacing,
      bbBody,
      bbFiller
    )) {
      overlap = true;
    }
    if (!overlap) {
      deltaFillerBelowBody = y;
      break;
    }
  }

  console.log(`\nDelta required to place Body below Filler: ${deltaBodyBelowFiller.toFixed(3)} mm`);
  console.log(`Delta required to place Filler below Body: ${deltaFillerBelowBody.toFixed(3)} mm`);
}

run().catch(console.error);
