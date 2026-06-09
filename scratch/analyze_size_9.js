import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
  })).filter(shape => shape.sizeName === '9');

  console.log(`Running detail check for Size 9...`);
  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['9'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];
  console.log(`Placements count: ${placements.length}`);

  const p41 = placements.find(p => p.id === '9_X_41');
  const p48 = placements.find(p => p.id === '9_split-left_48');

  console.log('--- Placement 41 (Whole) ---');
  if (p41) {
    console.log(`ID: ${p41.id}, x: ${p41.x}, y: ${p41.y}, foot: ${p41.foot}, angle: ${p41.angle}`);
    const bb = getBoundingBox(p41.polygon);
    console.log(`  Material BB: minX: ${bb.minX}, maxX: ${bb.maxX}, minY: ${bb.minY}, maxY: ${bb.maxY}`);
  }

  console.log('--- Placement 48 (Split) ---');
  if (p48) {
    console.log(`ID: ${p48.id}, x: ${p48.x}, y: ${p48.y}, foot: ${p48.foot}, angle: ${p48.angle}`);
    const bb = getBoundingBox(p48.polygon);
    console.log(`  Material BB: minX: ${bb.minX}, maxX: ${bb.maxX}, minY: ${bb.minY}, maxY: ${bb.maxY}`);
    if (p48.cycPolygon) {
      const bbCyc = getBoundingBox(p48.cycPolygon);
      console.log(`  Full Die BB: minX: ${bbCyc.minX}, maxX: ${bbCyc.maxX}, minY: ${bbCyc.minY}, maxY: ${bbCyc.maxY}`);
    }
  }

  if (p41 && p48) {
    const overlapMat = cachedPolygonsOverlap(
      p41.polygon,
      p48.polygon,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      config.spacing
    );
    console.log(`Overlap Material-to-Material: ${overlapMat}`);

    if (p48.cycPolygon) {
      const overlapDie = cachedPolygonsOverlap(
        p48.cycPolygon,
        p41.polygon,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        config.spacing
      );
      console.log(`Overlap Die-to-Material: ${overlapDie}`);
    }
  }
}

run().catch(console.error);
