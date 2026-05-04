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
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  // Test first 5 sizes to see a quick summary
  const testSizes = shapes.slice(0, Math.min(5, shapes.length)).map(shape => ({
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
    result.summary.forEach(item => {
      const sheet = result.sheetsBySize?.[item.sizeName];
      const patternInfo = sheet?.patternInfo || {};
      console.log(`Size: ${item.sizeName}`);
      console.log(`  Placed: ${item.placedCount} pieces, Pairs: ${item.pairs}`);
      console.log(`  Efficiency: ${item.efficiency}%`);
      console.log(`  Pattern: ${patternInfo.scanOrder || 'N/A'}`);
      console.log(`  Body: ${patternInfo.bodyCols}x${patternInfo.bodyRows}, dx=${patternInfo.bodyDxMm}, dy=${patternInfo.bodyDyMm}`);
      console.log(`  Shift: rowX=${patternInfo.rowShiftXmm}, rowY=${patternInfo.rowShiftYmm}, colY=${patternInfo.colShiftYmm || 0}`);
      console.log(`  Split fill: ${patternInfo.splitFillCount || 0} pieces, pairs: ${patternInfo.splitPairCount || 0}`);
      console.log('');
    });
    console.log(`Total time: ${elapsed}ms`);
  } else {
    console.error('Capacity test failed:', result);
  }
}

run().catch(console.error);
