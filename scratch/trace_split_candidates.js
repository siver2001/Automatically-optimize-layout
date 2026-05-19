import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Hook _canPlaceSplitOrient
  const originalCanPlace = engine._canPlaceSplitOrient;
  engine._canPlaceSplitOrient = function(occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex) {
    const res = originalCanPlace.call(this, occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex);
    // If it's a split piece at the bottom (y > 1700), log the checks!
    if (y > 1700) {
      console.log(`[Trace] _canPlaceSplitOrient: foot=${orient.foot}, x=${x.toFixed(2)}, y=${y.toFixed(2)}, splitOutwardSide=${orient.splitOutwardSide}, result=${res}`);
      if (!res) {
        // Let's find why
        const bb = orient.bb || getBoundingBox(orient.polygon);
        const minX = x + bb.minX;
        const maxX = x + bb.maxX;
        const minY = y + bb.minY;
        const maxY = y + bb.maxY;
        if (minX < -1e-6 || maxX > workWidth + 1e-6 || minY < -1e-6 || maxY > workHeight + 1e-6) {
          console.log(`  Reason: Out of sheet bounds. minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minY=${minY.toFixed(2)}, maxY=${maxY.toFixed(2)}`);
        } else {
          // Check outward facing
          const outward = this._isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex);
          console.log(`  Outward facing check=${outward}`);
          // Let's also check collision with occupied placements
          const spacing = config.spacing || 0;
          for (const other of occupiedPlacements) {
            const obb = other.orient?.bb || getBoundingBox(other.orient?.polygon || []);
            const oMinX = other.x + obb.minX;
            const oMaxX = other.x + obb.maxX;
            const oMinY = other.y + obb.minY;
            const oMaxY = other.y + obb.maxY;
            
            // Check bounding box intersection first
            const noOverlapBB = (
              maxX + spacing <= oMinX - 1e-6 ||
              minX - spacing >= oMaxX + 1e-6 ||
              maxY + spacing <= oMinY - 1e-6 ||
              minY - spacing >= oMaxY + 1e-6
            );
            if (!noOverlapBB) {
              console.log(`  Collision BB overlap with other id=${other.id}, foot=${other.orient?.foot || other.foot}`);
            }
          }
        }
      }
    }
    return res;
  };

  const sizeShape = shapes.find(s => s.sizeName === '12.5');
  console.log('Running testCapacity for Size 12.5...');
  await engine.testCapacity([sizeShape], config);
}

run().catch(console.error);
