import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

class ImprovedDoubleContourPattern extends CapacityTestDoubleInsoleDoubleContourPattern {
  _findSplitFillPlacements(sizeName, polygon, baseCandidate, config, workWidth, workHeight) {
    // We call the original _findSplitFillPlacements but filter its final results or we intercept the states
    // Actually, we can just intercept option filtering inside the method, but since it's a class we can override it!
    // Let's write the overridden version of _findSplitFillPlacements that filters out placements in the margin zones:
    const margin = 120; // 120 mm margin zone

    // Let's call the super method
    const originalPlacements = super._findSplitFillPlacements(sizeName, polygon, baseCandidate, config, workWidth, workHeight);
    
    // Filter the final placements to remove any that fall into the margins!
    const filtered = originalPlacements.filter(p => {
      const pbb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
      const isRightMargin = p.x + pbb.maxX > workWidth - margin;
      const isBottomMargin = p.y + pbb.maxY > workHeight - margin;
      const isTopMargin = p.y + pbb.minY < margin;
      
      // If it falls into any margin, exclude it from Phase 1!
      return !isRightMargin && !isBottomMargin && !isTopMargin;
    });

    return filtered;
  }
}

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

  const engine = new ImprovedDoubleContourPattern(config);
  const result = await engine.testCapacity([size9_5], config);
  const sheet = result.sheetsBySize['9.5'];

  console.log("--- TEST CAPACITY WITH MARGIN FILTER ---");
  console.log("Total Placed pieces:", sheet.placedCount);
  console.log("Actual Pairs:", sheet.actualPairs);

  console.log("\nPlacements details:");
  for (const p of sheet.placed) {
    const bb = getBoundingBox(p.polygon);
    console.log(`  ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | isHalf: ${p.isHalf}`);
  }
}

run().catch(console.error);
