import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size125 = shapes.find(s => s.sizeName === '12.5');

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Monkey patch _canPlaceSplitOrient to print overlap details ONLY during margin filling
  let traceEnabled = false;
  const originalCanPlace = engine._canPlaceSplitOrient;
  
  engine._canPlaceSplitOrient = function(occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, skipOutwardCheck) {
    const res = originalCanPlace.call(this, occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, skipOutwardCheck);
    if (traceEnabled && !res) {
      // Find what overlapped
      const spacing = config.spacing || 0;
      const bb2 = orient.bb || getBoundingBox(orient.polygon);
      const minX2 = x + bb2.minX - spacing;
      const maxX2 = x + bb2.maxX + spacing;
      const minY2 = y + bb2.minY - spacing;
      const maxY2 = y + bb2.maxY + spacing;
      
      const overlappingIds = [];
      for (const p of occupiedPlacements) {
        const bb1 = p.orient.bb || getBoundingBox(p.orient.polygon);
        if (
          p.x + bb1.maxX < minX2 ||
          p.x + bb1.minX > maxX2 ||
          p.y + bb1.maxY < minY2 ||
          p.y + bb1.minY > maxY2
        ) {
          continue;
        }
        if (cachedPolygonsOverlap(
          p.orient.polygon, orient.polygon,
          { x: p.x, y: p.y }, { x, y },
          spacing, bb1, bb2
        )) {
          overlappingIds.push(`${p.id}(x=${p.x.toFixed(1)},y=${p.y.toFixed(1)})`);
        }
      }
      console.log(`    Candidate at x=${x.toFixed(1)}, y=${y.toFixed(1)} overlaps with: [${overlappingIds.join(', ')}]`);
    }
    return res;
  };

  const originalFill = engine._fillMarginHalves;
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    traceEnabled = true;
    console.log(`--- Running _fillMarginHalves sizeName=${sizeName} ---`);
    const res = originalFill.call(this, sizeName, polygon, candidate, config, workWidth, workHeight);
    traceEnabled = false;
    return res;
  };

  await engine.testCapacity([size125], config);
}
run().catch(console.error);
