import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size9_5 = shapes.find(shape => (shape.sizeName || shape.name) === '9.5');

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

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  engine._doubleContourSourceBySize = new Map([
    ['9.5', { polygon: size9_5.polygon, internals: size9_5.internals || [] }]
  ]);

  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;
  const candidate = engine._evaluateFootCandidate('9.5', 'L', size9_5.polygon, config, workWidth, workHeight);

  console.log("Candidate Placements count:", candidate.placements.length);
  for (const p of candidate.placements) {
    const bb = getBoundingBox(p.orient?.polygon || p.polygon);
    console.log(`ID: ${p.id} | x: ${p.x.toFixed(1)} | y: ${p.y.toFixed(1)} | bb: [${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}, ${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}] | size: ${(bb.maxX - bb.minX).toFixed(1)}x${(bb.maxY - bb.minY).toFixed(1)}`);
  }
}

run().catch(console.error);
