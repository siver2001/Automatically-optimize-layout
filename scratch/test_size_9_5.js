import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';

async function run() {
  clearCapacityResultCache();
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const targetSize = shapes.find(shape => (shape.sizeName || shape.name) === '9.5');
  if (!targetSize) {
    console.error('Size 9.5 not found in DXF!');
    process.exit(1);
  }

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
  }

  const engine = new VerbosePattern(config);
  
  const origAugment = engine._augmentCandidateWithSplitFillers;
  engine._augmentCandidateWithSplitFillers = function(sizeName, polygon, candidate, config, workWidth, workHeight, bestCandidate) {
    const res = origAugment.call(this, sizeName, polygon, candidate, config, workWidth, workHeight, bestCandidate);
    console.log(`[Augment Detail] Base placements: ${candidate.placements.length} | Base pairs: ${candidate.actualPairs} | BestPairs before: ${bestCandidate ? bestCandidate.actualPairs : 0} | Result pairs: ${res ? res.actualPairs : 0}`);
    return res;
  };

  console.log('Starting capacity test for Size 9.5...');
  const startTime = Date.now();
  const res = await engine.testCapacity([targetSize], config);
  const endTime = Date.now();
  console.log(`Finished in ${((endTime - startTime)/1000).toFixed(2)}s`);
  console.log(res.summary);
}

run().catch(console.error);
