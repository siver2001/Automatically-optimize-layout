import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size4_5 = shapes.find(shape => (shape.sizeName || shape.name) === '4.5' || (shape.sizeName || shape.name) === '4,5');

  if (!size4_5) {
    console.error("Size 4.5 not found!");
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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate90: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  // Initialize internal engine state
  await engine.testCapacity([size4_5], config);

  const sourceShape = engine._doubleContourSourceBySize?.get('4.5') || size4_5;
  const polygon = sourceShape.polygon;
  const halfDefs = buildSplitHalfDefinitions(polygon, sourceShape.internals?.[0] || []);
  const leftDef = halfDefs.find(h => h.key === 'split-left' || h.key?.includes('left'));

  // Create a decorated orientation for vertical split piece (left split at 0 deg)
  const leftOrient0 = engine._decorateSplitHalfOrient('4.5', leftDef, 0, config, 0.5);
  console.log(`Split Width: ${leftOrient0.width.toFixed(2)} | Height: ${leftOrient0.height.toFixed(2)}`);

  // Mock occupied placements containing 7 columns of whole pieces (leaving wide right margin ~178mm)
  // Let's place whole pieces in a clean grid for the first 7 columns
  const occupiedPlacements = [];
  const colSpacing = 141.73; // width of whole piece + spacing
  const rowSpacing = 231.59; // height of whole piece + spacing

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) { // Only 6 columns (X from 0 to 5)
      occupiedPlacements.push({
        id: `whole_${r}_${c}`,
        x: 5 + c * colSpacing,
        y: 5 + r * rowSpacing,
        orient: engine._decorateOrient('4.5', 'L', polygon, 0, config, 0.5)
      });
    }
  }

  console.log(`Mock occupied placements: ${occupiedPlacements.length} wholes`);

  // Now, let's place vertical split pieces on the right margin (X around 900)
  // We place 3 vertical split pieces one by one, with initial Y coordinates at different rows
  // to see how they are compacted!
  const targetX = 900;
  const initialPlacements = [
    { id: 'split_0', x: targetX, y: 100, orient: leftOrient0 },
    { id: 'split_1', x: targetX, y: 500, orient: leftOrient0 },
    { id: 'split_2', x: targetX, y: 900, orient: leftOrient0 }
  ];

  console.log("\n=== COMPACTING RIGHT MARGIN SPLITS ===");
  const compacted = [];
  const allPlacements = [...occupiedPlacements];

  for (const item of initialPlacements) {
    const candidate = { x: item.x, y: item.y };
    // Call the compaction function directly!
    const res = engine._compactSplitFillCandidatePlacement(
      candidate,
      item.orient,
      allPlacements,
      config,
      1070 - 10, // workWidth
      1970 - 10  // workHeight
    );

    const placedItem = {
      id: item.id,
      x: res.x,
      y: res.y,
      orient: item.orient
    };

    console.log(`Placed ${item.id}: Initial Y=${item.y} -> Compacted X=${res.x.toFixed(2)}, Y=${res.y.toFixed(2)}`);
    compacted.push(placedItem);
    allPlacements.push(placedItem);
  }

  // Calculate gaps
  console.log("\n=== RESULTING GAPS BETWEEN COMPACTED SPLITS ===");
  const sortedCompacted = [...compacted].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sortedCompacted.length; i++) {
    const p = sortedCompacted[i];
    const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
    const topY = p.y + bb.minY;
    const bottomY = p.y + bb.maxY;
    console.log(`${p.id} | Y bounds: ${topY.toFixed(2)} to ${bottomY.toFixed(2)}`);
    if (i > 0) {
      const prev = sortedCompacted[i - 1];
      const prevBB = prev.orient.bb || getBoundingBox(prev.orient.polygon);
      const prevBottomY = prev.y + prevBB.maxY;
      const gap = topY - prevBottomY;
      console.log(`  -> Gap between ${prev.id} and ${p.id}: ${gap.toFixed(2)} mm`);
    }
  }
}

run().catch(console.error);
