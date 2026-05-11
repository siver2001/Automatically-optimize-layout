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
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3.0, // Strict 3.0mm spacing
    staggerSpacing: 3.0,
    gridStep: 1,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
  };

  const sizesToTest = shapes.filter(s => {
    const name = s.sizeName || s.name || '';
    return name === '4' || name === '4.5';
  });

  console.log(`Testing Yield Recovery for Sizes: ${sizesToTest.map(s => s.sizeName || s.name).join(', ')}`);
  console.log(`Config Spacing: ${config.spacing}mm\n`);

  for (const testSize of sizesToTest) {
    console.log(`\n>>> Size: ${testSize.sizeName || testSize.name}`);
    const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
    
    const startTime = Date.now();
    const result = await nester.testCapacity([testSize], config);
    const elapsed = Date.now() - startTime;
    
    if (result && result.success) {
      const item = result.summary[0];
      const sheet = result.sheetsBySize?.[item.sizeName];
      const info = sheet?.patternInfo || {};
      
      console.log(`Result: ${item.placedCount} pieces (${item.pairs} pairs)`);
      console.log(`Layout: ${info.bodyCols} cols x ${info.bodyRows} rows`);
      console.log(`Split pieces: ${info.splitFillCount || 0}`);
      console.log(`Efficiency: ${item.efficiency}%`);
      console.log(`Search Time: ${elapsed}ms`);
      
      if (item.pairs < 60) {
        console.warn(`[FAIL] Still at ${item.pairs} pairs. Target is 60.`);
      } else {
        console.log(`[SUCCESS] Found ${item.pairs} pairs!`);
      }
    } else {
      console.log('Nesting failed or returned no result.');
    }
  }
}

run().catch(console.error);
