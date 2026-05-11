import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function debugSize55() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  const size55 = shapes.find(s => s.sizeName === '5.5');
  if (!size55) {
    console.error('Size 5.5 not found');
    return;
  }

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 1,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate270: true,
    algorithmVersion: 25
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  console.log('Running nesting for Size 5.5...');
  const resultData = await engine.testCapacity([size55], {
    ...config,
    parallelSizes: false
  });
  
  const result = resultData.sheetsBySize[size55.sizeName];
  console.log(`Result: ${result.actualPairs} pairs (${result.placedCount} pieces)`);
  
  // Kiểm tra va chạm chi tiết
  console.log('Validating overlaps and spacing...');
  const validation = validateLocalPlacements(result.placed, config.spacing);
  if (!validation.valid) {
    console.error('VALIDATION FAILED!');
    console.error(`Overlap count: ${validation.overlaps.length}`);
    validation.overlaps.slice(0, 5).forEach((o, i) => {
        console.error(`Overlap ${i+1}: Piece ${o.index1} and ${o.index2}`);
    });
  } else {
    console.log('Validation passed: No overlaps detected in results.');
  }
}

debugSize55().catch(console.error);
