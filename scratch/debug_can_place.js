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
  
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const halfDefs = buildSplitHalfDefinitions(shape75.polygon, shape75.internals?.[0] || []);

  const p1_id = '7.5_X_11';
  const p1_x = 133.6;
  const p1_y = 268.0;
  const p1_angle = 180;
  
  const p2_id = '7.5_split-left_46';
  const p2_x = 44.3;
  const p2_y = 267.8;
  const p2_angle = 0;

  const orient1 = engine._decorateOrient('7.5', 'X', shape75.polygon, p1_angle, config, config.gridStep);
  const halfDef = halfDefs.find(hd => hd.key === 'split-left');
  const orient2 = engine._decorateSplitHalfOrient('7.5', halfDef, p2_angle, config, config.gridStep);

  console.log("=== Running tracing ===");
  
  const spatialIndex = engine._buildSpatialIndex([{
    id: p2_id,
    x: p2_x,
    y: p2_y,
    orient: orient2
  }], 1070, 1970, 3);

  const canPlace = engine._canPlaceSplitOrient(
    [{ id: p2_id, x: p2_x, y: p2_y, orient: orient2 }],
    orient1,
    p1_x,
    p1_y,
    config,
    1060, // workWidth = 1070 - 10
    1960, // workHeight = 1970 - 10
    spatialIndex,
    true // skipOutwardCheck = true
  );

  console.log(`_canPlaceSplitOrient returned: ${canPlace}`);
}

run().catch(console.error);
