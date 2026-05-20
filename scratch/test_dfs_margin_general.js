import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

function roundMetric(val, dec = 3) {
  return Math.round(val * Math.pow(10, dec)) / Math.pow(10, dec);
}

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size9_5 = shapes.find(shape => {
    const name = shape.sizeName || shape.name;
    return name === '9.5' || name === '9_5' || name === '95';
  });

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
  
  engine._optimizeMarginDFS = function(sizeName, basePlacements, orientVariants, marginType, config, workWidth, workHeight) {
    if (marginType !== 'right') return [];
    
    console.log("Running debug of Right Margin DFS...");
    
    const spacing = config.spacing || 0;
    const isYBased = true;
    
    const clusters = [];
    const allCandVals = [];
    for (const orient of orientVariants) {
      const bb = orient.bb || getBoundingBox(orient.polygon);
      const snappedVals = [];
      const seen = new Set();
      
      const addSnappedVal = (val) => {
        const rounded = roundMetric(val, 3);
        if (rounded + bb.minY < -1e-6 || rounded + bb.maxY > workHeight + 1e-6 || seen.has(rounded)) return;
        seen.add(rounded);
        snappedVals.push(rounded);
      };
      
      const wholePlacements = basePlacements.filter(p => !this._isSplitFillPlacement(p));
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
        const snappedY = pCenterY - (bb.minY + bb.maxY) / 2;
        addSnappedVal(snappedY);
      }
      
      addSnappedVal(-bb.minY);
      addSnappedVal(workHeight - bb.maxY);
      
      for (const baseVal of snappedVals) {
        for (const offset of [0, -3, 3, -6, 6]) {
          const rounded = roundMetric(baseVal + offset, 3);
          if (rounded + bb.minY >= -1e-6 && rounded + bb.maxY <= workHeight + 1e-6) {
            allCandVals.push(rounded);
          }
        }
      }
    }
    
    const sortedVals = [...new Set(allCandVals)].sort((a, b) => a - b);
    if (sortedVals.length > 0) {
      let currentCluster = [sortedVals[0]];
      for (let i = 1; i < sortedVals.length; i++) {
        const val = sortedVals[i];
        const lastVal = currentCluster[currentCluster.length - 1];
        if (val - lastVal < 25) {
          currentCluster.push(val);
        } else {
          clusters.push(currentCluster);
          currentCluster = [val];
        }
      }
      clusters.push(currentCluster);
    }
    
    clusters.sort((a, b) => b[0] - a[0]); // bottom-to-top (descending Y)
    
    console.log(`Clusters count: ${clusters.length}`);
    clusters.forEach((c, idx) => {
      console.log(`Cluster ${idx}: [${c[0]} ... ${c[c.length - 1]}]`);
    });
    
    let bestState = {
      placements: [],
      score: -Infinity,
      pairs: 0,
      totalCount: 0
    };
    
    const currentPlacements = [...basePlacements];
    const self = this;
    const path = [];
    
    function search(clusterIndex) {
      if (clusterIndex === clusters.length) {
        const splits = currentPlacements.slice(basePlacements.length);
        const numL = splits.filter(p => p.orient.foot === 'split-left').length;
        const numR = splits.filter(p => p.orient.foot === 'split-right').length;
        const pairs = Math.min(numL, numR);
        const totalCount = splits.length;
        
        let sumCoord = splits.reduce((sum, p) => sum + p.x, 0);
        let altBonus = 0;
        
        const sorted = [...splits].sort((a, b) => a.y - b.y);
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].orient.foot !== sorted[i + 1].orient.foot) {
            altBonus += 1000;
          }
        }
        
        const score = pairs * 10000000 + totalCount * 100000 + altBonus - sumCoord;
        
        console.log(`Leaf reached: path=[${path.join(', ')}], pairs=${pairs}, total=${totalCount}, score=${score.toFixed(1)}`);
        
        if (score > bestState.score) {
          bestState = {
            placements: [...currentPlacements],
            score,
            pairs,
            totalCount
          };
        }
        return;
      }
      
      const cluster = clusters[clusterIndex];
      
      // Option 1: Nothing
      path.push('N');
      search(clusterIndex + 1);
      path.pop();
      
      // Option 2 & 3: Try to place each orientVariant
      const spatialIndex = self._buildSpatialIndex(currentPlacements, workWidth, workHeight, spacing);
      
      for (const orient of orientVariants) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        let bestCoord = null;
        let bestSweepVal = null;
        
        for (const sweepVal of cluster) {
          const validX = self._findMinValidXForRightMargin(
            orient, sweepVal, 0, workWidth - bb.maxX, currentPlacements, config, workWidth, workHeight, spatialIndex
          );
          if (validX !== null) {
            if (bestCoord === null || validX < bestCoord) {
              bestCoord = validX;
              bestSweepVal = sweepVal;
            }
          }
        }
        
        if (bestCoord !== null) {
          const placement = {
            id: `dfs_right_${clusterIndex}_${orient.foot}`,
            orient,
            x: bestCoord,
            y: bestSweepVal,
            effectiveArea: orient.areaMm2,
            isSplit: true
          };
          currentPlacements.push(placement);
          path.push(`${orient.foot === 'split-left' ? 'L' : 'R'}(x=${bestCoord.toFixed(1)},y=${bestSweepVal.toFixed(1)})`);
          search(clusterIndex + 1);
          path.pop();
          currentPlacements.pop();
        }
      }
    }
    
    search(0);
    console.log("BEST STATE FOUND IN DEBUG:");
    console.log(`Pairs: ${bestState.pairs}, Total: ${bestState.totalCount}, Score: ${bestState.score}`);
    for (const p of bestState.placements.slice(basePlacements.length)) {
      console.log(`  Placed ${p.orient.foot} at x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}`);
    }
    
    process.exit(0);
  };
  
  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
