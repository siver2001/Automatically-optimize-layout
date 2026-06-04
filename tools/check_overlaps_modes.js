import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleVerticalPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleVerticalPattern.js';
import { CapacityTestDoubleInsoleHorizontalPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleHorizontalPattern.js';
import { getBoundingBox, translate } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function verifyMode(modeName, EngineClass, layoutModeValue, allowedAngles, shapes) {
  console.log(`\n==================================================`);
  console.log(`VERIFYING MODE: ${modeName} (${layoutModeValue})`);
  console.log(`==================================================`);

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
    capacityLayoutMode: layoutModeValue,
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new EngineClass(config);
  const sizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Running capacity test for ALL ${sizes.length} sizes in ${modeName}...`);
  const res = await engine.testCapacity(sizes, { ...config, parallelSizes: true });

  let totalErrors = 0;
  let totalPlacementsCount = 0;

  for (const sizeInfo of sizes) {
    const sizeName = sizeInfo.sizeName;
    const sheet = res.sheetsBySize[sizeName];
    const placements = sheet ? (sheet.placed || sheet.placements) : [];
    
    if (placements.length === 0) {
      console.log(`  Size ${sizeName}: No placements found!`);
      continue;
    }

    totalPlacementsCount += placements.length;
    let sizeErrors = 0;

    // Check orientations
    for (const p of placements) {
      const angle = (p.angle ?? p.orient?.angle ?? 0) % 360;
      if (!allowedAngles.includes(angle)) {
        console.log(`  [INVALID ANGLE] Placement ${p.id} has angle ${angle}°. Allowed: [${allowedAngles.join(', ')}]`);
        sizeErrors++;
        totalErrors++;
      }
    }

    // Check physical overlaps
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

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i];
        const itemB = items[j];

        const bbA = getBoundingBox(itemA.polygon);
        const bbB = getBoundingBox(itemB.polygon);

        // 1. Material vs Material overlap check
        if (cachedPolygonsOverlap(
          itemA.polygon,
          itemB.polygon,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          config.spacing,
          bbA,
          bbB
        )) {
          console.log(`  [MATERIAL OVERLAP] Size ${sizeName}: ${itemA.id} and ${itemB.id} overlap!`);
          sizeErrors++;
          totalErrors++;
        }

        // 2. Die A vs Material B (if A is split)
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
            console.log(`  [DIE-TO-MATERIAL OVERLAP] Size ${sizeName}: Split ${itemA.id}'s full die overlaps with material of ${itemB.id}!`);
            sizeErrors++;
            totalErrors++;
          }
        }

        // 3. Die B vs Material A (if B is split)
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
            console.log(`  [DIE-TO-MATERIAL OVERLAP] Size ${sizeName}: Split ${itemB.id}'s full die overlaps with material of ${itemA.id}!`);
            sizeErrors++;
            totalErrors++;
          }
        }
      }
    }

    if (sizeErrors > 0) {
      console.log(`  Size ${sizeName}: Found ${sizeErrors} errors! Yield: ${placements.length}`);
    } else {
      console.log(`  Size ${sizeName}: OK. Yield: ${placements.length}`);
    }
  }

  console.log(`\nSummary for ${modeName}: Placed ${totalPlacementsCount} pieces total. Errors found: ${totalErrors}`);
  return { totalErrors, totalPlacementsCount };
}

async function run() {
  process.env.BYPASS_CAPACITY_CACHE = 'true';
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  // Clear cache if needed (will do via code or let it run fresh)
  
  const verticalResult = await verifyMode(
    'Xếp Dọc (Vertical)',
    CapacityTestDoubleInsoleVerticalPattern,
    'same-side-double-contour-vertical',
    [0, 180],
    shapes
  );

  const horizontalResult = await verifyMode(
    'Xếp Ngang (Horizontal)',
    CapacityTestDoubleInsoleHorizontalPattern,
    'same-side-double-contour-horizontal',
    [90, 270],
    shapes
  );

  console.log(`\n==================================================`);
  console.log(`FINAL REPORT`);
  console.log(`==================================================`);
  console.log(`Vertical Nesting:   Errors = ${verticalResult.totalErrors}, Yield = ${verticalResult.totalPlacementsCount}`);
  console.log(`Horizontal Nesting: Errors = ${horizontalResult.totalErrors}, Yield = ${horizontalResult.totalPlacementsCount}`);
  
  if (verticalResult.totalErrors > 0 || horizontalResult.totalErrors > 0) {
    console.error(`\nTest FAILED with errors! Check the log details above.`);
    process.exit(1);
  } else {
    console.log(`\nAll tests PASSED successfully! 100% zero overlaps and correct orientations!`);
  }
}

run().catch(console.error);
