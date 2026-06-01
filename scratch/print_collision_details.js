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

  const p1_id = '7.5_X_32';
  const p1_x = 595.9 - config.marginX;
  const p1_y = 1345.0 - config.marginY;
  const p1_angle = 180;
  
  const p2_id = '7.5_X_37';
  const p2_x = 531.9 - config.marginX;
  const p2_y = 1612.8 - config.marginY;
  const p2_angle = 90;

  const orient1 = engine._decorateOrient('7.5', 'X', shape75.polygon, p1_angle, config, config.gridStep);
  const orient2 = engine._decorateOrient('7.5', 'X', shape75.polygon, p2_angle, config, config.gridStep);

  const bb1 = getBoundingBox(orient1.polygon);
  const bb2 = getBoundingBox(orient2.polygon);

  console.log(`=== Placement 1: ${p1_id} ===`);
  console.log(`Pos: (${p1_x.toFixed(3)}, ${p1_y.toFixed(3)})`);
  console.log(`BB local: minX=${bb1.minX.toFixed(3)}, maxX=${bb1.maxX.toFixed(3)}, minY=${bb1.minY.toFixed(3)}, maxY=${bb1.maxY.toFixed(3)}`);
  console.log(`BB world: minX=${(p1_x + bb1.minX).toFixed(3)}, maxX=${(p1_x + bb1.maxX).toFixed(3)}, minY=${(p1_y + bb1.minY).toFixed(3)}, maxY=${(p1_y + bb1.maxY).toFixed(3)}`);

  console.log(`\n=== Placement 2: ${p2_id} ===`);
  console.log(`Pos: (${p2_x.toFixed(3)}, ${p2_y.toFixed(3)})`);
  console.log(`BB local: minX=${bb2.minX.toFixed(3)}, maxX=${bb2.maxX.toFixed(3)}, minY=${bb2.minY.toFixed(3)}, maxY=${bb2.maxY.toFixed(3)}`);
  console.log(`BB world: minX=${(p2_x + bb2.minX).toFixed(3)}, maxX=${(p2_x + bb2.maxX).toFixed(3)}, minY=${(p2_y + bb2.minY).toFixed(3)}, maxY=${(p2_y + bb2.maxY).toFixed(3)}`);

  const overlap = cachedPolygonsOverlap(
    orient1.polygon,
    orient2.polygon,
    { x: p1_x, y: p1_y },
    { x: p2_x, y: p2_y },
    config.spacing,
    bb1,
    bb2
  );
  console.log(`\nOverlap (with spacing 3mm) = ${overlap}`);
}

run().catch(console.error);
