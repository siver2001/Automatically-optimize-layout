import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
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
  for (const sizeName of targetSizes) {
    const size = shapes.find(s => (s.sizeName || s.name) === sizeName);
    console.log(`\n=================== SIZE ${sizeName} ===================`);
    const res = await engine.testCapacity([size], config);
    const sheet = res.sheetsBySize[sizeName];
    const placements = sheet.placed;

    const workWidth = config.sheetWidth - 2 * config.marginX;
    const workHeight = config.sheetHeight - 2 * config.marginY;

    for (const p of placements) {
      if (!p.id.includes('split') && !p.id.includes('margin_fill')) continue;
      
      const bb = p.bb || getBoundingBox(p.polygon || []);
      const distLeft = p.x + bb.minX;
      const distRight = workWidth - (p.x + bb.maxX);
      const distTop = p.y + bb.minY;
      const distBottom = workHeight - (p.y + bb.maxY);
      
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      let group = 'unknown';
      if (minDist === distRight) group = 'right';
      else if (minDist === distBottom) group = 'bottom';
      else if (minDist === distTop) group = 'top';
      else group = 'left';

      console.log(`Split ID: ${p.id.padEnd(25)} | x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} | Dist: [L:${distLeft.toFixed(1)}, R:${distRight.toFixed(1)}, T:${distTop.toFixed(1)}, B:${distBottom.toFixed(1)}] | Classified Group: ${group}`);
    }
  }
}

run().catch(console.error);
