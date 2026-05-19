import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size85 = shapes.find(s => s.sizeName === '8.5' || s.name === '8.5');
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const originalFill = engine._fillMarginHalves;
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    console.log(`--- Running _fillMarginHalves sizeName=${sizeName} ---`);
    const res = originalFill.call(this, sizeName, polygon, candidate, config, workWidth, workHeight);
    const placed = res.placements.filter(p => p.id?.startsWith('margin_fill_') || p.isSplit);
    console.log(`=== Placed margin pieces for size ${sizeName}: count=${placed.length} ===`);
    placed.forEach((p, idx) => {
      console.log(`  Margin ${idx}: id=${p.id}, foot=${p.foot}, angle=${p.orient?.angle}, splitOutwardSide=${p.orient?.splitOutwardSide}, x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}`);
    });
    return res;
  };

  const result = await engine.testCapacity([size85], config);
  const sheet = result.sheetsBySize['8.5'];
  console.log(`=== Final placed pieces list: total=${sheet.placed.length} ===`);
  sheet.placed.forEach((p, idx) => {
    if (p.id?.includes('split') || p.isSplit || p.id?.startsWith('margin_fill_')) {
      const xs = p.polygon.map(pt => pt.x);
      const ys = p.polygon.map(pt => pt.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      console.log(`  Split Placement ${idx}: id=${p.id}, foot=${p.foot}, angle=${p.angle}, x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}, worldMinX=${minX.toFixed(2)}, worldMaxX=${maxX.toFixed(2)}, worldMinY=${minY.toFixed(2)}, worldMaxY=${maxY.toFixed(2)}, width=${(maxX - minX).toFixed(2)}`);
    }
  });
}

run().catch(console.error);
