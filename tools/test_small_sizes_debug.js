import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/CapacityTestDoubleInsoleDoubleContourPattern.js';

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
    parallelSizes: true
  };

  const nester = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  // Test 3.5, 4, 4.5
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(s => ['3.5', '4', '4.5'].includes(s.sizeName));

  console.log(`Testing sizes 3.5, 4, 4.5...`);
  
  const result = await nester.testCapacity(testSizes, config);
  
  if (result && result.success) {
    for (const item of result.summary) {
      const sheet = result.sheetsBySize?.[item.sizeName];
      const pi = sheet?.patternInfo || {};
      console.log(`\n=== Size ${item.sizeName}: ${item.pairs} pairs, ${item.placedCount} pieces ===`);
      console.log(`  Body: cols=${pi.bodyCols}, rows=${pi.bodyRows}, bodyCount=${pi.bodyCount}`);
      console.log(`  dx=${pi.bodyDxMm}, dy=${pi.bodyDyMm}`);
      console.log(`  Angles: primary=${pi.bodyPrimaryAngle}, alt=${pi.bodyAlternateAngle}`);
      console.log(`  RowShift: x=${pi.rowShiftXmm || 0}, y=${pi.rowShiftYmm || 0}`);
      console.log(`  Pattern: ${pi.bodyPatternMode}`);
      console.log(`  Filler90: used=${pi.filler90Used}, count=${pi.filler90Count}, topRows=${pi.filler90TopRows}, bottomRows=${pi.filler90BottomRows}`);
      console.log(`  Split fill: count=${pi.splitFillCount || 0}`);
      
      if (sheet?.placed) {
        const footMap = {};
        for (const p of sheet.placed) {
          const key = `${p.foot}(pc=${p.pieceCount})`;
          footMap[key] = (footMap[key] || 0) + 1;
        }
        console.log(`  Placement breakdown: ${JSON.stringify(footMap)}`);
      }
    }
  }
}

run().catch(console.error);
