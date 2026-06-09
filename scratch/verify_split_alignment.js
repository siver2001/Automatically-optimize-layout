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
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Test all sizes
  for (const shape of shapes) {
    const sizeName = String(shape.sizeName || shape.name);
    console.log(`\n==========================================`);
    console.log(`Running capacity test for Size ${sizeName}...`);
    const res = await engine.testCapacity([shape], config);
    const sheet = res.sheetsBySize[sizeName];
    if (!sheet) {
      console.log(`No sheet generated for Size ${sizeName}`);
      continue;
    }

    const placed = sheet.placed;
    const splits = placed.filter(p => String(p.foot || '').startsWith('split-') || String(p.id || '').includes('split_fill'));
    const wholes = placed.filter(p => !String(p.foot || '').startsWith('split-') && !String(p.id || '').includes('split_fill'));

    console.log(`Total pieces: ${placed.length} (Wholes: ${wholes.length}, Splits: ${splits.length})`);

    if (splits.length > 0) {
      console.log('--- Checking Split Pieces Alignment ---');
      for (const s of splits) {
        // Find closest whole piece horizontally or vertically
        const sortedWholes = [...wholes].sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x));
        const closest = sortedWholes[0];
        const xDiff = Math.abs(s.x - closest.x);
        
        console.log(`Split Piece ID: ${s.id} (foot: ${s.foot})`);
        console.log(`  Split Pos: (${s.x.toFixed(2)}, ${s.y.toFixed(2)})`);
        if (closest) {
          console.log(`  Closest Whole Pos: (${closest.x.toFixed(2)}, ${closest.y.toFixed(2)}) | ID: ${closest.id}`);
          console.log(`  X alignment difference: ${xDiff.toFixed(2)}mm`);
        }
      }
    }
  }
}

run().catch(console.error);
