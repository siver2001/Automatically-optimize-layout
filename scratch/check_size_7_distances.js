import fs from 'fs';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

// Simple polygon distance function (minimum distance between any vertex of poly1 and any segment of poly2, and vice versa)
function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polygonDistance(poly1, poly2) {
  let minDist = Infinity;
  for (const p of poly1) {
    for (let i = 0; i < poly2.length; i++) {
      const a = poly2[i];
      const b = poly2[(i + 1) % poly2.length];
      const d = pointToSegmentDistance(p, a, b);
      if (d < minDist) minDist = d;
    }
  }
  for (const p of poly2) {
    for (let i = 0; i < poly1.length; i++) {
      const a = poly1[i];
      const b = poly1[(i + 1) % poly1.length];
      const d = pointToSegmentDistance(p, a, b);
      if (d < minDist) minDist = d;
    }
  }
  return minDist;
}

async function run() {
  // Read the new layout coordinates and polygons for Size 7
  // We can load them from the saved layout data or run a quick placement
  // Actually, we have the new layouts json but it only has bounding boxes.
  // To get the actual polygons, let's load from the dxf and run the engine to get materialized placements.
  const { parseCadBufferToSizedShapes } = await import('../server/algorithms/diecut/core/dxfParser.js');
  const { CapacityTestDoubleInsoleDoubleContourPattern } = await import('../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js');

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
  const shape7 = shapes.find(shape => (shape.sizeName || shape.name) === '7');
  
  console.log("Generating materialized placements for Size 7...");
  const res = await engine.testCapacity([shape7], config);
  const sheet = res.sheetsBySize['7'];
  if (!sheet || !sheet.placed) {
    console.error("Failed to generate sheet for Size 7");
    return;
  }

  const placements = sheet.placed;
  const splitPieces = placements.filter(p => p.id.includes('split') || p.foot.startsWith('split-'));
  const otherPieces = placements.filter(p => !p.id.includes('split') && !p.foot.startsWith('split-'));

  console.log(`\nFound ${splitPieces.length} split pieces. Checking their distance to the nearest other piece...`);
  console.log(`Configured spacing limit: ${config.spacing} mm`);
  
  for (const sp of splitPieces) {
    let nearestPiece = null;
    let minD = Infinity;

    for (const op of otherPieces) {
      const d = polygonDistance(sp.polygon, op.polygon);
      if (d < minD) {
        minD = d;
        nearestPiece = op;
      }
    }

    // Also check other split pieces
    for (const osp of splitPieces) {
      if (osp.id === sp.id) continue;
      const d = polygonDistance(sp.polygon, osp.polygon);
      if (d < minD) {
        minD = d;
        nearestPiece = osp;
      }
    }

    console.log(`\n* Split Piece: ${sp.id} (${sp.foot})`);
    console.log(`  - Nearest Piece: ${nearestPiece ? nearestPiece.id : 'None'} (${nearestPiece ? nearestPiece.foot : ''})`);
    console.log(`  - Actual Distance: ${minD.toFixed(3)} mm (configured spacing: ${config.spacing} mm)`);
  }
}

run().catch(console.error);
