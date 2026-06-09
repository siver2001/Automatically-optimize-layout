import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const targetSize = shapes.find(shape => (shape.sizeName || shape.name) === '9.5');

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
  
  // Override alignMarginSplits to print details
  const origAlign = engine._alignMarginSplits;
  engine._alignMarginSplits = function(placements, config, workWidth, workHeight, sizeName) {
    console.log('\n--- INSIDE _alignMarginSplits for Size 9.5 ---');
    const res = origAlign.call(this, placements, config, workWidth, workHeight, sizeName);
    return res;
  };

  const res = await engine.testCapacity([targetSize], config);
  const sheet = res.sheetsBySize['9.5'];

  console.log('\n--- PLACED PIECES ---');
  const wholes = sheet.placed.filter(p => !p.id.includes('split'));
  const splits = sheet.placed.filter(p => p.id.includes('split'));

  console.log(`Wholes: ${wholes.length}, Splits: ${splits.length}`);
  if (splits.length > 0) {
    console.log('Sample Split Object:', JSON.stringify(splits[0], null, 2));
  }

  console.log('\n--- SPLITS ---');
  for (const s of splits) {
    const bb = s.orient?.bb || getBoundingBox(s.orient?.polygon || []);
    const distLeft = s.x + bb.minX;
    const distRight = config.sheetWidth - (s.x + bb.maxX);
    const distTop = s.y + bb.minY;
    const distBottom = config.sheetHeight - (s.y + bb.maxY);
    
    console.log(`Split ID: ${s.id} | x: ${s.x.toFixed(2)}, y: ${s.y.toFixed(2)} | foot: ${s.foot}`);
    console.log(`  distLeft: ${distLeft.toFixed(2)}, distRight: ${distRight.toFixed(2)}, distTop: ${distTop.toFixed(2)}, distBottom: ${distBottom.toFixed(2)}`);
    
    // Check closest wholes along X axis
    const sortedByXDiff = [...wholes].map(w => ({
      w,
      xDiff: Math.abs(w.x - s.x)
    })).sort((a, b) => a.xDiff - b.xDiff);
    
    console.log('  Top 3 closest wholes by X coordinate:');
    for (const item of sortedByXDiff.slice(0, 3)) {
      console.log(`    Whole ID: ${item.w.id} | x: ${item.w.x.toFixed(2)}, y: ${item.w.y.toFixed(2)} | xDiff: ${item.xDiff.toFixed(2)}mm`);
    }
  }
}

run().catch(console.error);
