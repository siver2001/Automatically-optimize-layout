import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config1080 = {
    sheetWidth: 1080,
    sheetHeight: 1980,
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

  for (const sizeName of ['6', '6.5']) {
    const size = shapes.find(s => s.sizeName === sizeName);
    const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config1080);
    
    // We will intercept the finalized candidates for angle 0
    let bestCand = null;
    const originalFinalize = engine._finalizeCandidate;
    engine._finalizeCandidate = function(candidate, config, wW, wH, fastOnly, validate) {
      const res = originalFinalize.call(this, candidate, config, wW, wH, fastOnly, validate);
      if (res && (candidate.bodyPrimaryAngle === 0 && candidate.bodyAlternateAngle === 0)) {
        if (!bestCand || res.actualPairs > bestCand.actualPairs) {
          bestCand = res;
        }
      }
      return res;
    };

    await engine.testCapacity([size], config1080);
    
    console.log(`\n==================================================`);
    console.log(`Size ${sizeName} BEST Angle 0 Candidate:`);
    if (bestCand) {
      console.log(`  Pairs: ${bestCand.actualPairs}`);
      console.log(`  Placed Count: ${bestCand.placedCount}`);
      console.log(`  Placements length: ${bestCand.placements.length}`);
      console.log(`  Bounds: minX=${bestCand.bounds.minX.toFixed(1)}, maxX=${bestCand.bounds.maxX.toFixed(1)}, minY=${bestCand.bounds.minY.toFixed(1)}, maxY=${bestCand.bounds.maxY.toFixed(1)}`);
      // Print first 5 and last 5 placements sorted by y then x
      const sortedPlacements = [...bestCand.placements].sort((a, b) => a.y - b.y || a.x - b.x);
      console.log(`  Placements (first 5):`);
      sortedPlacements.slice(0, 5).forEach((p, i) => {
        console.log(`    #${i}: id=${p.id}, x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, foot=${p.orient?.foot}`);
      });
      console.log(`  Placements (last 5):`);
      sortedPlacements.slice(-5).forEach((p, i) => {
        console.log(`    #${sortedPlacements.length - 5 + i}: id=${p.id}, x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, foot=${p.orient?.foot}`);
      });
    } else {
      console.log(`  No Angle 0 candidate found!`);
    }
  }
}

run().catch(console.error);
