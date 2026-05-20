import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
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

  class TracingEngine extends CapacityTestDoubleInsoleDoubleContourPattern {
    _findMinValidXForRightMargin(orient, y, minX, maxX, allPlacements, config, workWidth, workHeight, spatialIndex) {
      console.log(`\n--- TRACING _findMinValidXForRightMargin ---`);
      console.log(`y: ${y.toFixed(2)}, minX: ${minX.toFixed(2)}, maxX: ${maxX.toFixed(2)}`);
      
      let lastValidX = null;
      const step = Math.max(0.5, config.gridStep || 1);
      const scanDepthLimit = 350;
      const limitX = Math.max(minX, maxX - scanDepthLimit);

      console.log(`scanDepthLimit: ${scanDepthLimit}, limitX: ${limitX.toFixed(2)}`);
      
      for (let x = maxX; x >= limitX - 1e-6; x -= step) {
        const canPlace = this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, true);
        if (canPlace) {
          lastValidX = x;
        } else {
          console.log(`  Failed at x = ${x.toFixed(2)}.`);
          // Let's trace why it failed at this x
          this._traceCanPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex);
          break;
        }
      }
      
      console.log(`Result lastValidX: ${lastValidX !== null ? lastValidX.toFixed(2) : 'NULL'}`);
      return lastValidX;
    }

    _traceCanPlaceSplitOrient(occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex) {
      const spacing = config.spacing || 0;
      const bb2 = orient.bb || getBoundingBox(orient.polygon);
      const minX2 = x + bb2.minX - spacing;
      const maxX2 = x + bb2.maxX + spacing;
      const minY2 = y + bb2.minY - spacing;
      const maxY2 = y + bb2.maxY + spacing;

      if (
        x + bb2.minX < -1e-6 ||
        y + bb2.minY < -1e-6 ||
        x + bb2.maxX > workWidth + 1e-6 ||
        y + bb2.maxY > workHeight + 1e-6
      ) {
        console.log(`    Reason: Out of sheet bounds! minX: ${(x+bb2.minX).toFixed(2)}, maxX: ${(x+bb2.maxX).toFixed(2)}, minY: ${(y+bb2.minY).toFixed(2)}, maxY: ${(y+bb2.maxY).toFixed(2)}`);
        return;
      }

      for (const entry of occupiedPlacements) {
        const bb1 = entry.orient.bb || getBoundingBox(entry.orient.polygon);
        const minX1 = entry.x + bb1.minX - spacing;
        const maxX1 = entry.x + bb1.maxX + spacing;
        const minY1 = entry.y + bb1.minY - spacing;
        const maxY1 = entry.y + bb1.maxY + spacing;

        if (maxX1 < minX2 || minX1 > maxX2 || maxY1 < minY2 || minY1 > maxY2) {
          continue;
        }

        const overlap = cachedPolygonsOverlap(
          entry.orient.polygon,
          orient.polygon,
          { x: entry.x, y: entry.y },
          { x, y },
          spacing,
          bb1,
          bb2
        );
        if (overlap) {
          console.log(`    Reason: Overlap with placement ID=${entry.id} (foot=${entry.orient.foot}, x=${entry.x.toFixed(2)}, y=${entry.y.toFixed(2)})`);
          return;
        }
      }
      
      console.log(`    Reason: Unknown! (Spatial index mismatch or skipOutwardCheck issue)`);
    }
  }

  const engine = new TracingEngine(config);
  const shape8_5 = shapes.find(s => (s.sizeName || s.name) === '8.5');
  
  await engine.testCapacity([{
    ...shape8_5,
    sizeName: '8.5'
  }], config);
}

// Helper functions for getBoundingBox and polygonArea
function getBoundingBox(poly) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

run().catch(console.error);
