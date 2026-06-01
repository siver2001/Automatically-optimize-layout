import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const shape75 = shapes.find(s => (s.sizeName || s.name) === '7.5');
  
  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: false,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const orient90 = engine._decorateOrient('7.5', 'X', shape75.polygon, 90, config, 0.5);
  const orient270 = {
    ...engine._decorateOrient('7.5', 'X', shape75.polygon, 270, config, 0.5),
    isAlternate: true
  };
  
  const dx = engine._findAlignedBodyDx(orient90, orient270, config, 0.5);
  console.log(`Aligned Dx for angle 90 and alternate 270: ${dx ? dx.toFixed(2) : 'none'} mm`);
  
  if (dx) {
    const cols = Math.floor((1060 - Math.max(orient90.width, orient270.width)) / dx) + 1;
    console.log(`Max cols for aligned 90/270: ${cols}`);
  }
}

run().catch(console.error);
