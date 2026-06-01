import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';
import { validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
  const sizeInfo = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly, validate) {
    if (candidate.placements.length === 49) {
      console.log("\n--- TRACING PLACEMENT DETAILS (length = 49) ---");
      candidate.placements.forEach((p, idx) => {
        const isSplit = !!(p.isSplit || p.id?.includes('split') || p.id?.startsWith('margin_fill_'));
        console.log(`[${idx}] id: ${p.id}, foot: ${p.orient?.foot || p.foot}, isSplit: ${isSplit}, x: ${p.x}, y: ${p.y}`);
      });

      const aligned = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight, candidate.sizeName);
      console.log("\n--- AFTER ALIGNMENT ---");
      aligned.forEach((p, idx) => {
        const isSplit = !!(p.isSplit || p.id?.includes('split') || p.id?.startsWith('margin_fill_'));
        console.log(`[${idx}] id: ${p.id}, foot: ${p.orient?.foot || p.foot}, isSplit: ${isSplit}, x: ${p.x}, y: ${p.y}`);
      });
      
      const validationAfter = validateLocalPlacements(aligned, config.spacing || 0);
      console.log("\nvalidateLocalPlacements AFTER alignment:", validationAfter.valid, "reason:", validationAfter.reason, "pair:", validationAfter.pair);
    }
    return originalFinalize.call(this, candidate, config, workWidth, workHeight, fastOnly, validate);
  };

  await engine.testCapacity([sizeInfo], config);
}

run().catch(console.error);
