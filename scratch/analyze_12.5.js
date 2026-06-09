import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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
  
  // Enable debug logging for candidate search
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly, validate) {
    const res = originalFinalize.call(this, candidate, config, workWidth, workHeight, fastOnly, validate);
    const placedCount = candidate?.placements?.length || 0;
    if (placedCount >= 37) {
      console.log(`[Debug 12.5] Candidate with ${placedCount} placements. Finalized result: ${res ? 'SUCCESS (' + res.length + ')' : 'FAILED'}`);
    }
    return res;
  };

  const shape = shapes.find(s => String(s.sizeName || s.name) === '12.5');
  if (!shape) {
    console.error('Size 12.5 not found');
    return;
  }

  console.log('Running test for Size 12.5...');
  const res = await engine.testCapacity([shape], config);
  console.log('Result for Size 12.5:', res.summary[0]);
}

run().catch(console.error);
