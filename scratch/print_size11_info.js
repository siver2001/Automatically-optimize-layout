import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';


async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size11 = shapes.find(shape => (shape.sizeName || shape.name) === '11');

  if (!size11) {
    console.error("Size 11 not found!");
    process.exit(1);
  }

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
  
  // Initialize source shapes
  await engine.testCapacity([size11], config);

  const sourceShape = engine._doubleContourSourceBySize?.get('11');
  console.log("Source Shape keys:");
  console.log("Width:", sourceShape?.width, "Height:", sourceShape?.height);

  const step = 0.25;
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  
  console.log(`\n--- SPLIT HALF VARIANTS ---`);
  const angles = [0, 90, 180, 270];
  for (const angle of angles) {
    for (const halfDef of halfDefs) {
      const orient = engine._decorateSplitHalfOrient('11', halfDef, angle, config, step);
      console.log(`Angle: ${angle} | Side: ${orient.splitOutwardSide} | BB: [${orient.bb.minX.toFixed(1)}, ${orient.bb.maxX.toFixed(1)}, ${orient.bb.minY.toFixed(1)}, ${orient.bb.maxY.toFixed(1)}] | Width: ${(orient.bb.maxX - orient.bb.minX).toFixed(1)} | Height: ${(orient.bb.maxY - orient.bb.minY).toFixed(1)}`);
    }
  }
}

run().catch(console.error);
