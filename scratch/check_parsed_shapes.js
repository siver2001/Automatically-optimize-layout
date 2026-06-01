import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);

  console.log(`Returned ${shapes.length} shapes.`);
  for (const s of shapes) {
    console.log(`Size: ${s.sizeName} | Value: ${s.sizeValue} | Area = ${s.area} | Width = ${s.boundingBox.width}, Height = ${s.boundingBox.height} | Points = ${s.pointCount}`);
  }
}

run().catch(console.error);
