import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';
import { cachedPolygonsOverlap, validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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

  // We have 42 body placements from candidate.placements
  const bodyPlacements = candidate.placements.filter(p => !engine._isSplitFillPlacement(p));
  console.log("Body placements count:", bodyPlacements.length);

  // Now, let's define the 7 right-margin split pieces manually at their respective rows
  // all aligned to a single target X coordinate!
  // Let's test a few target sheet X coordinates (e.g. 1001.0, which is work X = 996.0)
  const sourceShape = engine._doubleContourSourceBySize.get('9.5');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const step = 0.05;
  const orientVariants = [];
  for (const angle of engine._getSplitFillAngles(config)) {
    for (const halfDef of halfDefs) {
      orientVariants.push(engine._decorateSplitHalfOrient('9.5', halfDef, angle, config, step));
    }
  }

  // Variant 0 is angle=0, splitOutwardSide=right
  const rightOrient = orientVariants.find(o => o.splitOutwardSide === 'right' && o.angle === 0);

  // The 7 rows on the sheet are at Y:
  // Row 1: y = 20.0 (work y = 0.0)
  // Row 2: y = 299.1 (work y = 279.1)
  // Row 3: y = 578.2 (work y = 558.2)
  // Row 4: y = 857.2 (work y = 837.2)
  // Row 5: y = 1136.3 (work y = 1116.3)
  // Row 6: y = 1415.4 (work y = 1395.4)
  // Row 7: y = 1694.5 (work y = 1674.5)
  const rowWorkYs = [0.0, 279.1, 558.2, 837.2, 1116.3, 1395.4, 1674.5];

  const targetXs = [996.0, 995.0, 994.0, 993.0, 992.0, 991.0, 990.0, 989.0, 988.0];

  for (const workX of targetXs) {
    const testPlacements = [...bodyPlacements];
    
    // Add all 7 split pieces at this X
    for (let r = 0; r < rowWorkYs.length; r++) {
      testPlacements.push({
        id: `test_split_row_${r}`,
        orient: rightOrient,
        x: workX,
        y: rowWorkYs[r]
      });
    }

    // Run overlap validation
    const val = validateLocalPlacements(testPlacements, config.spacing);
    console.log(`Testing alignment at work X = ${workX.toFixed(1)} (sheet X = ${(workX + 5).toFixed(1)}) | valid = ${val.valid}`);
    if (!val.valid) {
      console.log(`  Reason: ${val.reason} | Pair: ${val.pair ? val.pair.join(' <-> ') : 'none'}`);
    }
  }
}

run().catch(console.error);
