import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
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
  const shape8_5 = shapes.find(s => (s.sizeName || s.name) === '8.5');
  
  const res = await engine.testCapacity([{
    ...shape8_5,
    sizeName: '8.5'
  }], config);

  const sheet = res.sheet;
  console.log("\n=== SIZE 8.5 PLACEMENTS WITH REAL WORLD BOUNDS ===");
  
  const sortedPlaced = [...sheet.placed].sort((a, b) => a.y - b.y || a.x - b.x);
  
  for (const item of sortedPlaced) {
    // Get polygon of this placement to compute its true bounding box
    const poly = item.polygon || item.orient?.polygon || [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    
    const isSplit = item.id.startsWith('margin_fill_') || item.id.startsWith('split_') || item.isSplit || item.foot?.startsWith('split-') || item.id.includes('split');
    const typeLabel = isSplit ? "SPLIT" : "WHOLE";
    
    console.log(`[${typeLabel}] ID: ${item.id.padEnd(30)} | Center: [${((minX+maxX)/2).toFixed(1)}, ${((minY+maxY)/2).toFixed(1)}] | Bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);
  }
}

run().catch(console.error);
