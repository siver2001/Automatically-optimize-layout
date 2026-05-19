import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size35 = shapes.find(s => s.sizeName === '3.5' || s.name === '3.5');

  const configs = [
    { name: "allowRotate180 = true", allowRotate180: true },
    { name: "allowRotate180 = false", allowRotate180: false }
  ];

  for (const c of configs) {
    const config = {
      sheetWidth: 1100,
      sheetHeight: 2000,
      marginX: 5,
      marginY: 20,
      spacing: 4,
      staggerSpacing: 4,
      gridStep: 0.5,
      preparedSplitFillEnabled: true,
      preparedSplitFillDeep: false,
      capacityLayoutMode: 'same-side-double-contour',
      allowRotate180: c.allowRotate180,
    };

    const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
    const result = await engine.testCapacity([size35], config);
    const item = result.summary[0];
    console.log(`Config [${c.name}]: Pairs = ${item.pairs}, Efficiency = ${item.efficiency.toFixed(1)}%`);
  }
}

run().catch(console.error);
