import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  console.log(`Parsed ${shapes.length} shapes.`);
  console.log(`Available sizes: ${shapes.map(s => s.sizeName || s.name).join(', ')}\n`);

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
  };

  // Test a single medium size for quick comparison
  const sizeIndex = 10; // Size 8.5
  const testSize = {
    ...shapes[sizeIndex],
    sizeName: shapes[sizeIndex].sizeName || shapes[sizeIndex].name || `Size-${sizeIndex}`
  };

  console.log(`Testing size: ${testSize.sizeName} (index ${sizeIndex})\n`);

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const startTime = Date.now();
  const result = await nester.testCapacity([testSize], config);
  const elapsed = Date.now() - startTime;
  
  if (result && result.success) {
    const item = result.summary[0];
    const sheet = result.sheetsBySize?.[item.sizeName];
    const info = sheet?.patternInfo || {};
    
    console.log('--- Result ---');
    console.log(`Placed: ${item.placedCount} pieces`);
    console.log(`Pairs: ${item.pairs}`);
    console.log(`Efficiency: ${item.efficiency}%`);
    console.log(`Pattern: ${info.scanOrder}`);
    console.log(`Body: ${info.bodyCols}x${info.bodyRows}`);
    console.log(`dx=${info.bodyDxMm}, dy=${info.bodyDyMm}`);
    console.log(`rowShiftX=${info.rowShiftXmm}, rowShiftY=${info.rowShiftYmm}`);
    console.log(`colShiftY=${info.colShiftYmm || 0}`);
    console.log(`bodyPatternMode: ${info.bodyPatternMode}`);
    console.log(`Split fill: ${info.splitFillCount || 0}`);
    console.log(`Time: ${elapsed}ms`);
  }
}

run().catch(console.error);
