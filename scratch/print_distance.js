import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, translate } from '../server/algorithms/diecut/core/polygonUtils.js';

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
        const aligned = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight, candidate.sizeName);
        const p11 = aligned[11];
        const p43 = aligned[43];

        const polyA_un = translate(p11.orient.polygon, p11.x, p11.y);
        const polyB_un = translate(p43.orient.polygon, p43.x, p43.y);

        const polyA_mir = item11.polygon;
        const polyB_mir = item43.polygon;

        const sqDistPointSegment = (px, py, cx, cy, dx, dy) => {
          let l2 = (dx - cx) ** 2 + (dy - cy) ** 2;
          if (l2 === 0) return (px - cx) ** 2 + (py - cy) ** 2;
          let t = ((px - cx) * (dx - cx) + (py - cy) * (dy - cy)) / l2;
          t = Math.max(0, Math.min(1, t));
          return (px - (cx + t * (dx - cx))) ** 2 + (py - (cy + t * (dy - cy))) ** 2;
        };

        // For mirB vertex 3 (which is index 3) and mirA edge 1 (which is segment index 1: from index 1 to 2)
        const p_un = polyB_un[3];
        const seg1_un = polyA_un[1];
        const seg2_un = polyA_un[2];
        const distUn = Math.sqrt(sqDistPointSegment(p_un.x, p_un.y, seg1_un.x, seg1_un.y, seg2_un.x, seg2_un.y));

        const p_mir = polyB_mir[3];
        const seg1_mir = polyA_mir[1];
        const seg2_mir = polyA_mir[2];
        const distMir = Math.sqrt(sqDistPointSegment(p_mir.x, p_mir.y, seg1_mir.x, seg1_mir.y, seg2_mir.x, seg2_mir.y));

        console.log(`Exact distance in unmirrored: ${distUn}`);
        console.log(`Exact distance in mirrored: ${distMir}`);
      }
    }
    return res;
  };

  await engine.testCapacity([sizeInfo], config);
}

run().catch(console.error);
