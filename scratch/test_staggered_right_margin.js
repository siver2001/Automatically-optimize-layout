import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size9_5 = shapes.find(shape => (shape.sizeName || shape.name) === '9.5');

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
  engine._doubleContourSourceBySize = new Map([
    ['9.5', { polygon: size9_5.polygon, internals: size9_5.internals || [] }]
  ]);

  const workWidth = config.sheetWidth - 2 * config.marginX;
  const workHeight = config.sheetHeight - 2 * config.marginY;
  const candidate = engine._evaluateFootCandidate('9.5', 'L', size9_5.polygon, config, workWidth, workHeight);

  // Filter out any split pieces to start with a clean body layout
  const bodyPlacements = candidate.placements.filter(p => !engine._isSplitFillPlacement(p));
  console.log("Body placements count:", bodyPlacements.length);

  const sourceShape = engine._doubleContourSourceBySize.get('9.5');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const step = 0.05;
  const orientVariants = [];
  for (const angle of engine._getSplitFillAngles(config)) {
    for (const halfDef of halfDefs) {
      orientVariants.push(engine._decorateSplitHalfOrient('9.5', halfDef, angle, config, step));
    }
  }

  // Right-margin split definitions:
  // Odd rows (1, 3, 5, 7) - indices 0, 2, 4, 6
  // Even rows (2, 4, 6) - indices 1, 3, 5
  const rightOrient = orientVariants.find(o => o.splitOutwardSide === 'right' && o.angle === 0);
  const rightOrient180 = orientVariants.find(o => o.splitOutwardSide === 'right' && o.angle === 180);

  const rowWorkYs = [0.0, 279.1, 558.2, 837.2, 1116.3, 1395.4, 1674.5];

  const testPlacements = [...bodyPlacements];

  for (let r = 0; r < rowWorkYs.length; r++) {
    // Stagger X coordinates: Even rows at 996.0, Odd rows at 965.0
    // Row 7 (index 6) can be at angle 180 (like in the real candidate) or angle 0. Let's try angle 0 first.
    const isEvenRow = (r % 2 === 1); // 0-indexed: index 1 is Row 2, index 3 is Row 4, index 5 is Row 6
    const workX = isEvenRow ? 996.0 : 965.0;
    
    // For the last row, let's use the 180 degree variant if it was originally 180, or just try rightOrient.
    const orient = (r === 6 && rightOrient180) ? rightOrient180 : rightOrient;
    // If it's the 180 variant, its width might be different so its X coordinate might be slightly different.
    // Originally, split_fill_0 was at work X = 970.0 (sheet X = 975.0)
    const finalX = (r === 6 && orient === rightOrient180) ? 970.0 : workX;

    testPlacements.push({
      id: `test_split_row_${r}`,
      orient,
      x: finalX,
      y: rowWorkYs[r]
    });
  }

  const val = validateLocalPlacements(testPlacements, config.spacing);
  console.log(`Staggered Right Margin Test | valid = ${val.valid}`);
  if (!val.valid) {
    console.log(`  Reason: ${val.reason} | Pair: ${val.pair ? val.pair.join(' <-> ') : 'none'}`);
  } else {
    console.log("Success! Staggered column fits all 7 right-margin split pieces beautifully!");
  }
}

run().catch(console.error);
