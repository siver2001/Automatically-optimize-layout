import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, translate } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size13 = shapes.find(shape => (shape.sizeName || shape.name) === '13');
  if (!size13) {
    console.error("Size 13 not found!");
    return;
  }

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
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Intercept right before bottom margin DFS
  const originalDFS = engine._optimizeMarginDFS;
  engine._optimizeMarginDFS = function(sizeName, basePlacements, orientVariants, marginType, config, workWidth, workHeight) {
    const resPlacements = originalDFS.call(this, sizeName, basePlacements, orientVariants, marginType, config, workWidth, workHeight);
    
    if (marginType === 'bottom' && resPlacements.length > 0) {
      console.log(`\n====== BOTTOM MARGIN SUCCESSFUL DFS (Placed: ${resPlacements.length} pieces) ======`);
      console.log("Placed coordinates:");
      resPlacements.forEach((p, idx) => {
        console.log(`  Piece ${idx}: ${p.orient.foot} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)}`);
      });
    }
    
    return resPlacements;
  };

  console.log("Running layout for Size 13...");
  const res = await engine.testCapacity([size13], config);
  
  console.log("\n--- FINAL SELECTED CANDIDATE PLACEMENTS ---");
  const sheet = res.sheetsBySize?.['13'];
  if (sheet) {
    const placed = [...sheet.placed].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const p of placed) {
      const isSplit = p.id.includes("split") || p.id.includes("dfs") || p.foot.startsWith("split-") || p.id.includes("margin_fill");
      if (isSplit) {
        console.log(`Split - ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | foot: ${p.foot}`);
      }
    }
  }
}

run().catch(console.error);
