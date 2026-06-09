import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, translate } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
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

  class TestEngine extends CapacityTestDoubleInsoleDoubleContourPattern {
    _finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly = true, validate = true) {
      if (candidate.sizeName !== '9') return super._finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly, validate);
      
      const pA = candidate.placements.find(p => p.id === 'margin_fill_right_4');
      const pB = candidate.placements.find(p => p.id === 'body_6_5');

      if (pA && pB) {
        console.log('\n--- CANDIDATE 2 OVERLAP CHECK ---');
        const spacing = config.spacing || 0;
        const bbA = pA.orient.bbCyc || getBoundingBox(pA.orient.cycPolygon);
        const bbB = pB.orient.bb || getBoundingBox(pB.orient.polygon);

        const overlapRaw = cachedPolygonsOverlap(
          pA.orient.cycPolygon,
          pB.orient.polygon,
          { x: pA.x, y: pA.y },
          { x: pB.x, y: pB.y },
          spacing,
          bbA,
          bbB
        );
        console.log(`overlapRaw: ${overlapRaw}`);

        const overlapRawMaterial = cachedPolygonsOverlap(
          pA.orient.polygon,
          pB.orient.polygon,
          { x: pA.x, y: pA.y },
          { x: pB.x, y: pB.y },
          spacing,
          pA.orient.bb,
          bbB
        );
        console.log(`overlapRawMaterial: ${overlapRawMaterial}`);

        // Let's mirror them manually like in _materializePlacedItems
        const mirrorPointY = (pt) => ({
          x: pt.x,
          y: config.sheetHeight - pt.y
        });

        const worldXA = config.marginX + pA.x;
        const worldYA = config.marginY + pA.y;
        const polyA_mirrored = translate(pA.orient.cycPolygon, worldXA, worldYA).map(mirrorPointY);
        const polyA_mirrored_mat = translate(pA.orient.polygon, worldXA, worldYA).map(mirrorPointY);

        const worldXB = config.marginX + pB.x;
        const worldYB = config.marginY + pB.y;
        const polyB_mirrored = translate(pB.orient.polygon, worldXB, worldYB).map(mirrorPointY);

        const bbA_mirrored = getBoundingBox(polyA_mirrored);
        const bbA_mirrored_mat = getBoundingBox(polyA_mirrored_mat);
        const bbB_mirrored = getBoundingBox(polyB_mirrored);

        const overlapMirrored = cachedPolygonsOverlap(
          polyA_mirrored,
          polyB_mirrored,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          spacing,
          bbA_mirrored,
          bbB_mirrored
        );
        console.log(`overlapMirrored: ${overlapMirrored}`);

        const overlapMirroredMaterial = cachedPolygonsOverlap(
          polyA_mirrored_mat,
          polyB_mirrored,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          spacing,
          bbA_mirrored_mat,
          bbB_mirrored
        );
        console.log(`overlapMirroredMaterial: ${overlapMirroredMaterial}`);
      }

      return super._finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly, validate);
    }
  }

  const engine = new TestEngine(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '9');

  await engine.testCapacity(testSizes, config);
}

run().catch(console.error);
