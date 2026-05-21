import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    allowRotate90: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '4');

  const size = testSizes[0];
  const halfDefs = buildSplitHalfDefinitions(size.polygon, size.internals?.[0] || []);
  
  console.log("Half definitions count:", halfDefs.length);
  for (const halfDef of halfDefs) {
    console.log(`\nHalfDef key: ${halfDef.key}`);
    const angles = [0, 90, 180, 270];
    for (const angle of angles) {
      const orient = engine._decorateSplitHalfOrient('4', halfDef, angle, config, 0.5);
      console.log(`Angle: ${angle} | Width: ${orient.width.toFixed(2)} | Height: ${orient.height.toFixed(2)} | bb: minX=${orient.bb.minX.toFixed(2)}, maxX=${orient.bb.maxX.toFixed(2)}, minY=${orient.bb.minY.toFixed(2)}, maxY=${orient.bb.maxY.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
