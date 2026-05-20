import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size9_5 = shapes.find(shape => (shape.sizeName || shape.name) === '9.5');

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
  
  // Set up double contour source
  engine._doubleContourSourceBySize = new Map([
    ['9.5', { polygon: size9_5.polygon, internals: size9_5.internals || [] }]
  ]);

  // Evaluate candidate to get whole placements
  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;
  const candidate = engine._evaluateFootCandidate('9.5', 'L', size9_5.polygon, config, workWidth, workHeight);

  console.log("Whole placements count:", candidate.placements.length);

  // Let's call the internal methods of _fillMarginHalves but specifically check y = 857.2 (which is 857.2 - 20 = 837.2 in work coordinates)
  const sourceShape = engine._doubleContourSourceBySize.get('9.5');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const step = 0.05;
  const orientVariants = [];
  for (const angle of engine._getSplitFillAngles(config)) {
    for (const halfDef of halfDefs) {
      orientVariants.push(engine._decorateSplitHalfOrient('9.5', halfDef, angle, config, step));
    }
  }

  const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
  const allPlacements = [...candidate.placements];
  const spatialIndex = engine._buildSpatialIndex(allPlacements, workWidth, workHeight, config.spacing || 0);

  console.log("\nTesting all right-oriented split-half variants at Row 4 y = 857.2 (work Y = 837.2):");
  for (let i = 0; i < rightOrients.length; i++) {
    const orient = rightOrients[i];
    const bb = getBoundingBox(orient.polygon);
    const maxScanX = workWidth - bb.maxX;

    console.log(`\nVariant ${i}: angle=${orient.angle}, size=${(bb.maxX - bb.minX).toFixed(1)}x${(bb.maxY - bb.minY).toFixed(1)}`);
    
    // We will test several work Ys around 837.2 (which is 857.2 - 20)
    const testYs = [837.2, 835.0, 836.0, 837.0, 838.0, 839.0, 840.0];
    for (const testY of testYs) {
      const validX = engine._findMinValidXForRightMargin(
        orient,
        testY,
        0,
        maxScanX,
        allPlacements,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
      console.log(`  Test Y = ${testY.toFixed(1)} (sheet Y = ${(testY + 20).toFixed(1)}) | validX = ${validX !== null ? (validX + 5).toFixed(1) : 'null'}`);
    }
  }
}

run().catch(console.error);
