import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';

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
  const sizeInfo = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  
  // Let's run a dummy execute to trigger decorators
  await engine.testCapacity([sizeInfo], config);

  // Now let's retrieve the decorated orients for Size 9
  // We can find them by replicating buildSplitHalfDefinitions and decorating them
  const sourceShape = engine._doubleContourSourceBySize.get('9');
  const buildSplitHalfDefinitions = (await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js')).buildSplitHalfDefinitions;
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  
  // body_1_5 corresponds to the main shape at angle 180 (mirror of L or R/L)
  // Let's find body_1_5's orient. 
  // Wait, in task-938 trace:
  // body_1_5 is the 12th placement. In double contour, main pieces are placed.
  // Let's just find the orients by running the search and catching the exact objects inside the hook!
  
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly, validate) {
    if (candidate.placements.length === 49) {
      const aligned = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight, candidate.sizeName);
      const p11 = aligned[11];
      const p43 = aligned[43];

      console.log("p11.orient.polygon vertices count:", p11.orient.polygon.length);
      console.log("p43.orient.polygon vertices count:", p43.orient.polygon.length);

      const overlapDirect = polygonsOverlap(
        p11.orient.polygon,
        p43.orient.polygon,
        { x: p11.x, y: p11.y },
        { x: p43.x, y: p43.y },
        config.spacing || 0
      );

      console.log("Direct polygonsOverlap check on search shapes:", overlapDirect);
    }
    return originalFinalize.call(this, candidate, config, workWidth, workHeight, fastOnly, validate);
  };

  await engine.testCapacity([sizeInfo], { ...config, preparedSplitFillDeep: true });
}

run().catch(console.error);
