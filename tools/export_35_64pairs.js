import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
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
    allowRotate180: true,
    parallelSizes: true // Enable parallel
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  // Filter size 3.5 and 4 to trigger parallel
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(s => ['3.5', '4'].includes(s.sizeName));

  console.log(`Running Double Contour nesting for size 3.5 to export DXF...`);
  
  const result = await nester.testCapacity(testSizes, config);
  
  if (result && result.success) {
    const sheet = result.sheetsBySize?.['3.5'];
    if (!sheet) {
        console.error('No sheet result for size 3.5');
        return;
    }

    console.log(`Successfully generated layout: ${sheet.placedCount} pieces (${sheet.placedCount / 2} pairs)`);

    const dxfContent = generateDieCutDxf({
      sheets: [sheet],
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      title: 'ASICS Size 3.5 - 64 Pairs (Double Contour)',
      subtitle: `Efficiency: ${sheet.efficiency}%`
    });

    const outputFileName = 'result_35_64pairs.dxf';
    fs.writeFileSync(outputFileName, dxfContent);
    console.log(`\nDXF exported successfully to: ${outputFileName}`);
  } else {
    console.error('Nesting failed:', result);
  }
}

run().catch(console.error);
