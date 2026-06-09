import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
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
      
      const res = super._finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly, validate);
      if (res && res.placed) {
        console.log(`\n=== FINAL CANDIDATE PLACEMENTS (mirrored, count=${res.placed.length}) ===`);
        res.placed.forEach((p, idx) => {
          console.log(`idx: ${idx}, id: ${p.id}, foot: ${p.foot}, x: ${p.x}, y: ${p.y}`);
        });

        console.log(`\n=== RAW PLACEMENTS (aligned, count=${candidate.placements.length}) ===`);
        candidate.placements.forEach((p, idx) => {
          console.log(`idx: ${idx}, id: ${p.id}, foot: ${p.orient?.foot || p.foot}, x: ${p.x}, y: ${p.y}`);
        });

        // Run pairwise checks as in _resolveOverlapPlacements
        console.log(`\n=== RUNNING PAIRWISE RAW OVERLAP CHECKS ===`);
        const spacing = config.spacing || 0;
        const placements = candidate.placements;
        for (let i = 0; i < placements.length; i++) {
          const pA = placements[i];
          const isSplitA = this._isSplitFillPlacement(pA);
          if (!isSplitA) continue;

          for (let j = 0; j < placements.length; j++) {
            if (i === j) continue;
            const pB = placements[j];

            if (pA.orient?.cycPolygon) {
              const bbA = pA.orient.bbCyc || getBoundingBox(pA.orient.cycPolygon);
              const bbB = pB.orient?.bb || getBoundingBox(pB.orient?.polygon);
              
              const overlap = cachedPolygonsOverlap(
                pA.orient.cycPolygon,
                pB.orient.polygon,
                { x: pA.x, y: pA.y },
                { x: pB.x, y: pB.y },
                spacing,
                bbA,
                bbB
              );

              if (overlap) {
                console.log(`[RAW OVERLAP DETECTED] pA: ${pA.id} (${pA.x}, ${pA.y}) and pB: ${pB.id} (${pB.x}, ${pB.y}) overlap!`);
              }
            }
          }
        }
      }
      return res;
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
