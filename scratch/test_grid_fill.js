import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

function roundMetric(val, dec = 3) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}

// Override _findSplitFillPlacements with our super fast Direct Grid-Filling algorithm
CapacityTestDoubleInsoleDoubleContourPattern.prototype._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
  return candidate;
};

CapacityTestDoubleInsoleDoubleContourPattern.prototype._findSplitFillPlacements = function(sizeName, polygon, baseCandidate, config, workWidth, workHeight) {
  if (config.preparedSplitFillEnabled !== true) {
    return [];
  }

  const step = Math.max(0.5, config.gridStep || 1);
  const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
  const halfDefs = buildSplitHalfDefinitions(
    sourceShape?.polygon || polygon,
    sourceShape?.internals?.[0] || []
  );
  if (!halfDefs.length || !baseCandidate?.placements?.length) return [];

  const spacing = config.spacing || 0;
  const orientVariants = [];
  const fullPolygon = sourceShape?.polygon || polygon;
  for (const angle of this._getSplitFillAngles(config)) {
    for (const halfDef of halfDefs) {
      orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
    }
  }

  orientVariants.sort((left, right) =>
    (left.bbCyc?.width || left.width) * (left.bbCyc?.height || left.height) -
    (right.bbCyc?.width || right.width) * (right.bbCyc?.height || right.height)
  );

  const freeRects = this._buildPreparedSplitFreeRects(baseCandidate.placements, workWidth, workHeight, spacing);

  const finalPlacements = [];
  let leftCount = 0;
  let rightCount = 0;

  for (const rect of freeRects) {
    if (rect.width < 10 || rect.height < 10) continue;

    let bestGrid = null;
    let maxGridCount = 0;

    for (const variant of orientVariants) {
      const isLeft = variant.foot === 'split-left';
      const bb = variant.bbCyc || variant.bb;
      const colW = bb.width + spacing;
      const rowH = bb.height + spacing;
      if (isNaN(colW) || isNaN(rowH) || colW <= 1 || rowH <= 1) continue;
      
      const cols = Math.floor((rect.width + spacing) / colW);
      const rows = Math.floor((rect.height + spacing) / rowH);
      const count = cols * rows;

      if (count > maxGridCount) {
        const partner = orientVariants.find(v => 
          v.foot === (isLeft ? 'split-right' : 'split-left') &&
          v.splitPairAngleFamily === variant.splitPairAngleFamily
        );
        
        if (partner) {
          maxGridCount = count;
          bestGrid = {
            leftOrient: isLeft ? variant : partner,
            rightOrient: isLeft ? partner : variant,
            cols,
            rows,
            colWidth: colW,
            rowHeight: rowH,
            bbL: isLeft ? bb : (partner.bbCyc || partner.bb),
            bbR: isLeft ? (partner.bbCyc || partner.bb) : bb
          };
        }
      }
    }

    if (bestGrid && maxGridCount > 0) {
      const { leftOrient, rightOrient, cols, rows, colWidth, rowHeight, bbL, bbR } = bestGrid;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const useLeft = (leftCount <= rightCount);
          const orient = useLeft ? leftOrient : rightOrient;
          const bb = useLeft ? bbL : bbR;

          const x = roundMetric(rect.x - bb.minX + c * colWidth, 3);
          const y = roundMetric(rect.y - bb.minY + r * rowHeight, 3);

          if (
            x + bb.minX >= rect.x - 1e-3 &&
            x + bb.maxX <= rect.x + rect.width + 1e-3 &&
            y + bb.minY >= rect.y - 1e-3 &&
            y + bb.maxY <= rect.y + rect.height + 1e-3
          ) {
            finalPlacements.push({
              id: `split_fill_${finalPlacements.length}`,
              orient,
              x,
              y,
              effectiveArea: orient.areaMm2,
              isSplit: true
            });

            if (useLeft) leftCount++;
            else rightCount++;
          }
        }
      }
    }
  }

  // Return the grid placements directly (already perfectly straight, aligned, and safe)
  return finalPlacements;
};

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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Test Size 7.5
  const size75 = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).find(shape => shape.sizeName === '7.5');

  console.log("-------------------------------------");
  console.log("Testing Size 7.5 with Smart Grid-Filling...");
  const t0 = performance.now();
  const res75 = await engine.testCapacity([size75], config);
  const t1 = performance.now();
  console.log(`Grid-Filling took: ${((t1 - t0) / 1000).toFixed(4)}s`);
  console.log(`Size 7.5 Placements: ${res75.sheetsBySize['7.5'].placedCount}`);

  // Test Size 8.0
  const size80 = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).find(shape => shape.sizeName === '8');

  console.log("-------------------------------------");
  console.log("Testing Size 8.0 with Smart Grid-Filling...");
  const t2 = performance.now();
  const res80 = await engine.testCapacity([size80], config);
  const t3 = performance.now();
  console.log(`Grid-Filling took: ${((t3 - t2) / 1000).toFixed(4)}s`);
  console.log(`Size 8.0 Placements: ${res80.sheetsBySize['8'].placedCount}`);
}

run().catch(console.error);
