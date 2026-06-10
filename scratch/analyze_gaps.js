import fs from 'fs';
import path from 'path';

// Sheet/Work dimensions from config
const workWidth = 1070;
const workHeight = 1970;
const marginThreshold = 150; // Threshold used in the code to identify margin splits

function isSplitPlacement(id, foot) {
  return !!(id?.includes('split') || id?.startsWith('margin_fill_') || foot?.startsWith('split-'));
}

function getMargin(p) {
  // Calculate distances to all four boundaries
  const distLeft = p.minX;
  const distRight = workWidth - p.maxX;
  const distTop = p.minY;
  const distBottom = workHeight - p.maxY;

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  
  if (distLeft < marginThreshold && minDist === distLeft) return 'Left';
  if (distRight < marginThreshold && minDist === distRight) return 'Right';
  if (distTop < marginThreshold && minDist === distTop) return 'Top';
  if (distBottom < marginThreshold && minDist === distBottom) return 'Bottom';
  
  // Fallback
  if (minDist === distRight) return 'Right';
  if (minDist === distBottom) return 'Bottom';
  if (minDist === distTop) return 'Top';
  return 'Left';
}

function run() {
  const oldPath = 'scratch/old_layouts.json';
  const newPath = 'scratch/new_layouts.json';

  if (!fs.existsSync(oldPath) || !fs.existsSync(newPath)) {
    console.error("Please run the save-old and save-new layouts script first.");
    return;
  }

  const oldLayouts = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newLayouts = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  console.log("=========================================================");
  console.log("   SQUEEZING VERIFICATION (OLD VS NEW LAYOUTS)   ");
  console.log("=========================================================");

  let totalSqueezed = 0;
  let totalSqueezeDist = 0;

  for (const sizeName of Object.keys(oldLayouts).sort((a, b) => parseFloat(a) - parseFloat(b))) {
    const oldPlacements = oldLayouts[sizeName];
    const newPlacements = newLayouts[sizeName];

    const sizeSqueezes = [];

    for (const oldP of oldPlacements) {
      if (!isSplitPlacement(oldP.id, oldP.foot)) continue;

      const newP = newPlacements.find(p => p.id === oldP.id);
      if (!newP) continue;

      const margin = getMargin(oldP);
      let squeezeAmount = 0;

      // Squeeze directions:
      // Left margin: slides rightward -> X increases
      // Right margin: slides leftward -> X decreases
      // Top margin: slides downward -> Y increases
      // Bottom margin: slides upward -> Y decreases
      if (margin === 'Left') {
        squeezeAmount = newP.minX - oldP.minX;
      } else if (margin === 'Right') {
        squeezeAmount = oldP.minX - newP.minX;
      } else if (margin === 'Top') {
        squeezeAmount = newP.minY - oldP.minY;
      } else if (margin === 'Bottom') {
        squeezeAmount = oldP.minY - newP.minY;
      }

      if (squeezeAmount > 0.05) { // At least 0.05mm shift
        sizeSqueezes.push({
          id: oldP.id,
          margin,
          oldPos: margin === 'Left' || margin === 'Right' ? `X=[${oldP.minX}, ${oldP.maxX}]` : `Y=[${oldP.minY}, ${oldP.maxY}]`,
          newPos: margin === 'Left' || margin === 'Right' ? `X=[${newP.minX}, ${newP.maxX}]` : `Y=[${newP.minY}, ${newP.maxY}]`,
          squeezeAmount
        });
        totalSqueezed++;
        totalSqueezeDist += squeezeAmount;
      }
    }

    if (sizeSqueezes.length > 0) {
      console.log(`\nSize ${sizeName}: ${sizeSqueezes.length} split pieces squeezed closer to the center:`);
      for (const s of sizeSqueezes) {
        console.log(`  * Piece: ${s.id.padEnd(20)} | Margin: ${s.margin.padEnd(6)} | Squeezed closer by: ${s.squeezeAmount.toFixed(1)} mm`);
        console.log(`    Old: ${s.oldPos} -> New: ${s.newPos}`);
      }
    }
  }

  console.log("\n=========================================================");
  console.log(`Summary:`);
  console.log(`- Total split pieces successfully squeezed closer: ${totalSqueezed}`);
  console.log(`- Total cumulative distance squeezed: ${totalSqueezeDist.toFixed(1)} mm`);
  console.log("=========================================================");
}

run();
