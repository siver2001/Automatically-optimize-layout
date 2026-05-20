import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { validatePatternPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    return;
  }

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

  // Build the array of existing placements with `{x, y}` points
  const existingPlacements = sheet.placed.map((p) => {
    let poly = p.polygon;
    const bb = getBoundingBox(poly);
    
    // Convert to relative coordinates using {x, y} format
    const normalizedPoly = poly.map(pt => ({
      x: pt.x - bb.minX,
      y: pt.y - bb.minY
    }));

    return {
      id: p.id,
      x: bb.minX,
      y: bb.minY,
      orient: {
        polygon: normalizedPoly,
        bb: {
          minX: 0,
          minY: 0,
          maxX: bb.maxX - bb.minX,
          maxY: bb.maxY - bb.minY,
          width: bb.maxX - bb.minX,
          height: bb.maxY - bb.minY
        }
      }
    };
  });

  // Prepare split half variants
  const sourceShape = engine._doubleContourSourceBySize?.get('11');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const step = 0.5;
  
  const variants = [];
  const angles = [0, 90, 180, 270];
  for (const angle of angles) {
    for (const halfDef of halfDefs) {
      const orient = engine._decorateSplitHalfOrient('11', halfDef, angle, config, step);
      variants.push(orient);
    }
  }

  console.log(`Prepared ${variants.length} split-half variants with corrected format.`);

  let totalPositionsTested = 0;
  let successfulPositions = [];
  
  const spacing = config.spacing;
  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;

  // Subtract marginX and marginY for work placements
  const workPlacements = existingPlacements.map(p => ({
    id: p.id,
    x: p.x - config.marginX,
    y: p.y - config.marginY,
    orient: p.orient
  }));

  // Scanning bounds:
  // Portrait corner is X from 800 to 1095, Y from 20 to 350
  // In work coordinates:
  // tx from 800 - 5 = 795 to 1095 - 5 = 1090
  // ty from 20 - 20 = 0 to 350 - 20 = 330
  const minTx = 795;
  const maxTx = 1090;
  const minTy = 0;
  const maxTy = 330;

  console.log(`Searching work area bounds: X [${minTx}, ${maxTx}], Y [${minTy}, ${maxTy}]`);

  for (let vIdx = 0; vIdx < variants.length; vIdx++) {
    const variant = variants[vIdx];
    const variantBB = getBoundingBox(variant.polygon);
    
    // Normalize variant polygon to origin with {x, y} format
    const normalizedVariantPoly = variant.polygon.map(pt => ({
      x: pt.x - variantBB.minX,
      y: pt.y - variantBB.minY
    }));

    const testOrient = {
      polygon: normalizedVariantPoly,
      bb: {
        minX: 0,
        minY: 0,
        maxX: variantBB.maxX - variantBB.minX,
        maxY: variantBB.maxY - variantBB.minY,
        width: variantBB.maxX - variantBB.minX,
        height: variantBB.maxY - variantBB.minY
      }
    };

    console.log(`\nTesting Variant ${vIdx}: Angle=${variant.angle}, Side=${variant.splitOutwardSide}, Size=${testOrient.bb.maxX.toFixed(1)}x${testOrient.bb.maxY.toFixed(1)}`);
    
    let variantTested = 0;
    let variantSuccess = 0;
    
    // Scan every 2.0 mm
    for (let tx = minTx; tx <= maxTx - testOrient.bb.maxX; tx += 2.0) {
      for (let ty = minTy; ty <= maxTy - testOrient.bb.maxY; ty += 2.0) {
        totalPositionsTested++;
        variantTested++;

        const testPlacement = {
          id: 'test_piece',
          x: tx,
          y: ty,
          orient: testOrient
        };

        const listToValidate = [...workPlacements, testPlacement];
        const res = validatePatternPlacements(listToValidate, workWidth, workHeight, spacing);
        
        if (res.valid) {
          variantSuccess++;
          successfulPositions.push({
            variantIndex: vIdx,
            angle: variant.angle,
            side: variant.splitOutwardSide,
            x: tx + config.marginX,
            y: ty + config.marginY
          });
        }
      }
    }
    console.log(`Variant ${vIdx}: Tested ${variantTested} positions, Valid fits: ${variantSuccess}`);
  }

  console.log(`\n--- SEARCH RESULT ---`);
  console.log(`Total potential positions tested: ${totalPositionsTested}`);
  console.log(`Total successful fits found in corner: ${successfulPositions.length}`);
  if (successfulPositions.length > 0) {
    console.log("Found valid positions! Details of first 5:");
    console.log(JSON.stringify(successfulPositions.slice(0, 5), null, 2));
  } else {
    console.log("No valid positions found. The corner is geometrically/physically impossible to fit any split-half piece.");
  }
}

run().catch(console.error);
