import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, polygonsOverlap, translate } from '../server/algorithms/diecut/core/polygonUtils.js';

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
  const sizeInfo = shapes.find(shape => (shape.sizeName || shape.name) === '9');
  
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly, validate) {
    const res = originalFinalize.call(this, candidate, config, workWidth, workHeight, fastOnly, validate);
    if (res && res.placed && res.placed.length === 49) {
      const item11 = res.placed[11];
      const item43 = res.placed[43];

      if (Math.abs(item11.x - 93.818) < 0.1 && Math.abs(item43.x - 14.107) < 0.1) {
        console.log("\n--- DETAILED CO-EXISTENCE STUDY FOR OVERLAPPING PAIR ---");
        const aligned = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight, candidate.sizeName);
        const p11 = aligned[11];
        const p43 = aligned[43];

        const polyA_un = translate(p11.orient.polygon, p11.x, p11.y);
        const polyB_un = translate(p43.orient.polygon, p43.x, p43.y);

        const polyA_mir = item11.polygon;
        const polyB_mir = item43.polygon;

        // Trace segments intersecting or spacing violations in mirrored
        const spacing = config.spacing || 0;
        const sqSpacing = spacing * spacing;
        const pad = spacing;

        const findDiscrepancies = (polyA, polyB, nameA, nameB) => {
          const nA = polyA.length;
          const nB = polyB.length;
          let found = false;

          for (let i = 0; i < nA; i++) {
            const a1 = polyA[i];
            const a2 = polyA[(i + 1) % nA];
            for (let j = 0; j < nB; j++) {
              const b1 = polyB[j];
              const b2 = polyB[(j + 1) % nB];

              // Check bounding boxes of edges
              const minAx = Math.min(a1.x, a2.x), maxAx = Math.max(a1.x, a2.x);
              const minAy = Math.min(a1.y, a2.y), maxAy = Math.max(a1.y, a2.y);
              const minBx = Math.min(b1.x, b2.x), maxBx = Math.max(b1.x, b2.x);
              const minBy = Math.min(b1.y, b2.y), maxBy = Math.max(b1.y, b2.y);

              if (maxAx + pad < minBx || minAx - pad > maxBx || maxAy + pad < minBy || minAy - pad > maxBy) {
                continue;
              }

              // Ray/segment intersection helper (embedded inline for simplicity)
              const segmentsIntersect = (p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) => {
                let s1x = p1x - p0x, s1y = p1y - p0y;
                let s2x = p3x - p2x, s2y = p3y - p2y;
                let s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / (-s2x * s1y + s1x * s2y);
                let t = ( s2x * (p0y - p2y) - s2y * (p0x - p2x)) / (-s2x * s1y + s1x * s2y);
                return (s >= 0 && s <= 1 && t >= 0 && t <= 1);
              };

              const sqDistPointSegment = (px, py, cx, cy, dx, dy) => {
                let l2 = (dx - cx) ** 2 + (dy - cy) ** 2;
                if (l2 === 0) return (px - cx) ** 2 + (py - cy) ** 2;
                let t = ((px - cx) * (dx - cx) + (py - cy) * (dy - cy)) / l2;
                t = Math.max(0, Math.min(1, t));
                return (px - (cx + t * (dx - cx))) ** 2 + (py - (cy + t * (dy - cy))) ** 2;
              };

              if (segmentsIntersect(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) {
                console.log(`  [INTERSECTION] ${nameA} edge ${i} intersects ${nameB} edge ${j}`);
                found = true;
              }

              if (spacing > 0) {
                if (sqDistPointSegment(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y) <= sqSpacing) {
                  console.log(`  [SPACING VIOLATION] ${nameA} vertex ${i} close to ${nameB} edge ${j}`);
                  found = true;
                }
                if (sqDistPointSegment(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y) <= sqSpacing) {
                  console.log(`  [SPACING VIOLATION] ${nameB} vertex ${j} close to ${nameA} edge ${i}`);
                  found = true;
                }
              }
            }
          }
          return found;
        };

        console.log("Analyzing Unmirrored:");
        const unFound = findDiscrepancies(polyA_un, polyB_un, "unA", "unB");
        if (!unFound) console.log("  No edge intersections or spacing violations found in unmirrored.");

        console.log("Analyzing Mirrored:");
        const mirFound = findDiscrepancies(polyA_mir, polyB_mir, "mirA", "mirB");
        if (!mirFound) console.log("  No edge intersections or spacing violations found in mirrored.");
      }
    }
    return res;
  };

  await engine.testCapacity([sizeInfo], config);
}

run().catch(console.error);
