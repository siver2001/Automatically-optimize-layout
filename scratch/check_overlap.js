import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';

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
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Running layout nesting for ${testSizes.length} sizes to check overlaps...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log('\n--- VERIFYING RESULTS FOR OVERLAPS & BOUNDS ---');
  let totalViolations = 0;

  for (const size of testSizes) {
    const sizeName = size.sizeName;
    const sheet = res.sheetsBySize[sizeName];
    if (!sheet) {
      console.log(`Size ${sizeName}: No sheet generated.`);
      continue;
    }

    const placed = sheet.placed || [];
    console.log(`Size ${sizeName}: Checked ${placed.length} pieces.`);
    let sizeViolations = 0;

    // 1. Check for physical overlap and spacing overlap between all pairs
    for (let i = 0; i < placed.length; i++) {
      const itemA = placed[i];
      for (let j = i + 1; j < placed.length; j++) {
        const itemB = placed[j];

        // Check physical overlap (spacing = 0)
        const isPhysicalOverlap = polygonsOverlap(itemA.polygon, itemB.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, 0);
        if (isPhysicalOverlap) {
          console.error(`  [ERROR] Physical overlap detected!`);
          console.error(`    Item A: ${itemA.id} at (${itemA.x}, ${itemA.y})`);
          console.error(`    Item B: ${itemB.id} at (${itemB.x}, ${itemB.y})`);
          sizeViolations++;
          totalViolations++;
        }

        // Check spacing violation (spacing = config.spacing, with a tiny buffer for rounding errors)
        const checkSpacing = config.spacing - 0.05;
        const isSpacingViolation = polygonsOverlap(itemA.polygon, itemB.polygon, { x: 0, y: 0 }, { x: 0, y: 0 }, checkSpacing);
        if (isSpacingViolation && !isPhysicalOverlap) {
          console.warn(`  [WARN] Spacing violation! Distance between them is less than ${config.spacing}mm.`);
          console.warn(`    Item A: ${itemA.id} at (${itemA.x}, ${itemA.y})`);
          console.warn(`    Item B: ${itemB.id} at (${itemB.x}, ${itemB.y})`);
          sizeViolations++;
          totalViolations++;
        }
      }

      // 2. Check for out-of-bounds
      for (const pt of itemA.polygon) {
        if (pt.x < 0 || pt.x > config.sheetWidth || pt.y < 0 || pt.y > config.sheetHeight) {
          console.error(`  [ERROR] Out of bounds! Vertex (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) is outside sheet.`);
          console.error(`    Item: ${itemA.id} at (${itemA.x}, ${itemA.y})`);
          sizeViolations++;
          totalViolations++;
          break; // only print once per piece
        }
      }
    }

    if (sizeViolations === 0) {
      console.log(`  Size ${sizeName}: PASS (No overlaps or boundary violations)`);
    } else {
      console.log(`  Size ${sizeName}: FAIL (${sizeViolations} violations found)`);
    }
  }

  console.log(`\nVerification finished. Total violations found across all sizes: ${totalViolations}`);
}

run().catch(console.error);
