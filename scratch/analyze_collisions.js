import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, translate, rotatePolygon } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  console.log(`Running layout generation for Size 7.5...`);
  const res = await engine.testCapacity(testSizes, config);
  
  const sheet = res.sheetsBySize['7.5'];
  const placements = sheet ? (sheet.placed || sheet.placements) : [];
  
  console.log(`\nPlaced count: ${placements.length}`);
  
  // Let's reconstruct orient objects for each placement to perform the collision analysis
  const decoratedPlacements = [];
  
  // 1. Get the original whole shape and half definitions
  const shape75 = testSizes[0];
  const wholeOrient0 = engine._decorateOrient('7.5', 'X', shape75.polygon, 0, config, config.gridStep);
  
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const halfDefs = buildSplitHalfDefinitions(shape75.polygon, shape75.internals?.[0] || []);
  
  console.log(`Half definitions count: ${halfDefs.length}`);

  for (const p of placements) {
    const isSplit = p.id.includes('split') || p.id.includes('margin_fill');
    let orient = null;
    
    if (!isSplit) {
      orient = engine._decorateOrient('7.5', 'X', shape75.polygon, p.angle, config, config.gridStep);
    } else {
      const foot = p.foot; // 'split-left' or 'split-right'
      const halfDef = halfDefs.find(hd => hd.key === foot);
      if (!halfDef) {
        console.error(`Half def not found for ${foot}`);
        continue;
      }
      orient = engine._decorateSplitHalfOrient('7.5', halfDef, p.angle, config, config.gridStep);
    }
    
    decoratedPlacements.push({
      id: p.id,
      x: p.x - config.marginX, // convert back to local coordinates for _canPlaceSplitOrient
      y: p.y - config.marginY,
      orient,
      isSplit
    });
  }

  console.log("\n=== POST-NESTING COLLISION ANALYSIS ===");
  let overlapsFound = 0;
  
  for (let i = 0; i < decoratedPlacements.length; i++) {
    const p1 = decoratedPlacements[i];
    const bb1 = p1.orient.bb || getBoundingBox(p1.orient.polygon);
    
    for (let j = i + 1; j < decoratedPlacements.length; j++) {
      const p2 = decoratedPlacements[j];
      const bb2 = p2.orient.bb || getBoundingBox(p2.orient.polygon);
      
      // Check 1: Actual material overlap
      if (cachedPolygonsOverlap(
        p1.orient.polygon,
        p2.orient.polygon,
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p2.y },
        config.spacing,
        bb1,
        bb2
      )) {
        console.log(`[MATERIAL OVERLAP] ${p1.id} and ${p2.id} overlap physically!`);
        overlapsFound++;
      }
      
      // Check 2: Die 1 vs Material 2
      if (p1.orient.cycPolygon) {
        const bbCyc = p1.orient.bbCyc || getBoundingBox(p1.orient.cycPolygon);
        if (cachedPolygonsOverlap(
          p2.orient.polygon,
          p1.orient.cycPolygon,
          { x: p2.x, y: p2.y },
          { x: p1.x, y: p1.y },
          config.spacing,
          bb2,
          bbCyc
        )) {
          console.log(`[DIE OVERLAP] Die of ${p1.id} overlaps material of ${p2.id}!`);
          overlapsFound++;
        }
      }
      
      // Check 3: Die 2 vs Material 1
      if (p2.orient.cycPolygon) {
        const bbCyc = p2.orient.bbCyc || getBoundingBox(p2.orient.cycPolygon);
        if (cachedPolygonsOverlap(
          p1.orient.polygon,
          p2.orient.cycPolygon,
          { x: p1.x, y: p1.y },
          { x: p2.x, y: p2.y },
          config.spacing,
          bb1,
          bbCyc
        )) {
          console.log(`[DIE OVERLAP] Die of ${p2.id} overlaps material of ${p1.id}!`);
          overlapsFound++;
        }
      }
    }
  }
  
  console.log(`\nAnalysis completed. Total overlaps/collisions found: ${overlapsFound}`);
}

run().catch(console.error);
