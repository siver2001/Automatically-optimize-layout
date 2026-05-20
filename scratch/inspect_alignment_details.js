import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size9_5 = shapes.find(shape => {
    const name = shape.sizeName || shape.name;
    return name === '9.5' || name === '9_5' || name === '95';
  });

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
  
  // Intercept the candidate right before finalizing to inspect placements
  const originalFinalizeCandidate = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly = true) {
    // Run normal alignment
    console.log("\n--- Running _finalizeCandidate ---");
    console.log("Input Placements (only split fills shown):");
    candidate.placements.forEach(p => {
      if (this._isSplitFillPlacement(p)) {
        const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
        console.log(`  ID: ${p.id} | x: ${p.x.toFixed(3)} | y: ${p.y.toFixed(3)} | foot: ${p.orient.foot} | angle: ${p.orient.angle} | outwardSide: ${p.orient.splitOutwardSide}`);
      }
    });

    const res = originalFinalizeCandidate.call(this, candidate, config, workWidth, workHeight, fastOnly);
    
    if (res && res.placements) {
      console.log("Output Placements (only split fills shown):");
      res.placements.forEach(p => {
        if (this._isSplitFillPlacement(p)) {
          const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
          console.log(`  ID: ${p.id} | x: ${p.x.toFixed(3)} | y: ${p.y.toFixed(3)} | foot: ${p.orient.foot} | angle: ${p.orient.angle} | outwardSide: ${p.orient.splitOutwardSide}`);
        }
      });
    } else {
      console.log("Candidate was DISCARDED!");
    }
    
    return res;
  };
  
  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
