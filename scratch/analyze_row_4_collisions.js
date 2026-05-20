import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
  
  engine._doubleContourSourceBySize = new Map([
    ['9.5', { polygon: size9_5.polygon, internals: size9_5.internals || [] }]
  ]);

  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;
  const candidate = engine._evaluateFootCandidate('9.5', 'L', size9_5.polygon, config, workWidth, workHeight);

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
  
  // Let's run a margin top-fill first to see if any top splits are placed, which matches the real run
  // Actually let's just get the final placements that would be present when right-margin fill runs.
  // We can do this by executing `engine._fillMarginHalves` but step-by-step.
  
  // Let's print out what rightOrients we have.
  console.log(`Right Orients count: ${rightOrients.length}`);

  const spacing = config.spacing || 0;

  for (let i = 0; i < rightOrients.length; i++) {
    const orient = rightOrients[i];
    const bb = getBoundingBox(orient.polygon);
    const maxScanX = workWidth - bb.maxX;

    console.log(`\n=================== Variant ${i}: angle=${orient.angle} ===================`);
    
    // We will test several work Ys around 837.2 (sheet Y = 857.2)
    // And for each work Y, we will scan X from maxScanX down to maxScanX - 100 with step 1.0.
    const testYs = [837.2, 835.0, 836.0, 838.0, 839.0, 840.0];
    for (const testY of testYs) {
      console.log(`\n--- Test Y = ${testY.toFixed(1)} (sheet Y = ${(testY + 20).toFixed(1)}) ---`);
      
      let foundAnyValid = false;
      for (let x = maxScanX; x >= maxScanX - 100; x -= 1.0) {
        // Check collisions with all existing placements
        const collidingPieces = [];
        
        // Check bounds check against sheet
        if (
          x + bb.minX < -1e-6 ||
          testY + bb.minY < -1e-6 ||
          x + bb.maxX > workWidth + 1e-6 ||
          testY + bb.maxY > workHeight + 1e-6
        ) {
          collidingPieces.push("SHEET_BOUNDS");
        } else {
          for (const entry of allPlacements) {
            const ebb = entry.orient.bb || getBoundingBox(entry.orient.polygon);
            const eminX = entry.x + ebb.minX - spacing;
            const emaxX = entry.x + ebb.maxX + spacing;
            const eminY = entry.y + ebb.minY - spacing;
            const emaxY = entry.y + ebb.maxY + spacing;

            const minX2 = x + bb.minX - spacing;
            const maxX2 = x + bb.maxX + spacing;
            const minY2 = testY + bb.minY - spacing;
            const maxY2 = testY + bb.maxY + spacing;

            if (emaxX < minX2 || eminX > maxX2 || emaxY < minY2 || eminY > maxY2) {
              continue; // Bounding box doesn't overlap
            }

            // Polygon level overlap check
            if (cachedPolygonsOverlap(
              entry.orient.polygon,
              orient.polygon,
              { x: entry.x, y: entry.y },
              { x, y: testY },
              spacing,
              ebb,
              bb
            )) {
              collidingPieces.push(entry.id);
            }
          }
        }

        if (collidingPieces.length === 0) {
          console.log(`  x = ${x.toFixed(1)} (sheet x = ${(x + 5).toFixed(1)}): VALID!`);
          foundAnyValid = true;
        } else {
          // If x is near the maxScanX, let's print the colliding pieces to understand why it failed.
          if (x === maxScanX || x === maxScanX - 5 || x === maxScanX - 10) {
            console.log(`  x = ${x.toFixed(1)} (sheet x = ${(x + 5).toFixed(1)}): Collides with [${collidingPieces.join(', ')}]`);
          }
        }
      }
      if (!foundAnyValid) {
        console.log(`  No valid X found for this Y in the [${(maxScanX - 100).toFixed(1)}, ${maxScanX.toFixed(1)}] range.`);
      }
    }
  }
}

run().catch(console.error);
