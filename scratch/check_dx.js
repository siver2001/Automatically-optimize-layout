import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getWholePlacementCount } from '../server/algorithms/diecut/strategies/capacity/double-contour/utils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size4_5 = shapes.find(s => s.sizeName === '4.5');
  const polygon = size4_5.polygon;

  const config = {
    sheetWidth: 1080,
    sheetHeight: 1980,
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
  const step = 0.5;
  const orient = engine._decorateOrient('4.5', 'X', polygon, 0, config, step);
  const pairedOrient = {
    ...engine._decorateOrient('4.5', 'X', polygon, 0, config, step),
    isAlternate: false
  };

  const dxMm = engine._findAlignedBodyDx(orient, pairedOrient, config, step);
  console.log(`orient.width: ${orient.width}`);
  console.log(`dxMm: ${dxMm}`);

  const maxCols1060 = engine._countCols(orient.width, dxMm, 1060);
  const maxCols1070 = engine._countCols(orient.width, dxMm, 1070);
  console.log(`maxCols for 1060: ${maxCols1060}`);
  console.log(`maxCols for 1070: ${maxCols1070}`);

  // Test dxCandidates for 1070
  const dxCandidates = [dxMm];
  const maxCols = maxCols1070;
  const widthsToTest = [1070]; // if workWidth is 1070
  for (const w of [1060, 1070]) {
    if (!widthsToTest.includes(w)) {
      widthsToTest.push(w);
    }
  }

  for (const w of widthsToTest) {
    for (const extra of [1, 2, 3, 4, 5]) {
      const targetCols = maxCols + extra;
      const requiredDx = (w - 1) / targetCols;
      if (requiredDx > orient.width * 0.55 && requiredDx < dxMm) {
        dxCandidates.push(requiredDx);
      }
    }
  }
  console.log('dxCandidates:', dxCandidates);
}

run().catch(console.error);
