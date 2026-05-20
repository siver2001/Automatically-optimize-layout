import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { cachedPolygonsOverlap, validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
  
  engine._doubleContourSourceBySize = new Map([
    ['11', { polygon: size11.polygon, internals: size11.internals || [] }]
  ]);

  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;
  const candidate = engine._evaluateFootCandidate('11', 'L', size11.polygon, config, workWidth, workHeight);

  console.log("Candidate placements count:", candidate.placements.length);

  // Print all placed whole pieces and their bounding boxes
  for (const p of candidate.placements) {
    const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || p.polygon);
    console.log(`ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | BB: [${(p.x + bb.minX).toFixed(1)}, ${(p.x + bb.maxX).toFixed(1)}, ${(p.y + bb.minY).toFixed(1)}, ${(p.y + bb.maxY).toFixed(1)}]`);
  }

  // Check the right margin fill process
  const sourceShape = engine._doubleContourSourceBySize.get('11');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const step = 0.05;
  const orientVariants = [];
  for (const angle of engine._getSplitFillAngles(config)) {
    for (const halfDef of halfDefs) {
      orientVariants.push(engine._decorateSplitHalfOrient('11', halfDef, angle, config, step));
    }
  }

  const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
  console.log(`\nRight orient variants count: ${rightOrients.length}`);

  const spacing = config.spacing || 0;
  
  // We want to test placing right-margin split halves
  for (let idx = 0; idx < rightOrients.length; idx++) {
    const orient = rightOrients[idx];
    const bb = getBoundingBox(orient.polygon);
    const maxScanX = workWidth - bb.maxX;

    console.log(`\nVariant ${idx} (angle=${orient.angle}): BB=[${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}, ${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}], Width=${(bb.maxX-bb.minX).toFixed(1)}, Height=${(bb.maxY-bb.minY).toFixed(1)}`);
    console.log(`maxScanX (work): ${maxScanX.toFixed(1)} (sheet x = ${(maxScanX + 5).toFixed(1)})`);

    // Let's test a scan from Y=0 to workHeight - height with a step of 5mm
    for (let testY = 0; testY <= workHeight - (bb.maxY - bb.minY); testY += 10.0) {
      const validX = engine._findMinValidXForRightMargin(
        orient,
        testY,
        0,
        maxScanX,
        candidate.placements,
        config,
        workWidth,
        workHeight,
        engine._buildSpatialIndex(candidate.placements, workWidth, workHeight, spacing)
      );

      if (validX !== null) {
        console.log(`  Found valid placement at work: Y = ${testY.toFixed(1)} (sheet Y = ${(testY + 20).toFixed(1)}), X = ${validX.toFixed(1)} (sheet X = ${(validX + 5).toFixed(1)})`);
      }
    }
  }
}

run().catch(console.error);
