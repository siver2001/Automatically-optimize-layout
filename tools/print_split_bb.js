import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { getBoundingBox, normalizeToOrigin } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const shape75 = shapes.find(s => (s.sizeName || s.name) === '7.5');
  
  if (!shape75) {
    console.error("Size 7.5 not found!");
    return;
  }

  const poly = normalizeToOrigin(shape75.polygon);
  const halfDefs = buildSplitHalfDefinitions(poly, shape75.internals?.[0] || []);
  
  console.log(`Size 7.5 split halves:`);
  for (const hd of halfDefs) {
    const bb = getBoundingBox(normalizeToOrigin(hd.polygon));
    console.log(` - Half ${hd.key}:`);
    console.log(`   Width: ${bb.width.toFixed(2)} mm`);
    console.log(`   Height: ${bb.height.toFixed(2)} mm`);
  }
}

run().catch(console.error);
