import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestPrePairedSameSidePattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestPrePairedSameSidePattern.js';

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
    capacityLayoutMode: 'same-side-prepaired-tight',
    allowRotate180: true,
    allowRotate270: true, // Custom flag we might use
    parallelSizes: true
  };

  // Subclass to override angles for testing
  class CustomPrePairedNester extends CapacityTestPrePairedSameSidePattern {
    _getPreferredAngles() {
      return [0, 90, 180, 270];
    }
  }

  const nester = new CustomPrePairedNester(config);

  // Filter only size 3.5
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(s => s.sizeName === '3.5');

  if (testSizes.length === 0) {
    console.error('Size 3.5 not found in DXF');
    process.exit(1);
  }

  console.log(`Running capacity test for size 3.5 using CapacityTestPrePairedSameSidePattern (Ghép sẵn)...`);
  console.log(`Config: ${config.sheetWidth}x${config.sheetHeight}, margin ${config.marginX}/${config.marginY}, spacing ${config.spacing}\n`);
  
  const startTime = Date.now();
  const result = await nester.testCapacity(testSizes, config);
  const elapsed = Date.now() - startTime;
  
  if (result && result.success) {
    console.log('--- Capacity Test Results (PrePaired Pattern) ---');
    console.log('| Size | Pairs | Pieces | Efficiency | Time |');
    console.log('|------|-------|--------|------------|------|');
    
    result.summary.forEach(item => {
      console.log(`| ${item.sizeName.padEnd(5)} | ${item.pairs.toString().padEnd(5)} | ${item.placedCount.toString().padEnd(6)} | ${item.efficiency.toString().padEnd(10)} | ${elapsed}ms |`);
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
