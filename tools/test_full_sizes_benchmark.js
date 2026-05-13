import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

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
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  }));

  console.log(`Running capacity test for ${testSizes.length} sizes...`);
  console.log(`Config: ${config.sheetWidth}x${config.sheetHeight}, margin ${config.marginX}/${config.marginY}, spacing ${config.spacing}\n`);
  
  const startTime = Date.now();
  const res = await engine.testCapacity(testSizes, config);
  const totalDuration = (Date.now() - startTime) / 1000;

  const finalResults = (res.summary || []).map((summary) => ({
    'Size': summary.sizeName,
    'Pairs': summary.pairs,
    'Efficiency': (summary.efficiency).toFixed(1) + '%',
    'Time (s)': summary.timeMs ? (summary.timeMs / 1000).toFixed(1) : 'N/A'
  }));

  let outputText = '';
  outputText += '='.repeat(60) + '\n';
  outputText += 'BENCHMARK RESULTS: Double Contour Nesting Strategy\n';
  outputText += `Timestamp: ${new Date().toLocaleString()}\n`;
  outputText += `Input File: ${dxfFile}\n`;
  outputText += `Config: ${config.sheetWidth}x${config.sheetHeight}, margin ${config.marginX}/${config.marginY}, spacing ${config.spacing}\n`;
  outputText += '='.repeat(60) + '\n\n';

  // Table header
  outputText += `${'Size'.padEnd(10)} | ${'Pairs'.padEnd(10)} | ${'Efficiency'.padEnd(12)} | ${'Time (s)'.padEnd(10)}\n`;
  outputText += '-'.repeat(60) + '\n';

  for (const item of (res.summary || [])) {
    const timeS = item.timeMs ? (item.timeMs / 1000).toFixed(1) : 'N/A';
    const row = `${item.sizeName.padEnd(12)} | ${String(item.pairs).padEnd(10)} | ${item.efficiency.toFixed(1).padEnd(12)} | ${timeS}`;
    console.log(row);
    outputText += row + '\n';
  }

  const totalTimeS = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgSummaryLength = (res.summary || []).length;
  const avgTimeS = (avgSummaryLength > 0 ? (totalTimeS / avgSummaryLength) : 0).toFixed(2);
  
  const footer = `
============================================================
TOTAL TIME: ${totalTimeS}s for ${avgSummaryLength} sizes
AVERAGE TIME: ${avgTimeS}s per size
============================================================
`;

  outputText += footer;

  const outputFile = `benchmark_results_${Date.now()}.txt`;
  fs.writeFileSync(outputFile, outputText);

  console.log('\n' + '='.repeat(50));
  console.log('FINAL BENCHMARK SUMMARY');
  console.log(`Total Time: ${totalDuration.toFixed(1)}s for ${testSizes.length} sizes`);
  console.log(`Results saved to: ${outputFile}`);
  console.log('='.repeat(50));
  console.table(finalResults);
  console.log('='.repeat(50));
}

run().catch(console.error);
