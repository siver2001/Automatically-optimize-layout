import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const shape = shapes.find(s => (s.sizeName || s.name) === '7.5');
  const halfDefs = buildSplitHalfDefinitions(shape.polygon, shape.internals?.[0] || []);
  
  const engine = new CapacityTestDoubleInsoleDoubleContourPattern({ spacing: 3, gridStep: 0.5 });
  
  console.log("=== HALF DEFS ===");
  for (const h of halfDefs) {
    console.log(`Key: ${h.key} | splitOutwardVector: [${h.splitOutwardVector.x.toFixed(4)}, ${h.splitOutwardVector.y.toFixed(4)}]`);
    const dec = engine._decorateSplitHalfOrient('7.5', h, 0, { spacing: 3 }, 0.5);
    console.log(`  Decorate Angle 0 -> splitOutwardSide: ${dec.splitOutwardSide}`);
    const dec180 = engine._decorateSplitHalfOrient('7.5', h, 180, { spacing: 3 }, 0.5);
    console.log(`  Decorate Angle 180 -> splitOutwardSide: ${dec180.splitOutwardSide}`);
  }
}

run().catch(console.error);
