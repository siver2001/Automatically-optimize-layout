import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  for (const sizeName of ['12.5', '13']) {
    const sizeShape = shapes.find(s => s.sizeName === sizeName || s.name === sizeName);
    if (!sizeShape) continue;
    
    console.log(`\n================== SIZE ${sizeName} ==================`);
    const result = await engine.testCapacity([sizeShape], config);
    const sheet = result.sheetsBySize[sizeName];
    
    const wholes = sheet.placed.filter(p => !p.id?.includes('split') && !p.id?.includes('margin_fill'));
    const splits = sheet.placed.filter(p => p.id?.includes('split') || p.id?.includes('margin_fill'));
    
    console.log(`Wholes count: ${wholes.length}, Splits count: ${splits.length}`);
    
    console.log('Wholes (rightmost column/bottommost row):');
    wholes.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const w of wholes) {
      const wbb = getBoundingBox(w.polygon);
      console.log(`  Whole: id=${w.id}, x=${w.x.toFixed(2)}, y=${w.y.toFixed(2)}, minX=${wbb.minX.toFixed(2)}, maxX=${wbb.maxX.toFixed(2)}`);
    }
    
    console.log('Splits:');
    splits.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const s of splits) {
      const sbb = getBoundingBox(s.polygon);
      console.log(`  Split: id=${s.id}, foot=${s.foot}, x=${s.x.toFixed(2)}, y=${s.y.toFixed(2)}, minX=${sbb.minX.toFixed(2)}, maxX=${sbb.maxX.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
