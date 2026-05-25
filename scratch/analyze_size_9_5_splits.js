import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'NIKE DC QA-7(DAO GO LUXIN) MSFS CHINGLUH D-0263 -2025-03-25(DINH DANG LUXIN).dxf';
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
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const size9_5 = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).find(shape => shape.sizeName === '9.5');

  if (!size9_5) {
    console.error("Size 9.5 not found!");
    process.exit(1);
  }

  // We override _alignMarginSplits to log the exact inputs and outputs of our new logic
  const originalAlign = engine._alignMarginSplits;
  engine._alignMarginSplits = function(placements, cfg, workWidth, workHeight) {
    console.log("\n--- RUNNING NEW _alignMarginSplits ---");
    
    // Save original coordinates before execution to prevent mutation reference print issue
    const originalCoords = {};
    for (const p of placements) {
      if (this._isSplitFillPlacement(p)) {
        originalCoords[p.id] = { x: p.x, y: p.y };
      }
    }
    
    // Call the actual modified function
    const results = originalAlign.call(this, placements, cfg, workWidth, workHeight);
    
    // Print the before and after coordinates of all split pieces using saved copies
    for (const p of placements) {
      if (!this._isSplitFillPlacement(p)) continue;
      const orig = originalCoords[p.id];
      const res = results.find(r => r.id === p.id);
      if (orig && res) {
        console.log(`Split ID: ${p.id.padEnd(20)} | Before: X=${orig.x.toFixed(2)}, Y=${orig.y.toFixed(2)} | After: X=${res.x.toFixed(2)}, Y=${res.y.toFixed(2)}`);
      }
    }
    
    return results;
  };

  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
