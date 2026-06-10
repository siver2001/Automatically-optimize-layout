import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function getLayouts() {
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
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Calculating layouts for all ${testSizes.length} sizes...`);
  const res = await engine.testCapacity(testSizes, config);
  
  const layouts = {};
  for (const size of testSizes) {
    const sheet = res.sheetsBySize[size.sizeName];
    if (sheet && sheet.placed) {
      layouts[size.sizeName] = sheet.placed.map(p => {
        const bb = getBoundingBox(p.polygon);
        return {
          id: p.id,
          foot: p.foot,
          minX: roundMetric(bb.minX, 2),
          maxX: roundMetric(bb.maxX, 2),
          minY: roundMetric(bb.minY, 2),
          maxY: roundMetric(bb.maxY, 2)
        };
      });
    }
  }
  return layouts;
}

function roundMetric(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

async function run() {
  const mode = process.argv[2];
  if (mode === 'save-old') {
    const layouts = await getLayouts();
    fs.writeFileSync('scratch/old_layouts.json', JSON.stringify(layouts, null, 2));
    console.log("Saved old layouts to scratch/old_layouts.json");
  } else if (mode === 'save-new') {
    const layouts = await getLayouts();
    fs.writeFileSync('scratch/new_layouts.json', JSON.stringify(layouts, null, 2));
    console.log("Saved new layouts to scratch/new_layouts.json");
  } else if (mode === 'compare') {
    if (!fs.existsSync('scratch/old_layouts.json') || !fs.existsSync('scratch/new_layouts.json')) {
      console.error("Missing layout files. Run save-old and save-new first.");
      return;
    }
    const oldLayouts = JSON.parse(fs.readFileSync('scratch/old_layouts.json'));
    const newLayouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json'));
    
    console.log("\n=== COMPARING OLD VS NEW LAYOUTS ===");
    let totalMoved = 0;
    
    for (const sizeName of Object.keys(oldLayouts)) {
      const oldPlacements = oldLayouts[sizeName];
      const newPlacements = newLayouts[sizeName];
      
      const movedPieces = [];
      
      for (const oldP of oldPlacements) {
        const newP = newPlacements.find(p => p.id === oldP.id);
        if (!newP) continue;
        
        const dx = newP.minX - oldP.minX;
        const dy = newP.minY - oldP.minY;
        
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          movedPieces.push({
            id: oldP.id,
            foot: oldP.foot,
            oldX: `[${oldP.minX.toFixed(1)}, ${oldP.maxX.toFixed(1)}]`,
            newX: `[${newP.minX.toFixed(1)}, ${newP.maxX.toFixed(1)}]`,
            oldY: `[${oldP.minY.toFixed(1)}, ${oldP.maxY.toFixed(1)}]`,
            newY: `[${newP.minY.toFixed(1)}, ${newP.maxY.toFixed(1)}]`,
            dx,
            dy
          });
        }
      }
      
      if (movedPieces.length > 0) {
        console.log(`\nSize: ${sizeName} | ${movedPieces.length} pieces moved closer/shifted:`);
        for (const item of movedPieces) {
          console.log(` - ID: ${item.id.padEnd(20)} (${item.foot})`);
          if (Math.abs(item.dx) > 0.1) {
            console.log(`   X shifted from ${item.oldX} to ${item.newX} (dx = ${item.dx.toFixed(1)} mm)`);
          }
          if (Math.abs(item.dy) > 0.1) {
            console.log(`   Y shifted from ${item.oldY} to ${item.newY} (dy = ${item.dy.toFixed(1)} mm)`);
          }
        }
        totalMoved += movedPieces.length;
      }
    }
    
    console.log(`\nTotal moved pieces across all sizes: ${totalMoved}`);
  }
}

run().catch(console.error);
