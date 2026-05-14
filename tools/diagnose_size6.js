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
  const size6 = shapes.find(s => s.sizeName === '6');

  if (!size6) {
    console.error('Could not find size 6');
    process.exit(1);
  }

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false,
    preparedSplitFillCandidateLimit: 50,
    preparedSplitFillDeep: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  console.log('--- DIAGNOSING SIZE 6 ---');
  
  // Test 0 degrees (Vertical piece usually)
  console.log('Testing Angle: 0 (Vertical-ish)');
  const res0 = await engine.testCapacity([size6], { ...config, doubleContourFineRotateEnabled: false, allowRotate90: false });
  console.log(`Result 0deg: ${res0.summary[0].pairs} pairs`);
  if (res0.sheet && res0.sheet.patternInfo) {
      console.log(`Pattern: Body ${res0.sheet.patternInfo.bodyCount} + Filler ${res0.sheet.patternInfo.filler90Count} + Split ${res0.sheet.patternInfo.splitFillCount}`);
  }

  // Test 90 degrees (Horizontal-ish)
  console.log('\nTesting Angle: 90 (Horizontal-ish)');
  // We need a hacky way to force 90 degrees. One way is to rotate the polygon ourselves or use a config.
  // Actually, CapacityTestDoubleInsoleDoubleContourPattern._getDoubleContourPreferredAngles() returns [0, 90].
  // But it might choose the best one.
  
  // Let's rotate the polygon 90 degrees and test as 0.
  const rotatedPolygon = size6.polygon.map(p => ({ x: -p.y, y: p.x }));
  const size6Rotated = { ...size6, polygon: rotatedPolygon };
  
  const res90 = await engine.testCapacity([size6Rotated], { ...config, doubleContourFineRotateEnabled: false, allowRotate90: false });
  console.log(`Result 90deg (forced): ${res90.summary[0].pairs} pairs`);
    if (res90.sheet && res90.sheet.patternInfo) {
      console.log(`Pattern: Body ${res90.sheet.patternInfo.bodyCount} + Filler ${res90.sheet.patternInfo.filler90Count} + Split ${res90.sheet.patternInfo.splitFillCount}`);
  }

  console.log('\n--- COMPARISON ---');
  console.log(`Angle 0: ${res0.summary[0].pairs} pairs`);
  console.log(`Angle 90: ${res90.summary[0].pairs} pairs`);
}

run().catch(console.error);
