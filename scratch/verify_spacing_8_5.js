import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';
import { getBoundingBox } from '../server/algorithms/core/polygonUtils.js';

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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '8.5');

  console.log(`Running single test for Size 8.5...`);
  const res = await engine.testCapacity(testSizes, config);
  
  const sheet = res.sheetsBySize['8.5'];
  if (!sheet) {
    console.error("Size 8.5 layout not generated!");
    process.exit(1);
  }

  const placements = sheet.placed || [];
  console.log(`Placed count: ${placements.length}`);

  let overlapsFound = 0;
  const spacing = config.spacing;

  // Verify spacing and overlaps between all pairs of placements
  for (let i = 0; i < placements.length; i++) {
    const p1 = placements[i];
    const poly1 = p1.cycPolygon || p1.polygon;
    const bb1 = getBoundingBox(poly1);

    for (let j = i + 1; j < placements.length; j++) {
      const p2 = placements[j];
      const poly2 = p2.cycPolygon || p2.polygon;
      const bb2 = getBoundingBox(poly2);

      // We use absolute coordinates (poly1 and poly2 already have worldX/worldY added and mirrored!)
      // So offset is { x: 0, y: 0 }
      const overlap = cachedPolygonsOverlap(
        poly1,
        poly2,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        spacing,
        bb1,
        bb2
      );

      if (overlap) {
        overlapsFound++;
        console.error(`[OVERLAP DETECTED]`);
        console.error(` - Piece A: ID: ${p1.id} | Size: ${p1.sizeName} | Foot: ${p1.foot} | Coord: (${p1.x}, ${p1.y})`);
        console.error(` - Piece B: ID: ${p2.id} | Size: ${p2.sizeName} | Foot: ${p2.foot} | Coord: (${p2.x}, ${p2.y})`);
      }
    }
  }

  if (overlapsFound === 0) {
    console.log(`\n[SUCCESS] 0 overlaps or spacing violations found! The layout is 100% physically safe at spacing = ${spacing}mm.`);
  } else {
    console.error(`\n[FAILURE] Found ${overlapsFound} overlaps or spacing violations!`);
  }
}

run().catch(console.error);
