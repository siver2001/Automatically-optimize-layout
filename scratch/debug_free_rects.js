import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const targetSize = shapes.find(shape => (shape.sizeName || shape.name) === '8');
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
  
  const original_findSplitFillPlacements = engine._findSplitFillPlacements;
  engine._findSplitFillPlacements = function(sizeName, polygon, baseCandidate, config, workWidth, workHeight) {
    const step = Math.max(0.5, config.gridStep || 1);
    const { orientVariants, pairTemplates, minWidth, minHeight, minHalfArea, minBbArea } = this._getSplitFillTemplates(sizeName, polygon, config, step);
    const baseFreeRects = this._buildPreparedSplitFreeRects(baseCandidate.placements, workWidth, workHeight, config.spacing || 0);

    const usableFreeRects = baseFreeRects.filter(r =>
      orientVariants.some(o => r.width + 1e-6 >= o.width && r.height + 1e-6 >= o.height)
    );

    usableFreeRects.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    const disjointRects = [];
    for (const rect of usableFreeRects) {
      const hasOverlap = disjointRects.some(r => {
        const ix = Math.max(r.x, rect.x);
        const iy = Math.max(r.y, rect.y);
        const iw = Math.min(r.x + r.width, rect.x + rect.width) - ix;
        const ih = Math.min(r.y + r.height, rect.y + rect.height) - iy;
        if (iw > 0 && ih > 0) {
          const intersectArea = iw * ih;
          const minArea = Math.min(r.width * r.height, rect.width * rect.height);
          return intersectArea > 0.2 * minArea;
        }
        return false;
      });
      if (!hasOverlap) {
        disjointRects.push(rect);
      }
    }

    const usableFreeArea = disjointRects.reduce((sum, r) => sum + r.width * r.height, 0);
    const maxPossiblePieces = Math.floor(usableFreeArea / minBbArea);

    console.log(`\n=== DEBUG SIZE ${sizeName} CANDIDATE ===`);
    console.log(`minWidth: ${minWidth.toFixed(1)} | minHeight: ${minHeight.toFixed(1)} | minHalfArea: ${minHalfArea.toFixed(0)} | minBbArea: ${minBbArea.toFixed(0)}`);
    console.log(`baseFreeRects Count: ${baseFreeRects.length}`);
    console.log(`usableFreeRects Count: ${usableFreeRects.length}`);
    console.log(`disjointRects Count: ${disjointRects.length}`);
    console.log(`usableFreeArea: ${usableFreeArea.toFixed(0)}`);
    console.log(`maxPossiblePieces: ${maxPossiblePieces}`);
    disjointRects.forEach((r, i) => {
      console.log(`  Rect ${i+1}: x=${r.x.toFixed(1)}, y=${r.y.toFixed(1)}, w=${r.width.toFixed(1)}, h=${r.height.toFixed(1)}, area=${(r.width*r.height).toFixed(0)}`);
    });

    const res = original_findSplitFillPlacements.apply(this, arguments);
    return res;
  };

  await engine.testCapacity([targetSize], config);
}

run().catch(console.error);
