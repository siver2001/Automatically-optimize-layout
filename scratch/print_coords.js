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
  const shape = shapes.find(s => String(s.sizeName || s.name) === '3.5');
  const res = await engine.testCapacity([shape], config);
  const sheet = res.sheetsBySize['3.5'];

  console.log('--- WHOLE PIECES ---');
  const wholes = sheet.placed.filter(p => !String(p.foot || '').startsWith('split-') && !String(p.id || '').includes('split_fill'));
  wholes.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const w of wholes) {
    console.log(`Whole ID: ${w.id} | x: ${w.x.toFixed(2)}, y: ${w.y.toFixed(2)}`);
  }

  console.log('\n--- SPLIT PIECES ---');
  const splits = sheet.placed.filter(p => String(p.foot || '').startsWith('split-') || String(p.id || '').includes('split_fill'));
  splits.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const s of splits) {
    console.log(`Split ID: ${s.id} | x: ${s.x.toFixed(2)}, y: ${s.y.toFixed(2)} | foot: ${s.foot}`);
  }
}

run().catch(console.error);
