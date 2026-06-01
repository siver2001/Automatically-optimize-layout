import fs from 'fs';
import path from 'path';
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
  const sizeInfo = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  
  // Intercept _finalizeCandidate
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, ...args) {
    console.log("INSIDE _finalizeCandidate:");
    console.log("Candidate placements count:", candidate.placements.length);
    const missingIds = candidate.placements.filter(p => !p.id);
    console.log("Placements missing 'id':", missingIds.length);
    if (missingIds.length > 0) {
      console.log("First missing ID placement keys:", Object.keys(missingIds[0]), "foot:", missingIds[0].foot);
    }
    return originalFinalize.call(this, candidate, ...args);
  };

  await engine.testCapacity([sizeInfo], config);
}

run().catch(console.error);
