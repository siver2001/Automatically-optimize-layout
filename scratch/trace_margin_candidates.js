import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

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
  
  // Patch to log details for size 12.5's best Phase 1 candidate
  const originalFill = engine._fillMarginHalves;
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    console.log(`\n=================== TRACING MARGIN FILL FOR ${sizeName} ===================`);
    const wholeBounds = this._getWholePlacementBounds(candidate.placements);
    console.log(`Whole bounds: minX=${wholeBounds?.minX?.toFixed(1)}, maxX=${wholeBounds?.maxX?.toFixed(1)}, minY=${wholeBounds?.minY?.toFixed(1)}, maxY=${wholeBounds?.maxY?.toFixed(1)}`);
    
    // Log info about orient variants
    const step = Math.min(0.1, (config.gridStep || 1) / 2);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const orientVariants = [];
    for (const angle of this._getSplitFillAngles(config)) {
      const halfDefs = buildSplitHalfDefinitions(
        sourceShape?.polygon || polygon,
        sourceShape?.internals?.[0] || []
      );
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }
    console.log(`Orient variants: total=${orientVariants.length}`);
    orientVariants.forEach((o, i) => {
      console.log(`  v${i}: angle=${o.angle}, side=${o.splitOutwardSide}, w=${o.width.toFixed(1)}, h=${o.height.toFixed(1)}`);
    });

    const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
    console.log(`Right-facing orients: count=${rightOrients.length}`);

    // Let's run a manual check of why right orients failed to find ANY valid position
    const allPlacements = [...candidate.placements];
    const spatialIndex = this._buildSpatialIndex(allPlacements, workWidth, workHeight, config.spacing || 0);

    for (const orient of rightOrients) {
      const bb = orient.bb || getBoundingBox(orient.polygon);
      const maxScanX = workWidth - bb.maxX;

      const snappedYs = [];
      const seenSnappedY = new Set();
      const addSnappedY = (y) => {
        const rounded = Math.round(y * 1000) / 1000;
        if (rounded + bb.minY < -1e-6 || rounded + bb.maxY > workHeight + 1e-6 || seenSnappedY.has(rounded)) return;
        seenSnappedY.add(rounded);
        snappedYs.push(rounded);
      };

      const wholePlacements = allPlacements.filter(p => !this._isSplitFillPlacement(p));
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
        const snappedY = pCenterY - (bb.minY + bb.maxY) / 2;
        addSnappedY(snappedY);
      }
      addSnappedY(-bb.minY);
      addSnappedY(workHeight - bb.maxY);

      const perturbedYs = [];
      const seenPerturbedY = new Set();
      const addPerturbedY = (y) => {
        const rounded = Math.round(y * 1000) / 1000;
        if (rounded + bb.minY < -1e-6 || rounded + bb.maxY > workHeight + 1e-6 || seenPerturbedY.has(rounded)) return;
        seenPerturbedY.add(rounded);
        perturbedYs.push(rounded);
      };

      const offsets = [-21, -18, -15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21];
      for (const baseY of snappedYs) {
        for (const offset of offsets) {
          addPerturbedY(baseY + offset);
        }
      }

      console.log(`Orient (angle=${orient.angle}): maxScanX=${maxScanX.toFixed(1)}, snappedYs count=${snappedYs.length}, perturbedYs count=${perturbedYs.length}`);

      let validCount = 0;
      for (const y of perturbedYs) {
        const validX = this._findMinValidXForRightMargin(
          orient, y, 0, maxScanX, allPlacements, config, workWidth, workHeight, spatialIndex
        );
        if (validX !== null) {
          validCount++;
          console.log(`    FOUND VALID POSITION: x=${validX.toFixed(1)}, y=${y.toFixed(1)}`);
        }
      }
      console.log(`  Orient (angle=${orient.angle}) search result: validCount=${validCount}`);
    }

    return originalFill.call(this, sizeName, polygon, candidate, config, workWidth, workHeight);
  };

  // Import buildSplitHalfDefinitions dynamically or locally
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');

  await engine.testCapacity([size125], config);
}
run().catch(console.error);
