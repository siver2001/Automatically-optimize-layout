import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';

async function run() {
  clearCapacityResultCache();
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

  class VerbosePattern extends CapacityTestDoubleInsoleDoubleContourPattern {
    _evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
      const res = super._evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles);
      return res;
    }
  }

  const engine = new VerbosePattern(config);
  
  // Monkey patch _augmentCandidateWithSplitFillers to print details
  const origAugment = engine._augmentCandidateWithSplitFillers;
  engine._augmentCandidateWithSplitFillers = function(sizeName, polygon, candidate, config, workWidth, workHeight, bestCandidate) {
    const res = origAugment.call(this, sizeName, polygon, candidate, config, workWidth, workHeight, bestCandidate);
    console.log(`[Augment Detail] Base placements: ${candidate.placements.length} | Base pairs: ${candidate.actualPairs} | BestPairs before: ${bestCandidate ? bestCandidate.actualPairs : 0} | Result pairs: ${res ? res.actualPairs : 0}`);
    return res;
  };

  const size8 = shapes.find(shape => (shape.sizeName || shape.name) === '8');
  console.log(`Running verbosely for Size 8...`);
  await engine.testCapacity([size8], config);
}

run().catch(console.error);
