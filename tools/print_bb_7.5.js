import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { getBoundingBox, normalizeToOrigin } from '../server/algorithms/diecut/core/polygonUtils.js';

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
  const bb = getBoundingBox(poly);
  console.log(`Size 8.5 pre-paired shape (unrotated):`);
  console.log(`  Width: ${bb.width.toFixed(2)} mm`);
  console.log(`  Height: ${bb.height.toFixed(2)} mm`);
  console.log(`  Area: ${(bb.width * bb.height).toFixed(2)} mm2`);
  
  // Rotated by 90
  import('../server/algorithms/diecut/core/polygonUtils.js').then(({ rotatePolygon }) => {
    const poly90 = rotatePolygon(poly, Math.PI / 2);
    const bb90 = getBoundingBox(poly90);
    console.log(`Size 8.5 pre-paired shape (rotated 90):`);
    console.log(`  Width: ${bb90.width.toFixed(2)} mm`);
    console.log(`  Height: ${bb90.height.toFixed(2)} mm`);
  });
}

run().catch(console.error);
