import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const size4_5 = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).find(shape => shape.sizeName === '4.5');

  if (!size4_5) {
    console.error("Size 4.5 not found!");
    process.exit(1);
  }

  // Override _alignMarginSplits to log details
  const originalAlign = engine._alignMarginSplits;
  engine._alignMarginSplits = function(placements, cfg, workWidth, workHeight) {
    console.log("\n--- RUNNING _alignMarginSplits ---");
    console.log(`Input placements count: ${placements.length}`);
    const splits = placements.filter(p => this._isSplitFillPlacement(p));
    console.log(`Input splits count: ${splits.length}`);
    
    const results = originalAlign.call(this, placements, cfg, workWidth, workHeight);
    
    const outSplits = results.filter(p => this._isSplitFillPlacement(p));
    console.log(`Output splits count: ${outSplits.length}`);
    for (const p of splits) {
      const res = results.find(r => r.id === p.id);
      if (res) {
        console.log(`Split ID: ${p.id.padEnd(25)} | Before: X=${p.x.toFixed(2)}, Y=${p.y.toFixed(2)} | After: X=${res.x.toFixed(2)}, Y=${res.y.toFixed(2)}`);
      } else {
        console.log(`Split ID: ${p.id.padEnd(25)} | Before: X=${p.x.toFixed(2)}, Y=${p.y.toFixed(2)} | DROPPED!`);
      }
    }
    return results;
  };

  const res = await engine.testCapacity([size4_5], config);
  console.log(`\nPairs placed: ${res.summary[0].pairs}`);
}

run().catch(console.error);
