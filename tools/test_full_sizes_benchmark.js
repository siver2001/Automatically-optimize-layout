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
  console.log(`Successfully parsed ${shapes.length} shapes from DXF.\n`);

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
    parallelSizes: true // Use parallel processing for speed
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  // Test all sizes
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  }));

  console.log(`Running capacity test for ${testSizes.length} sizes...`);
  console.log(`Config: ${config.sheetWidth}x${config.sheetHeight}, margin ${config.marginX}/${config.marginY}, spacing ${config.spacing}\n`);
  
  const startTime = Date.now();
  const result = await nester.testCapacity(testSizes, config);
  const elapsed = Date.now() - startTime;
  
  if (result && result.success) {
    console.log('--- Capacity Test Results ---');
    console.log('| Size | Pairs | Pieces | Efficiency | Split Fill |');
    console.log('|------|-------|--------|------------|------------|');
    
    result.summary.forEach(item => {
      const sheet = result.sheetsBySize?.[item.sizeName];
      const patternInfo = sheet?.patternInfo || {};
      const splitN = patternInfo.splitFillCount || 0;
      console.log(`| ${item.sizeName.padEnd(5)} | ${item.pairs.toString().padEnd(5)} | ${item.placedCount.toString().padEnd(6)} | ${item.efficiency.toString().padEnd(10)} | ${splitN} |`);
    });
    console.log(`\nTotal time: ${elapsed}ms`);
  } else {
    console.error('Capacity test failed:', result);
  }
}

run().catch(console.error);
