import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  console.log(`Total shapes: ${shapes.length}`);
  const size5Shapes = shapes.filter(shape => String(shape.sizeName || shape.name) === '5');
  console.log(`Size 5 shapes count: ${size5Shapes.length}`);
  size5Shapes.forEach((shape, idx) => {
    console.log(`Shape [${idx}]: name=${shape.name} | sizeName=${shape.sizeName} | foot=${shape.foot} | type=${shape.type}`);
  });
}

run().catch(console.error);
