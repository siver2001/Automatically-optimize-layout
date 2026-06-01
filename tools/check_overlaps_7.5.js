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
  
  const sizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  console.log(`Checking physical overlaps for Size 7.5...`);

  for (const sizeInfo of sizes) {
    const sizeName = sizeInfo.sizeName;
    const res = await engine.testCapacity([sizeInfo], config);
    const sheet = res.sheetsBySize[sizeName];
    const placements = sheet ? (sheet.placed || sheet.placements) : [];
    
    if (placements.length === 0) {
      console.log(`Size 7.5: No placements found!`);
      continue;
    }

    const items = placements.map(p => {
      const isSplit = !!(p.isSplit || p.id?.includes('split') || p.id?.startsWith('margin_fill_'));
      return {
        id: p.id,
        x: p.x,
        y: p.y,
        isSplit,
        polygon: p.polygon,
        cycPolygon: p.cycPolygon
      };
    });

    let overlapsCount = 0;

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i];
        const itemB = items[j];

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
          console.log(`  [MATERIAL OVERLAP] ${itemA.id} and ${itemB.id} overlap!`);
          overlapsCount++;
        }

        if (itemA.isSplit && itemA.cycPolygon) {
          const bbCycA = getBoundingBox(itemA.cycPolygon);
          if (cachedPolygonsOverlap(
            itemA.cycPolygon,
            itemB.polygon,
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            config.spacing,
            bbCycA,
            bbB
          )) {
            console.log(`  [DIE-TO-MATERIAL OVERLAP] Split ${itemA.id}'s full die overlaps with material of ${itemB.id}!`);
            overlapsCount++;
          }
        }

        if (itemB.isSplit && itemB.cycPolygon) {
          const bbCycB = getBoundingBox(itemB.cycPolygon);
          if (cachedPolygonsOverlap(
            itemB.cycPolygon,
            itemA.polygon,
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            config.spacing,
            bbCycB,
            bbA
          )) {
            console.log(`  [DIE-TO-MATERIAL OVERLAP] Split ${itemB.id}'s full die overlaps with material of ${itemA.id}!`);
            overlapsCount++;
          }
        }
      }
    }

    console.log(`Size 7.5: Total placements = ${placements.length}, Physical overlaps found = ${overlapsCount}`);
  }
}

run().catch(console.error);
