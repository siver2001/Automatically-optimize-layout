import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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

  // We will run with engine, but we will patch the spacing checks to use spacing + 0.01
  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Let's modify engine's _finalizeCandidate and _alignMarginSplits to use spacing + 0.01
  // We can do this by overriding _alignMarginSplits and _canPlaceSplitOrient to use config.spacing + 0.01
  
  const originalCanPlace = engine._canPlaceSplitOrient;
  engine._canPlaceSplitOrient = function(occupiedPlacements, orient, x, y, conf, ...args) {
    const paddedConfig = { ...conf, spacing: (conf.spacing || 0) + 0.01 };
    return originalCanPlace.call(this, occupiedPlacements, orient, x, y, paddedConfig, ...args);
  };

  const originalAlign = engine._alignMarginSplits;
  engine._alignMarginSplits = function(placements, conf, ...args) {
    const paddedConfig = { ...conf, spacing: (conf.spacing || 0) + 0.01 };
    return originalAlign.call(this, placements, paddedConfig, ...args);
  };

  const sizeInfo = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  const res = await engine.testCapacity([sizeInfo], config);
  const sheet = res.sheetsBySize['9'];
  const placements = sheet.placed || sheet.placements;

  console.log(`Placed count: ${placements.length}`);

  // Let's run the overlap check
  let overlapsCount = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const itemA = placements[i];
      const itemB = placements[j];
      const bbA = getBoundingBox(itemA.polygon);
      const bbB = getBoundingBox(itemB.polygon);
      const isSplitA = !!(itemA.isSplit || itemA.id?.includes('split') || itemA.id?.startsWith('margin_fill_'));
      const isSplitB = !!(itemB.isSplit || itemB.id?.includes('split') || itemB.id?.startsWith('margin_fill_'));

      if (cachedPolygonsOverlap(itemA.polygon, itemB.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, config.spacing, bbA, bbB)) {
        console.log(`  [MATERIAL OVERLAP] ${itemA.id} and ${itemB.id} overlap!`);
        overlapsCount++;
      }
      if (isSplitA && itemA.cycPolygon) {
        const bbCyc = getBoundingBox(itemA.cycPolygon);
        if (cachedPolygonsOverlap(itemA.cycPolygon, itemB.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, config.spacing, bbCyc, bbB)) {
          console.log(`  [DIE-TO-MATERIAL OVERLAP] Split ${itemA.id} overlaps with ${itemB.id}`);
          overlapsCount++;
        }
      }
      if (isSplitB && itemB.cycPolygon) {
        const bbCyc = getBoundingBox(itemB.cycPolygon);
        if (cachedPolygonsOverlap(itemB.cycPolygon, itemA.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, config.spacing, bbCyc, bbA)) {
          console.log(`  [DIE-TO-MATERIAL OVERLAP] Split ${itemB.id} overlaps with ${itemA.id}`);
          overlapsCount++;
        }
      }
    }
  }

  console.log(`Total overlaps found: ${overlapsCount}`);
}

run().catch(console.error);
