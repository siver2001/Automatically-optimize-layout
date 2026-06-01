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
  })).filter(shape => shape.sizeName === '7.5');

  console.log(`Running detail check for Size 7.5...`);
  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['7.5'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];

  // Print raw placements from engine candidate
  const rawCandidate = engine._lastBestCandidate; // wait, let's see if we can get it from engine or testCapacity result
  const rawPlacements = sheet.placements || [];

  const p44 = placements.find(p => p.id === '7.5_split-left_44' || p.id?.includes('44'));
  const p45 = placements.find(p => p.id === '7.5_split-right_45' || p.id?.includes('45'));

  console.log('--- Mirrored Placements ---');
  if (p44) {
    console.log(`ID: ${p44.id}, x: ${p44.x}, y: ${p44.y}, foot: ${p44.foot}, angle: ${p44.angle}`);
    const bb = getBoundingBox(p44.polygon);
    console.log(`  Material BB: minX: ${p44.x + bb.minX}, maxX: ${p44.x + bb.maxX}, minY: ${p44.y + bb.minY}, maxY: ${p44.y + bb.maxY}`);
    if (p44.cycPolygon) {
      const bbCyc = getBoundingBox(p44.cycPolygon);
      console.log(`  Full Die BB: minX: ${p44.x + bbCyc.minX}, maxX: ${p44.x + bbCyc.maxX}, minY: ${p44.y + bbCyc.minY}, maxY: ${p44.y + bbCyc.maxY}`);
    }
  }

  if (p45) {
    console.log(`ID: ${p45.id}, x: ${p45.x}, y: ${p45.y}, foot: ${p45.foot}, angle: ${p45.angle}`);
    const bb = getBoundingBox(p45.polygon);
    console.log(`  Material BB: minX: ${p45.x + bb.minX}, maxX: ${p45.x + bb.maxX}, minY: ${p45.y + bb.minY}, maxY: ${p45.y + bb.maxY}`);
    if (p45.cycPolygon) {
      const bbCyc = getBoundingBox(p45.cycPolygon);
      console.log(`  Full Die BB: minX: ${p45.x + bbCyc.minX}, maxX: ${p45.x + bbCyc.maxX}, minY: ${p45.y + bbCyc.minY}, maxY: ${p45.y + bbCyc.maxY}`);
    }
  }

  console.log('--- Raw BFS Placements ---');
  const raw44 = rawPlacements.find(p => p.id === 'split_fill_0' || p.id?.includes('0') || p.id?.includes('44'));
  const raw45 = rawPlacements.find(p => p.id === 'split_fill_1' || p.id?.includes('1') || p.id?.includes('45'));
  if (raw44) {
    console.log(`ID: ${raw44.id}, x: ${raw44.x}, y: ${raw44.y}, foot: ${raw44.orient?.foot}, angle: ${raw44.orient?.angle}`);
    const bb = raw44.orient?.bb || getBoundingBox(raw44.orient?.polygon || []);
    console.log(`  Material BB: minX: ${raw44.x + bb.minX}, maxX: ${raw44.x + bb.maxX}, minY: ${raw44.y + bb.minY}, maxY: ${raw44.y + bb.maxY}`);
    if (raw44.orient?.bbCyc) {
      const bbCyc = raw44.orient.bbCyc;
      console.log(`  Full Die BB: minX: ${raw44.x + bbCyc.minX}, maxX: ${raw44.x + bbCyc.maxX}, minY: ${raw44.y + bbCyc.minY}, maxY: ${raw44.y + bbCyc.maxY}`);
    }
  }
  if (raw45) {
    console.log(`ID: ${raw45.id}, x: ${raw45.x}, y: ${raw45.y}, foot: ${raw45.orient?.foot}, angle: ${raw45.orient?.angle}`);
    const bb = raw45.orient?.bb || getBoundingBox(raw45.orient?.polygon || []);
    console.log(`  Material BB: minX: ${raw45.x + bb.minX}, maxX: ${raw45.x + bb.maxX}, minY: ${raw45.y + bb.minY}, maxY: ${raw45.y + bb.maxY}`);
    if (raw45.orient?.bbCyc) {
      const bbCyc = raw45.orient.bbCyc;
      console.log(`  Full Die BB: minX: ${raw45.x + bbCyc.minX}, maxX: ${raw45.x + bbCyc.maxX}, minY: ${raw45.y + bbCyc.minY}, maxY: ${raw45.y + bbCyc.maxY}`);
    }
  }
}

run().catch(console.error);
