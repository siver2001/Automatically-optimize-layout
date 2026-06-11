import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size4_5 = shapes.find(s => s.sizeName === '4.5');
  if (!size4_5) {
    console.error('Size 4.5 not found');
    return;
  }

  const config1070 = {
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

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config1070);
  const res1070 = await engine.testCapacity([size4_5], config1070);
  console.log('--- 1070x1970 PLACEMENTS ---');
  console.log(`Pairs: ${res1070.summary[0].pairs}`);
  const sheet = res1070.sheetsBySize['4.5'];
  if (sheet && sheet.placed) {
    const angleCounts = {};
    const footCounts = {};
    for (const p of sheet.placed) {
      const angle = p.orient?.angle ?? p.angle ?? 0;
      angleCounts[angle] = (angleCounts[angle] || 0) + 1;
      const foot = p.orient?.foot ?? p.foot ?? 'unknown';
      footCounts[foot] = (footCounts[foot] || 0) + 1;
    }
    console.log('Angles:', angleCounts);
    console.log('Feet:', footCounts);
  }
}

run().catch(console.error);
