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
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 1,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    parallelSizes: true,
    parallelWorkerCount: 8
  };

  const testSizes = shapes.filter(s => s.sizeName === '8.5');

  console.log(`Testing all ${testSizes.length} sizes from DXF with 8 workers...\n`);

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const startTime = Date.now();
  const result = await nester.testCapacity(testSizes, config);
  const elapsed = Date.now() - startTime;
  
  if (result && result.success) {
    console.log('\n--- FINAL TEST RESULTS ---');
    console.log(`Total Time: ${elapsed}ms\n`);
    
    const sortedSummary = [...result.summary].sort((a, b) => {
        const valA = parseFloat(a.sizeName);
        const valB = parseFloat(b.sizeName);
        return valB - valA;
    });

    sortedSummary.forEach(item => {
      const sheet = result.sheetsBySize?.[item.sizeName];
      const info = sheet?.patternInfo || {};
      console.log(`Size ${item.sizeName}: ${item.pairs} Pairs (${item.totalPieces} Pieces)`);
      console.log(`  Pattern: ${info.scanOrder}`);
      console.log(`  Efficiency: ${item.efficiency}%`);
      console.log('-----------------------------');
    });

    for (let i = 0; i < sortedSummary.length - 1; i++) {
        if (sortedSummary[i].pairs > sortedSummary[i+1].pairs) {
            console.log(`[!] Monotonicity Warning: Size ${sortedSummary[i+1].sizeName} has FEWER pairs than Size ${sortedSummary[i].sizeName}`);
        }
    }
  }
}

run().catch(console.error);
