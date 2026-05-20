import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
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

  // Check 11_X_2 (index 2)
  const p2 = sheet.placed[2];
  const p2bb = getBoundingBox(p2.polygon);
  
  // Test a split-half piece at x=700, y=20 (in absolute coordinates)
  const sourceShape = engine._doubleContourSourceBySize?.get('11');
  const halfDefs = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js').then(m => m.buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []));
  const orient = engine._decorateSplitHalfOrient('11', halfDefs[0], 0, config, 0.5);

  const testX = 700;
  const testY = 20;

  // Format polygons as { x, y } objects
  const p2Normalized = p2.polygon.map(pt => ({ x: pt.x - p2bb.minX, y: pt.y - p2bb.minY }));
  const orientBB = getBoundingBox(orient.polygon);
  const orientNormalized = orient.polygon.map(pt => ({ x: pt.x - orientBB.minX, y: pt.y - orientBB.minY }));

  console.log("p2bb:", p2bb);
  console.log("orientBB:", orientBB);
  console.log("testX, testY:", testX, testY);

  const overlap = cachedPolygonsOverlap(
    orientNormalized,
    p2Normalized,
    { x: testX, y: testY },
    { x: p2bb.minX, y: p2bb.minY },
    config.spacing,
    { minX: 0, minY: 0, maxX: orientBB.maxX - orientBB.minX, maxY: orientBB.maxY - orientBB.minY },
    { minX: 0, minY: 0, maxX: p2bb.maxX - p2bb.minX, maxY: p2bb.maxY - p2bb.minY }
  );

  console.log("Do they overlap with corrected format?", overlap);
}

run().catch(console.error);
