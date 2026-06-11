import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size6 = shapes.find(s => s.sizeName === '6');
  
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

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config1080);
  
  // Intercept the candidate that had 53 placements and failed validation
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, wW, wH, fastOnly, validate) {
    const res = originalFinalize.call(this, candidate, config, wW, wH, fastOnly, validate);
    if (!res && validate && candidate.bodyPrimaryAngle === 0 && candidate.bodyAlternateAngle === 0 && candidate.placements.length === 53) {
      console.log(`\n=== FOUND FAILING 53-PLACEMENT CANDIDATE FOR Size 6 ===`);
      let alignedPlacements = this._alignMarginSplits(candidate.placements, config, wW, wH, candidate.sizeName);
      alignedPlacements = this._resolveOverlapPlacements(alignedPlacements, config.spacing || 0);
      
      const spacing = config.spacing || 0;
      // Let's run a manual check of overlaps to print which pairs overlap!
      for (let i = 0; i < alignedPlacements.length; i++) {
        for (let j = i + 1; j < alignedPlacements.length; j++) {
          const pA = alignedPlacements[i];
          const pB = alignedPlacements[j];
          
          const bbA = pA.orient?.bb || getBoundingBox(pA.orient?.polygon || []);
          const bbB = pB.orient?.bb || getBoundingBox(pB.orient?.polygon || []);
          
          const overlap = cachedPolygonsOverlap(
            pA.orient.polygon,
            pB.orient.polygon,
            { x: pA.x, y: pA.y },
            { x: pB.x, y: pB.y },
            spacing,
            bbA,
            bbB
          );
          if (overlap) {
            console.log(`  OVERLAP detected between:`);
            console.log(`    A: id=${pA.id}, x=${pA.x.toFixed(1)}, y=${pA.y.toFixed(1)}, foot=${pA.orient?.foot}`);
            console.log(`    B: id=${pB.id}, x=${pB.x.toFixed(1)}, y=${pB.y.toFixed(1)}, foot=${pB.orient?.foot}`);
          }
        }
      }
    }
    return res;
  };

  await engine.testCapacity([size6], config1080);
}

run().catch(console.error);
