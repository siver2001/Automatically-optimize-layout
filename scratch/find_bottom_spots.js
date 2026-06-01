import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap, roundMetric } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
    doubleContourDeepSearch: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  const res = await engine.testCapacity(testSizes, config);
  const sheet = res.sheetsBySize['7.5'];
  const placements = sheet.placed;
  
  // Filter out any split pieces that were placed, leaving only the 42 wholes
  const fullPolygon = engine._doubleContourSourceBySize?.get('7.5').polygon || testSizes[0].polygon;
  const orient180 = engine._decorateOrient('7.5', 'X', fullPolygon, 180, config, 0.5);
  const wholes = placements
    .filter(p => !p.id.includes('split') && !p.id.startsWith('margin_fill_'))
    .map(p => ({
      ...p,
      x: p.x - config.marginX,
      y: p.y - config.marginY,
      orient: orient180
    }));
  
  console.log(`Base wholes count: ${wholes.length}`);
  
  const sourceShape = testSizes[0];
  const halfDefs = engine._buildSplitPairTemplates(
    engine._getSplitFillAngles(config).flatMap(angle => {
      const defs = engine._fillMarginHalves ? [] : []; // dummy
      return [];
    }), config, 0.5
  ); // Let's build splits ourselves to be exact
  
  // Let's get the split halves definition using splittingUtils
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const normalizedPoly = engine._doubleContourSourceBySize?.get('7.5').polygon || sourceShape.polygon;
  const halfs = buildSplitHalfDefinitions(normalizedPoly, sourceShape.internals?.[0] || []);
  
  const angles = [0, 90, 180, 270];
  const workWidth = 1060;
  const workHeight = 1960;
  
  console.log(`\nTesting all split placements at the bottom margin (Y is swept so piece touches bottom margin):`);
  
  const spatialIndex = engine._buildSpatialIndex(wholes, workWidth, workHeight, config.spacing);
  
  for (const half of halfs) {
    for (const angle of angles) {
      const orient = engine._decorateSplitHalfOrient('7.5', half, angle, config, 0.5);
      const bb = getBoundingBox(orient.polygon);
      
      // We sweep y from workHeight - bb.maxY - 15 to workHeight - bb.maxY with 0.5 step
      let fitPoints = [];
      
      for (let x = 0; x <= workWidth - bb.maxX; x += 1.0) {
        for (let y = workHeight - bb.maxY - 15.0; y <= workHeight - bb.maxY + 0.1; y += 0.5) {
          const roundedY = roundMetric(y, 3);
          const canPlace = engine._canPlaceSplitOrient(wholes, orient, x, roundedY, config, workWidth, workHeight, spatialIndex, true);
          if (canPlace) {
            fitPoints.push({ x, y: roundedY });
          }
        }
      }
      
      if (fitPoints.length > 0) {
        console.log(`Half: ${half.key} | Angle: ${angle} | Width: ${bb.width.toFixed(1)} | Height: ${bb.height.toFixed(1)} | OutwardSide: ${orient.splitOutwardSide}`);
        console.log(`  Fits at bottom in ${fitPoints.length} (x, y) combinations! Sample fits:`, fitPoints.slice(0, 10).map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(', '));
        // Find how many distinct X coordinates have fits
        const distinctX = [...new Set(fitPoints.map(p => p.x))].sort((a, b) => a - b);
        console.log(`  Distinct X coordinates (${distinctX.length}):`, distinctX.slice(0, 20).join(', ') + (distinctX.length > 20 ? '...' : ''));
      }
    }
  }
}

run().catch(console.error);
