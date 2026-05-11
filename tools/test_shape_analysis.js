import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';

function getBoundingBox(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  const targetSizes = ['3.5', '4', '4.5'];
  for (const shape of shapes) {
    const name = shape.sizeName || shape.name;
    if (!targetSizes.includes(name)) continue;
    
    const bb = getBoundingBox(shape.polygon);
    console.log(`Size ${name}:`);
    console.log(`  BBox: ${bb.width.toFixed(2)} x ${bb.height.toFixed(2)} mm`);
    
    // Check at various angles
    for (const angle of [0, 75, 90, 105]) {
      const rad = angle * Math.PI / 180;
      const rotated = shape.polygon.map(p => ({
        x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
        y: p.x * Math.sin(rad) + p.y * Math.cos(rad)
      }));
      const rbb = getBoundingBox(rotated);
      const workW = 1090, workH = 1960;
      const spacing = 4;
      const colsAtSpacing = Math.floor((workW - rbb.width) / (rbb.width + spacing)) + 1;
      const rowsAtSpacing = Math.floor((workH - rbb.height) / (rbb.height + spacing)) + 1;
      console.log(`  @${angle}°: ${rbb.width.toFixed(2)}x${rbb.height.toFixed(2)} → max ${colsAtSpacing} cols × ${rowsAtSpacing} rows = ${colsAtSpacing * rowsAtSpacing} slots`);
    }
    console.log('');
  }
}

run().catch(console.error);
