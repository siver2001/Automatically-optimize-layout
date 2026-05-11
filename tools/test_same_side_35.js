import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestSameSidePattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  console.log(`Successfully parsed ${shapes.length} shapes from DXF.\n`);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    gridStep: 1,
    capacityLayoutMode: 'same-side-banded',
    allowRotate180: true,
    parallelSizes: true
  };

  const nester = new CapacityTestSameSidePattern(config);

  // Filter only size 3.5
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(s => s.sizeName === '3.5');

  if (testSizes.length === 0) {
    console.error('Size 3.5 not found in DXF');
    process.exit(1);
  }

  console.log(`Running capacity test for size 3.5 using CapacityTestSameSidePattern...`);
  console.log(`Config: ${config.sheetWidth}x${config.sheetHeight}, margin ${config.marginX}/${config.marginY}, spacing ${config.spacing}\n`);
  
  const startTime = Date.now();
  const result = await nester.testCapacity(testSizes, config);
  const elapsed = Date.now() - startTime;
  
  if (result && result.success) {
    console.log('--- Capacity Test Results (SameSidePattern) ---');
    console.log('| Size | Pieces (Pairs if 1:1) | Efficiency | Time |');
    console.log('|------|-----------------------|------------|------|');
    
    result.summary.forEach(item => {
      console.log(`| ${item.sizeName.padEnd(5)} | ${item.placedCount.toString().padEnd(21)} | ${item.efficiency.toString().padEnd(10)} | ${elapsed}ms |`);
    });
    
    const sheet = result.sheetsBySize?.['3.5'];
    if (sheet && sheet.patternInfo) {
        console.log('\nPattern Details:');
        console.log(JSON.stringify(sheet.patternInfo, null, 2));
    }
  } else {
    console.error('Capacity test failed:', result);
  }
}

run().catch(console.error);
