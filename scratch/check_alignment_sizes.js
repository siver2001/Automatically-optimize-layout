import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

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
  
  const targetSizes = ['3.5', '9.5'];
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => targetSizes.includes(shape.sizeName));

  for (const size of testSizes) {
    console.log(`\n=================== SIZE ${size.sizeName} ===================`);
    const res = await engine.testCapacity([size], config);
    const sheet = res.sheetsBySize[size.sizeName];
    const placements = sheet ? sheet.placed : [];
    
    console.log("All placements:");
    for (const p of placements) {
      const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || p.polygon || []);
      const isSplit = p.id.includes('split') || p.id.includes('margin_fill');
      const angle = p.orient?.angle ?? p.angle ?? 0;
      const width = bb.width ?? (bb.maxX - bb.minX);
      const height = bb.height ?? (bb.maxY - bb.minY);
      
      console.log(` - ID: ${p.id.padEnd(25)} | x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} | angle: ${Number(angle).toFixed(1)} | size: [${width.toFixed(1)} x ${height.toFixed(1)}] | bounds: [${(p.x + bb.minX).toFixed(1)} to ${(p.x + bb.maxX).toFixed(1)}, ${(p.y + bb.minY).toFixed(1)} to ${(p.y + bb.maxY).toFixed(1)}] | isSplit: ${isSplit}`);
    }
  }
}

run().catch(console.error);
