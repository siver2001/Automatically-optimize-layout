import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5, // Finer grid
    preparedSplitFillEnabled: true,
    preparedSplitFillCandidateLimit: 40, // Increased limit
    preparedSplitFillMaxPieces: 20, // Increased max extra pieces
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const size35 = shapes.find(s => (s.sizeName || s.name) === '3.5');
  
  console.log(`Optimizing Size 3.5...`);
  const result = await nester.testCapacity([size35], config);
  
  if (result && result.summary) {
    console.log(`Size 3.5 Result: ${result.summary[0].pairs} pairs (${result.summary[0].placedCount} pieces)`);
    console.log(`Efficiency: ${result.summary[0].efficiency}%`);
  }
}

run().catch(console.error);
