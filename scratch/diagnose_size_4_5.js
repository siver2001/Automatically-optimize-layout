import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '4.5' || shape.sizeName === '4,5' || shape.sizeName === '4_5');

  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate90: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // We run testCapacity but we intercept it or inspect the placements.
  console.log("Running capacity test...");
  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['4.5'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];
  
  console.log(`\nPlaced total: ${placements.length}`);
  const wholes = placements.filter(p => !p.id.includes('split'));
  const splits = placements.filter(p => p.id.includes('split'));
  
  console.log(`Wholes count: ${wholes.length}`);
  console.log(`Splits count: ${splits.length}`);
  
  splits.forEach((s, idx) => {
    console.log(`Placed Split [${idx}]: id=${s.id}, x=${s.x.toFixed(2)}, y=${s.y.toFixed(2)}, angle=${s.angle}, outwardSide=${s.orient?.splitOutwardSide}`);
  });
}

run().catch(console.error);
