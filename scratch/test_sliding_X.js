import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

function roundMetric(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

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
  const shape12_5 = shapes.find(shape => (shape.sizeName || shape.name) === '12.5');

  console.log("Running layout for Size 12.5...");
  const res = await engine.testCapacity([shape12_5], config);
  const sheet = res.sheetsBySize['12.5'];
  if (!sheet || !sheet.placed) {
    console.error("Failed to generate sheet");
    return;
  }

  // Get internal placements (simulating what is inside _alignMarginSplits)
  // We can just look at sheet.placed and simulate sliding
  const placements = sheet.placed.map(p => ({
    ...p,
    orient: {
      polygon: p.polygon.map(pt => ({ x: pt.x - p.x, y: pt.y - p.y })),
      bb: getBoundingBox(p.polygon.map(pt => ({ x: pt.x - p.x, y: pt.y - p.y })))
    }
  }));

  const splitPieces = placements.filter(p => p.id.includes('split') || p.foot.startsWith('split-'));
  const otherPieces = placements.filter(p => !p.id.includes('split') && !p.foot.startsWith('split-'));

  console.log("\n--- Before Sliding along Margin ---");
  splitPieces.sort((a, b) => a.minX - b.minX);
  for (const sp of splitPieces) {
    const bb = getBoundingBox(sp.polygon);
    console.log(`ID: ${sp.id.padEnd(22)} | X: [${bb.minX.toFixed(1).padStart(5)} - ${bb.maxX.toFixed(1).padStart(5)}] | Y: [${bb.minY.toFixed(1).padStart(6)} - ${bb.maxY.toFixed(1).padStart(6)}]`);
  }

  // Simulate sliding along X (leftward, decreasing X) for top margin splits
  console.log("\n--- Simulating Leftward X-sliding for Top Splits ---");
  const spacing = config.spacing;
  const workWidth = config.sheetWidth;
  const workHeight = config.sheetHeight;

  // Let's slide each split piece leftward as much as possible
  // We sort them from left to right (by X)
  const sortedSplits = [...splitPieces].sort((a, b) => a.x - b.x);
  
  for (const p of sortedSplits) {
    const bb = p.orient.bb;
    const otherPlacements = placements.filter(cp => cp.id !== p.id);
    const spatialIndex = engine._buildSpatialIndex(otherPlacements, workWidth, workHeight, spacing);

    let lowX = -bb.minX; // 0
    let highX = p.x;
    let bestX = p.x;

    while (highX - lowX > 0.1) {
      const midX = roundMetric((lowX + highX) / 2, 3);
      // We pass checkCycOverlap = true
      if (engine._canPlaceSplitOrient(otherPlacements, p.orient, midX, p.y, config, workWidth, workHeight, spatialIndex, true, true)) {
        bestX = midX;
        highX = midX; // Try to go even smaller X
      } else {
        lowX = midX;
      }
    }
    console.log(`Piece ${p.id} can slide leftward: X from ${p.x.toFixed(1)} to ${bestX.toFixed(1)} (shifted by ${(p.x - bestX).toFixed(1)} mm)`);
    p.x = bestX;
  }
}

run().catch(console.error);
