import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
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
  
  const p48 = placements.find(p => p.id === '9_split-left_48');
  if (!p48) {
    console.log('p48 not found!');
    return;
  }

  console.log(`p48 details: id=${p48.id}, x=${p48.x}, y=${p48.y}, foot=${p48.foot}, angle=${p48.angle}`);

  for (const p of placements) {
    if (p.id === p48.id) continue;
    const overlapMat = polygonsOverlap(
      p48.cycPolygon,
      p.polygon,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      config.spacing
    );
    if (overlapMat) {
      console.log(`FOUND OVERLAP: p48 overlaps with ${p.id} (x=${p.x}, y=${p.y}, foot=${p.foot}, angle=${p.angle})`);
      
      // Print raw coordinates (before mirroring/materialization)
      const rawPA_x = p48.x - config.marginX;
      const rawPA_y = 1687.2564 - p48.y;
      
      const rawPB_x = p.x - config.marginX;
      const rawPB_y = 1687.2564 - p.y;
      
      console.log(`Raw coordinates:`);
      console.log(`  pA (split): x=${rawPA_x}, y=${rawPA_y}`);
      console.log(`  pB (whole): x=${rawPB_x}, y=${rawPB_y}`);
    }
  }
}

run().catch(console.error);
