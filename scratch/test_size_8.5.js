import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false // run single-threaded for logging
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const shape8_5 = shapes.find(s => (s.sizeName || s.name) === '8.5');
  if (!shape8_5) {
    console.error("Size 8.5 not found!");
    process.exit(1);
  }

  console.log("Found Size 8.5 shape. Running capacity test...");
  const res = await engine.testCapacity([{
    ...shape8_5,
    sizeName: '8.5'
  }], config);

  console.log("\n=== Size 8.5 Results ===");
  console.log(`Pairs: ${res.summary[0].pairs}`);
  console.log(`Efficiency: ${res.summary[0].efficiency}%`);

  const sheet = res.sheet;
  if (!sheet) {
    console.error("No sheet generated!");
    process.exit(1);
  }

  console.log(`\nPlaced count: ${sheet.placed.length}`);

  // Let's filter splits and whole pieces
  const splits = [];
  const wholes = [];
  for (const item of sheet.placed) {
    const isSplit = item.id.startsWith('margin_fill_') || item.id.startsWith('split_') || item.isSplit || item.foot?.startsWith('split-');
    if (isSplit) {
      splits.push(item);
    } else {
      wholes.push(item);
    }
  }

  console.log(`\nWholes count: ${wholes.length} (${wholes.length / 2} pairs)`);
  console.log(`Splits count: ${splits.length} (${splits.length / 2} pairs)`);

  function getBoundingBox(pts) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  if (splits.length > 0) {
    console.log("\n--- DIAGNOSTIC SQUEEZE TEST FOR FIRST SPLIT ---");
    const s0 = splits[0];
    const s0_x_internal = s0.x - 5;
    const s0_y_internal = s0.y - 20;
    const s0_untranslated_poly = s0.polygon.map(pt => ({ x: pt.x - s0.x, y: pt.y - s0.y }));
    const s0_orient = {
      polygon: s0_untranslated_poly,
      bb: getBoundingBox(s0_untranslated_poly),
      splitOutwardSide: 'right'
    };

    const internalWholes = wholes.map(w => {
      const untranslatedPoly = w.polygon.map(pt => ({ x: pt.x - w.x, y: pt.y - w.y }));
      return {
        x: w.x - 5,
        y: w.y - 20,
        orient: {
          polygon: untranslatedPoly,
          bb: getBoundingBox(untranslatedPoly)
        }
      };
    });

    const spatialIndex = engine._buildSpatialIndex(internalWholes, config.sheetWidth - 10, config.sheetHeight - 40, config.spacing);

    console.log(`First split: ID=${s0.id}, Foot=${s0.foot}, angle=${s0.angle}`);
    console.log(`Original internal: x=${s0_x_internal.toFixed(2)}, y=${s0_y_internal.toFixed(2)}`);
    console.log(`bb:`, s0_orient.bb);

    // Let's test different X values
    for (let testX = 940; testX <= 991; testX += 2) {
      const isSafeNoOutward = engine._canPlaceSplitOrient(
        internalWholes,
        s0_orient,
        testX,
        s0_y_internal,
        config,
        config.sheetWidth - 10,
        config.sheetHeight - 40,
        spatialIndex,
        true // skipOutwardCheck
      );
      const isSafeWithOutward = engine._canPlaceSplitOrient(
        internalWholes,
        s0_orient,
        testX,
        s0_y_internal,
        config,
        config.sheetWidth - 10,
        config.sheetHeight - 40,
        spatialIndex,
        false // skipOutwardCheck
      );
      console.log(`testX = ${testX.toFixed(1)} | safe(skipOutward) = ${isSafeNoOutward} | safe(withOutward) = ${isSafeWithOutward}`);
    }
  }

  // Log bounding boxes
  console.log("\n--- WHOLE PLACEMENT BOUNDS ---");
  let minWholeX = Infinity, maxWholeX = -Infinity;
  let minWholeY = Infinity, maxWholeY = -Infinity;
  for (const w of wholes) {
    if (w.polygon && w.polygon.length) {
      for (const p of w.polygon) {
        if (p.x < minWholeX) minWholeX = p.x;
        if (p.x > maxWholeX) maxWholeX = p.x;
        if (p.y < minWholeY) minWholeY = p.y;
        if (p.y > maxWholeY) maxWholeY = p.y;
      }
    } else {
      const x = w.x;
      const y = w.y;
      minWholeX = Math.min(minWholeX, x);
      maxWholeX = Math.max(maxWholeX, x);
      minWholeY = Math.min(minWholeY, y);
      maxWholeY = Math.max(maxWholeY, y);
    }
  }
  console.log(`Whole Envelope: X[${minWholeX.toFixed(1)}, ${maxWholeX.toFixed(1)}], Y[${minWholeY.toFixed(1)}, ${maxWholeY.toFixed(1)}]`);

  console.log("\n--- SPLIT PLACEMENTS (1/2 PIECES) ---");
  for (const s of splits) {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    if (s.polygon && s.polygon.length) {
      for (const p of s.polygon) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    } else {
      xMin = s.x;
      xMax = s.x;
      yMin = s.y;
      yMax = s.y;
    }
    console.log(`ID: ${s.id.padEnd(20)} | Foot: ${s.foot} | Center: [${((xMin+xMax)/2).toFixed(1)}, ${((yMin+yMax)/2).toFixed(1)}] | X[${xMin.toFixed(1)}, ${xMax.toFixed(1)}] Y[${yMin.toFixed(1)}, ${yMax.toFixed(1)}]`);
  }
}

run().catch(console.error);
