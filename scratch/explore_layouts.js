import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size125 = shapes.find(s => s.sizeName === '12.5');

  const configs = [
    { name: 'GridStep 0.5, Deep true', gridStep: 0.5, preparedSplitFillDeep: true },
    { name: 'GridStep 1.0, Deep true', gridStep: 1.0, preparedSplitFillDeep: true },
    { name: 'GridStep 2.0, Deep false', gridStep: 2.0, preparedSplitFillDeep: false },
    { name: 'GridStep 3.0, Deep false', gridStep: 3.0, preparedSplitFillDeep: false },
  ];

  for (const cfg of configs) {
    const config = {
      sheetWidth: 1100,
      sheetHeight: 2000,
      marginX: 5,
      marginY: 20,
      spacing: 3,
      staggerSpacing: 3,
      preparedSplitFillEnabled: true,
      capacityLayoutMode: 'same-side-double-contour',
      allowRotate180: true,
      ...cfg
    };

    const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
    const result = await engine.testCapacity([size125], config);
    const sheet = result.sheetsBySize['12.5'];
    const wholes = sheet.placed.filter(p => !p.id?.startsWith('margin_fill_') && !p.isSplit);
    const splits = sheet.placed.filter(p => p.id?.startsWith('margin_fill_') || p.isSplit);
    
    console.log(`Config: ${cfg.name}`);
    console.log(`  Wholes: ${wholes.length}, Splits: ${splits.length}`);
    splits.forEach(s => {
      console.log(`    Split: id=${s.id}, foot=${s.foot}, x=${s.x.toFixed(2)}, y=${s.y.toFixed(2)}`);
    });
  }
}
run();
