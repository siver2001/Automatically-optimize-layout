import fs from 'fs';
import { parseCadBufferToSizedShapesWithAnalysis } from './server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from './server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  console.log(`Reading ${dxfFile}...`);
  const buffer = fs.readFileSync(dxfFile);
  
  console.log('Parsing DXF...');
  const { shapes } = await parseCadBufferToSizedShapesWithAnalysis(buffer, dxfFile, 3.0, 0.5);
  const testShapes = shapes.sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));
  console.log(`Testing ${testShapes.length} sizes:`, testShapes.map(s => s.sizeName).join(', '));

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    spacing: 5,
    staggerSpacing: 20,
    marginX: 4,
    marginY: 4,
    allowRotate90: true,
    allowRotate180: true,
    gridStep: 0.5,
    pairingStrategy: 'same-side',
    capacityLayoutMode: 'same-side-double-contour',
    layers: 1,
    nestingStrategy: 'single-size-per-sheet',
    parallelSizes: true,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  console.log('Testing capacity...');
  const result = await nester.testCapacity(testShapes, config);
  
  console.log('\n--- Backtest Results ---');
  console.table(result.summary.map(s => ({
    Size: s.sizeName,
    Total: s.placedCount,
    Pairs: s.pairs,
    DC: s.dcCount,
    Split: s.splitPairCount,
    Eff: s.efficiency + '%'
  })));
}

run().catch(console.error);
