import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

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
  
  const originalFillMarginHalves = engine._fillMarginHalves;
  
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    console.log("=== INTERCEPTED _fillMarginHalves ===");
    const step = Math.max(0.5, config.gridStep || 1);
    const spacing = config.spacing || 0;
    
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const halfDefs = buildSplitHalfDefinitions(
      sourceShape?.polygon || polygon,
      sourceShape?.internals?.[0] || []
    );
    
    // Get the orient variants
    const orientVariants = [];
    const fullPolygon = sourceShape?.polygon || polygon;
    for (const angle of this._getSplitFillAngles(config)) {
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }
    
    const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
    const allPlacements = [...candidate.placements];
    const spatialIndex = this._buildSpatialIndex(allPlacements, workWidth, workHeight, spacing);
    
    const Ys = [20.0, 299.1, 578.2, 857.2, 1136.3, 1415.4, 1694.5];
    
    for (const y of Ys) {
      console.log(`\nAt Y = ${y}:`);
      for (const orient of rightOrients) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        const maxScanX = workWidth - bb.maxX;
        
        // Let's scan for valid X
        const validX = this._findMinValidXForRightMargin(
          orient,
          y,
          0,
          maxScanX,
          allPlacements,
          config,
          workWidth,
          workHeight,
          spatialIndex
        );
        
        if (validX !== null) {
          console.log(`  - ${orient.foot} (${orient.key}) is VALID at X = ${validX.toFixed(1)} (xmax = ${(validX + bb.maxX).toFixed(1)})`);
        } else {
          console.log(`  - ${orient.foot} (${orient.key}) is INVALID`);
        }
      }
    }
    
    return originalFillMarginHalves.call(this, sizeName, polygon, candidate, config, workWidth, workHeight);
  };
  
  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
