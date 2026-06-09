import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '9');

  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['9'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];

  const p41 = placements.find(p => p.id === '9_X_41');
  const p48 = placements.find(p => p.id === '9_split-left_48');

  if (p41) {
    console.log(`\np41 (Whole) ID: ${p41.id}`);
    console.log(`x: ${p41.x}, y: ${p41.y}, angle: ${p41.angle}`);
    console.log('polygon vertices:', JSON.stringify(p41.polygon));
  }
  if (p48) {
    console.log(`\np48 (Split) ID: ${p48.id}`);
    console.log(`x: ${p48.x}, y: ${p48.y}, angle: ${p48.angle}`);
    console.log('polygon vertices:', JSON.stringify(p48.polygon));
    console.log('cycPolygon vertices:', JSON.stringify(p48.cycPolygon));
  }
}

run().catch(console.error);
