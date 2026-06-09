import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  clearCapacityResultCache();
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const targetSize = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  if (!targetSize) {
    console.error('Size 9 not found in DXF!');
    process.exit(1);
  }

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
  
  console.log('Starting capacity test for Size 9...');
  const res = await engine.testCapacity([targetSize], config);
  console.log('Finished calculation.');

  const sheet = res.sheetsBySize['9'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];
  console.log(`Placed items count: ${placements.length}`);

  let overlapsCount = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const itemA = placements[i];
      const itemB = placements[j];

      const bbA = getBoundingBox(itemA.polygon);
      const bbB = getBoundingBox(itemB.polygon);

      if (cachedPolygonsOverlap(
        itemA.polygon,
        itemB.polygon,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        config.spacing,
        bbA,
        bbB
      )) {
        console.log(`  [OVERLAP DETECTED] ${itemA.id} at (${itemA.x.toFixed(2)}, ${itemA.y.toFixed(2)}) and ${itemB.id} at (${itemB.x.toFixed(2)}, ${itemB.y.toFixed(2)})`);
        overlapsCount++;
      }
    }
  }
  console.log(`Total overlaps found: ${overlapsCount}`);
}

run().catch(console.error);
