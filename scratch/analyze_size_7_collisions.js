import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

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
  
  const shape7 = shapes.find(shape => (shape.sizeName || shape.name) === '7');
  if (!shape7) {
    console.error("Size 7 not found");
    return;
  }

  console.log(`Analyzing Size 7...`);
  const res = await engine.testCapacity([shape7], config);
  const sheet = res.sheetsBySize['7'];
  if (!sheet || !sheet.placed) {
    console.error("No sheet placed for Size 7");
    return;
  }

  const placements = sheet.placed;
  // Let's find the split pieces
  const splitPieces = placements.filter(p => engine._isSplitFillPlacement(p));
  const wholePieces = placements.filter(p => !engine._isSplitFillPlacement(p));

  console.log(`\nFound ${splitPieces.length} split pieces:`);
  
  for (const sp of splitPieces) {
    const bb = getBoundingBox(sp.polygon);
    console.log(`\n--- Split Piece ID: ${sp.id} (${sp.foot}) ---`);
    console.log(`Current position: Y = [${bb.minY.toFixed(2)} - ${bb.maxY.toFixed(2)}], X = [${bb.minX.toFixed(2)} - ${bb.maxX.toFixed(2)}]`);

    // Let's test sliding it Y-ward (increasing Y)
    // Find how far we can slide it before collision
    const otherPlacements = placements.filter(p => p.id !== sp.id);
    const spatialIndex = engine._buildSpatialIndex(otherPlacements, config.sheetWidth, config.sheetHeight, config.spacing);

    // Test with checkCycOverlap = true (actual constraints)
    let bestY_withCyc = sp.y;
    let lowY = sp.y;
    let highY = config.sheetHeight;
    while (highY - lowY > 0.1) {
      const midY = (lowY + highY) / 2;
      if (engine._canPlaceSplitOrient(otherPlacements, sp.orient, sp.x, midY, config, config.sheetWidth, config.sheetHeight, spatialIndex, true, true)) {
        bestY_withCyc = midY;
        lowY = midY;
      } else {
        highY = midY;
      }
    }
    const bbWithCyc = getBoundingBox(sp.orient.polygon).map(pt => ({ x: pt.x + sp.x, y: pt.y + bestY_withCyc })); // wait, bb is relative
    const newMinY_withCyc = bestY_withCyc + sp.orient.bb.minY;
    const newMaxY_withCyc = bestY_withCyc + sp.orient.bb.maxY;

    // Test with checkCycOverlap = false (ignoring knife constraint)
    let bestY_noCyc = sp.y;
    lowY = sp.y;
    highY = config.sheetHeight;
    while (highY - lowY > 0.1) {
      const midY = (lowY + highY) / 2;
      if (engine._canPlaceSplitOrient(otherPlacements, sp.orient, sp.x, midY, config, config.sheetWidth, config.sheetHeight, spatialIndex, true, false)) {
        bestY_noCyc = midY;
        lowY = midY;
      } else {
        highY = midY;
      }
    }
    const newMinY_noCyc = bestY_noCyc + sp.orient.bb.minY;
    const newMaxY_noCyc = bestY_noCyc + sp.orient.bb.maxY;

    console.log(`With Cyc Check: max Y = [${newMinY_withCyc.toFixed(2)} - ${newMaxY_withCyc.toFixed(2)}] (Current is ${sp.y === bestY_withCyc ? 'AT MAX' : 'can slide to Y=' + bestY_withCyc.toFixed(2)})`);
    console.log(`No Cyc Check:   max Y = [${newMinY_noCyc.toFixed(2)} - ${newMaxY_noCyc.toFixed(2)}]`);

    // Let's find which piece collides if we go slightly above bestY_withCyc
    const testY = bestY_withCyc + 1.0;
    const testPlacements = otherPlacements.map(p => ({ ...p }));
    
    // Check which piece specifically overlaps with sp at testY
    console.log(`Collisions at test Y = ${(testY + sp.orient.bb.minY).toFixed(2)}:`);
    const spacing = config.spacing;
    const bb2 = sp.orient.bb;
    const minX2 = sp.x + bb2.minX - spacing;
    const maxX2 = sp.x + bb2.maxX + spacing;
    const minY2 = testY + bb2.minY - spacing;
    const maxY2 = testY + bb2.maxY + spacing;

    for (const wp of otherPlacements) {
      const wpbb = wp.orient.bb || getBoundingBox(wp.orient.polygon);
      const minX1 = wp.x + wpbb.minX - spacing;
      const maxX1 = wp.x + wpbb.maxX + spacing;
      const minY1 = wp.y + wpbb.minY - spacing;
      const maxY1 = wp.y + wpbb.maxY + spacing;

      // Check material vs material
      let materialOverlap = false;
      if (!(maxX1 < minX2 || minX1 > maxX2 || maxY1 < minY2 || minY1 > maxY2)) {
        if (engine._canPlaceSplitOrient([wp], sp.orient, sp.x, testY, config, config.sheetWidth, config.sheetHeight, null, true, false) === false) {
          materialOverlap = true;
        }
      }

      // Check cyc vs material
      let cycOverlap = false;
      if (engine._canPlaceSplitOrient([wp], sp.orient, sp.x, testY, config, config.sheetWidth, config.sheetHeight, null, true, true) === false) {
        cycOverlap = true;
      }

      if (materialOverlap || cycOverlap) {
        console.log(`  * Collides with: ${wp.id} (${wp.foot}) | Material overlap: ${materialOverlap} | Cyc overlap: ${cycOverlap}`);
      }
    }
  }
}

run().catch(console.error);
