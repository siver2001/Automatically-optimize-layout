import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';

async function run() {
  console.log('[Test 1080x1980] Clearing capacity result cache to measure actual calculation speed...');
  clearCapacityResultCache();

  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1080,
    sheetHeight: 1980,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Running full test for ${testSizes.length} sizes with sheet dimensions 1080x1980...`);
  const startTime = performance.now();
  const res = await engine.testCapacity(testSizes, config);
  const endTime = performance.now();
  const durationSec = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log("\n=== ALL SIZES CAPACITY RESULTS (1080x1980) ===");
  let fileOutput = `=== ALL SIZES CAPACITY RESULTS (1080x1980) (Calculated in ${durationSec}s) ===\n`;
  for (const item of (res.summary || [])) {
    const line = `Size: ${item.sizeName.padEnd(5)} | Pairs: ${String(item.pairs).padEnd(5)} | Efficiency: ${item.efficiency.toFixed(1)}%`;
    console.log(line);
    fileOutput += line + "\n";
  }

  const outputFilePath = path.join(process.cwd(), 'capacity_results_1080_1980.txt');
  fs.writeFileSync(outputFilePath, fileOutput, 'utf8');
  console.log(`\n[Success] Nesting results successfully saved to: ${outputFilePath}`);
}

run().catch(console.error);
