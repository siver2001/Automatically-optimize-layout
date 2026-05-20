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
  
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    console.log("=== RUNNING DFS TRACE ===");
    const step = Math.max(0.5, config.gridStep || 1);
    const spacing = config.spacing || 0;
    
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const halfDefs = buildSplitHalfDefinitions(
      sourceShape?.polygon || polygon,
      sourceShape?.internals?.[0] || []
    );
    
    const orientVariants = [];
    const fullPolygon = sourceShape?.polygon || polygon;
    for (const angle of this._getSplitFillAngles(config)) {
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }
    
    const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
    const basePlacements = [...candidate.placements];
    
    const rowYs = [...new Set(basePlacements.map(p => roundMetric(p.y, 3)))].sort((a, b) => a - b);
    
    let bestState = {
      placements: [],
      score: -Infinity,
      pairs: 0,
      totalCount: 0
    };
    
    let statesExplored = 0;
    
    function dfs(rowIndex, currentPlacements, path = "") {
      statesExplored++;
      
      const splits = currentPlacements.slice(basePlacements.length);
      const splitsStr = splits.map(s => `${s.orient.foot === 'split-left' ? 'L' : 'R'}@y${roundMetric(s.y, 1)}`).join(', ');
      
      if (rowIndex === rowYs.length) {
        const numL = splits.filter(p => p.orient.foot === 'split-left').length;
        const numR = splits.filter(p => p.orient.foot === 'split-right').length;
        const pairs = Math.min(numL, numR);
        const totalCount = splits.length;
        
        const sumX = splits.reduce((sum, p) => sum + p.x, 0);
        
        let altBonus = 0;
        const sorted = [...splits].sort((a, b) => a.y - b.y);
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].orient.foot !== sorted[i + 1].orient.foot) {
            altBonus += 1000;
          }
        }
        
        const score = pairs * 10000000 + totalCount * 100000 + altBonus - sumX;
        
        console.log(`Leaf reached: path=[${path}], splits=[${splitsStr}], score=${score}, pairs=${pairs}, totalCount=${totalCount}`);
        
        if (score > bestState.score) {
          bestState = {
            placements: [...currentPlacements],
            score,
            pairs,
            totalCount,
            splits: splits.map(s => ({ id: s.id, x: s.x, y: s.y, foot: s.orient.foot }))
          };
        }
        return;
      }
      
      const yBase = rowYs[rowIndex];
      
      // Option 1: Place nothing in this row
      dfs(rowIndex + 1, currentPlacements, path + "N");
      
      // Option 2 & 3: Place L or R
      for (const orient of rightOrients) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        const maxScanX = workWidth - bb.maxX;
        
        let bestX = null;
        let bestY = null;
        
        const spatialIndex = engine._buildSpatialIndex(currentPlacements, workWidth, workHeight, spacing);
        
        for (const offset of [0, -3, 3, -6, 6]) {
          const y = yBase + offset;
          const validX = engine._findMinValidXForRightMargin(
            orient,
            y,
            0,
            maxScanX,
            currentPlacements,
            config,
            workWidth,
            workHeight,
            spatialIndex
          );
          
          if (validX !== null) {
            if (bestX === null || validX < bestX) {
              bestX = validX;
              bestY = y;
            }
          }
        }
        
        if (bestX !== null) {
          const placement = {
            id: `dfs_right_${rowIndex}_${orient.foot}`,
            orient,
            x: bestX,
            y: bestY,
            effectiveArea: orient.areaMm2,
            isSplit: true
          };
          currentPlacements.push(placement);
          const fChar = orient.foot === 'split-left' ? 'L' : 'R';
          dfs(rowIndex + 1, currentPlacements, path + fChar);
          currentPlacements.pop();
        }
      }
    }
    
    dfs(0, basePlacements);
    
    console.log(`\nBest State: Pairs = ${bestState.pairs}, Total = ${bestState.totalCount}`);
    bestState.splits?.forEach(s => {
      console.log(`  ${s.id} | x: ${s.x.toFixed(1)} | y: ${s.y.toFixed(1)} | foot: ${s.foot}`);
    });
    
    process.exit(0);
  };
  
  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
