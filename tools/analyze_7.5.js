import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

class DiagnosticEngine extends CapacityTestDoubleInsoleDoubleContourPattern {
  _evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    const isCritical = true;
    const fastMode = false;
    const pieceArea = parseFloat(polygon.area) || 20000;
    const step = 0.5;
    
    // We override this to print all candidates in candidatePool!
    const res = super._evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles);
    return res;
  }
}

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

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
    preparedSplitFillEnabled: false, // Turn off split fill to see base layouts
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false,
    doubleContourDeepSearch: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  const size = testSizes[0];
  console.log(`Analyzing base candidates for Size 7.5...`);
  
  // Let's modify the engine's behavior to intercept candidatePool before split filling
  // We'll capture candidatePool!
  const original_evaluateFootCandidateForAngles = engine._evaluateFootCandidateForAngles;
  engine._evaluateFootCandidateForAngles = function(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    // Call the original method but print candidatePool!
    // Since candidatePool is local inside _evaluateFootCandidateForAngles, we can't easily access it unless we instrument it.
    // Instead of instrumenting, let's look at how candidates are built.
    return original_evaluateFootCandidateForAngles.apply(this, arguments);
  };

  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['7.5'];
  console.log(`\nBase layout without splits:`);
  console.log(`Placed count: ${sheet.placedCount} | Pairs: ${sheet.actualPairs} | Efficiency: ${sheet.efficiency.toFixed(1)}%`);
}

run().catch(console.error);
