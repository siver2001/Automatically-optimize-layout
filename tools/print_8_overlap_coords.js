import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
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
  })).filter(shape => shape.sizeName === '8');

  console.log(`Running detail check for Size 8...`);
  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['8'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];

  const p43 = placements.find(p => p.id === '8_split-left_43' || p.id?.includes('43'));
  const p49 = placements.find(p => p.id === '8_split-right_49' || p.id?.includes('49'));

  console.log('--- Placement 43 ---');
  if (p43) {
    console.log(`ID: ${p43.id}, x: ${p43.x}, y: ${p43.y}, foot: ${p43.orient?.foot || p43.foot}, angle: ${p43.orient?.angle ?? p43.angle}`);
    const bb = getBoundingBox(p43.polygon);
    console.log(`  Material BB: minX: ${p43.x + bb.minX}, maxX: ${p43.x + bb.maxX}, minY: ${p43.y + bb.minY}, maxY: ${p43.y + bb.maxY}`);
    if (p43.cycPolygon) {
      const bbCyc = getBoundingBox(p43.cycPolygon);
      console.log(`  Full Die BB: minX: ${p43.x + bbCyc.minX}, maxX: ${p43.x + bbCyc.maxX}, minY: ${p43.y + bbCyc.minY}, maxY: ${p43.y + bbCyc.maxY}`);
    }
  } else {
    console.log('Not found p43');
  }

  console.log('--- Placement 49 ---');
  if (p49) {
    console.log(`ID: ${p49.id}, x: ${p49.x}, y: ${p49.y}, foot: ${p49.orient?.foot || p49.foot}, angle: ${p49.orient?.angle ?? p49.angle}`);
    const bb = getBoundingBox(p49.polygon);
    console.log(`  Material BB: minX: ${p49.x + bb.minX}, maxX: ${p49.x + bb.maxX}, minY: ${p49.y + bb.minY}, maxY: ${p49.y + bb.maxY}`);
    if (p49.cycPolygon) {
      const bbCyc = getBoundingBox(p49.cycPolygon);
      console.log(`  Full Die BB: minX: ${p49.x + bbCyc.minX}, maxX: ${p49.x + bbCyc.maxX}, minY: ${p49.y + bbCyc.minY}, maxY: ${p49.y + bbCyc.maxY}`);
    }
  } else {
    console.log('Not found p49');
  }
}

run().catch(console.error);
