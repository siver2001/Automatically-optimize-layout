import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size125 = shapes.find(s => s.sizeName === '12.5');

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const step = 0.25;
  const orientVariants = [];
  for (const angle of engine._getSplitFillAngles(config)) {
    const halfDefs = buildSplitHalfDefinitions(
      size125.polygon,
      size125.internals?.[0] || []
    );
    for (const halfDef of halfDefs) {
      orientVariants.push(engine._decorateSplitHalfOrient('12.5', halfDef, angle, config, step));
    }
  }

  console.log(`=== Split variants for size 12.5 ===`);
  orientVariants.forEach((v, idx) => {
    console.log(`Variant ${idx}: angle=${v.angle}, splitOutwardSide=${v.splitOutwardSide}, width=${v.width.toFixed(2)}, height=${v.height.toFixed(2)}, area=${v.areaMm2.toFixed(2)}`);
  });
}
run();
