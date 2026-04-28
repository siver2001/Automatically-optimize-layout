import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapesWithAnalysis } from './server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from './server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function runTest() {
  const files = [
    {
      name: 'ONRUNNING',
      path: 'ONRUNNING-DC-20744-M(DAO GO LUXIN)-MSFS-FREEVIEW-D-0529-2025-03-28(DINH DANG LUXIN).dxf'
    },
    {
      name: 'PUMA',
      path: 'PUMA-DC-HE-019(DAOGOLUXIN)-UKFS-VMC-D-0393-2024-07-31(DINH DANG LUXIN).dxf'
    }
  ];

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    spacing: 3,
    marginX: 5,
    marginY: 5,
    allowRotate90: true,
    allowRotate180: false,
    pairingStrategy: 'same-side',
    mirrorPairs: false,
    capacityLayoutMode: 'same-side-double-contour',
    parallelSizes: true,
    gridStep: 0.5,
    preparedSplitFillDeep: false
  };

  for (const file of files) {
    console.log(`\n=== Testing file: ${file.name} ===`);
    const buffer = fs.readFileSync(file.path);
    const { shapes } = await parseCadBufferToSizedShapesWithAnalysis(buffer, file.path);
    
    const sizeList = shapes.map(s => ({
      sizeName: s.sizeName,
      sizeValue: s.sizeValue,
      polygon: s.polygon,
      internals: s.internals
    }));

    console.log(`Parsed ${sizeList.length} sizes from ${file.name}.`);

    const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
    const startTime = Date.now();
    const result = await nester.testCapacity(sizeList, config);
    const durationMs = Date.now() - startTime;

    console.log(`Results for ${file.name}:`);
    console.log(`Total Time: ${(durationMs / 1000).toFixed(2)}s`);
    
    for (const summary of result.summary) {
      console.log(`Size ${summary.sizeName}: ${summary.placedCount} pieces`);
    }
  }
}

runTest().catch(console.error);
