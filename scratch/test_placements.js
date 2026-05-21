import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size7 = shapes.find(shape => (shape.sizeName || shape.name) === '7');

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
  await engine.testCapacity([size7], config);

  const sourceShape = engine._doubleContourSourceBySize?.get('7') || size7;
  const polygon = sourceShape.polygon;

  const testSizes = [{ ...size7, sizeName: '7' }];
  const configNoSplits = { ...config, preparedSplitFillEnabled: false };
  const resNoSplits = await engine.testCapacity(testSizes, configNoSplits);
  const sheet = resNoSplits.sheetsBySize['7'];
  const wholePlacements = sheet.placed.map(p => {
    return {
      id: p.id,
      x: p.x - config.marginX,
      y: p.y - config.marginY,
      angle: p.angle,
      orient: engine._decorateOrient('7', p.foot, polygon, p.angle, config, 0.5)
    };
  });

  console.log(`Whole placements loaded: ${wholePlacements.length}`);

  const realHalfDefs = buildSplitHalfDefinitions(polygon, sourceShape.internals?.[0] || []);
  console.log(`Real half defs built: ${realHalfDefs.length}`);
  realHalfDefs.forEach(h => console.log(`  key: ${h.key}`));
  const leftDef = realHalfDefs.find(h => h.key === 'split-left' || h.key?.includes('left'));
  const rightDef = realHalfDefs.find(h => h.key === 'split-right' || h.key?.includes('right'));

  const leftOrient90 = engine._decorateSplitHalfOrient('7', leftDef, 90, config, 0.5);
  const rightOrient90 = engine._decorateSplitHalfOrient('7', rightDef, 90, config, 0.5);
  const leftOrient270 = engine._decorateSplitHalfOrient('7', leftDef, 270, config, 0.5);
  const rightOrient270 = engine._decorateSplitHalfOrient('7', rightDef, 270, config, 0.5);

  // We want to test placing them under the 4 columns
  // X columns of whole pieces: 5.00, 268.77, 532.54, 796.30 (in local coords: 0.00, 263.77, 527.54, 791.30)
  // Let's test different positions
  for (let testY = 1810; testY <= 1845; testY += 5) {
    const testSplits = [
      { id: 'test_split_0', x: 0.00, y: testY, orient: leftOrient90 },
      { id: 'test_split_1', x: 263.77, y: testY, orient: rightOrient90 },
      { id: 'test_split_2', x: 527.54, y: testY, orient: leftOrient90 },
      { id: 'test_split_3', x: 791.30, y: testY, orient: rightOrient90 }
    ];
    const validation = validateLocalPlacements([...wholePlacements, ...testSplits], config.spacing);
    console.log(`Y=${testY} | [left90, right90, left90, right90] | valid=${validation.valid}`);
    
    const testSplits2 = [
      { id: 'test_split_0', x: 0.00, y: testY, orient: leftOrient90 },
      { id: 'test_split_1', x: 263.77, y: testY, orient: leftOrient90 },
      { id: 'test_split_2', x: 527.54, y: testY, orient: leftOrient90 },
      { id: 'test_split_3', x: 791.30, y: testY, orient: leftOrient90 }
    ];
    const validation2 = validateLocalPlacements([...wholePlacements, ...testSplits2], config.spacing);
    console.log(`Y=${testY} | [left90, left90, left90, left90] | valid=${validation2.valid}`);

    const testSplits3 = [
      { id: 'test_split_0', x: 0.00, y: testY, orient: leftOrient90 },
      { id: 'test_split_1', x: 263.77, y: testY + 5, orient: leftOrient90 },
      { id: 'test_split_2', x: 527.54, y: testY, orient: leftOrient90 },
      { id: 'test_split_3', x: 791.30, y: testY + 5, orient: leftOrient90 }
    ];
    const validation3 = validateLocalPlacements([...wholePlacements, ...testSplits3], config.spacing);
    console.log(`Y=${testY} | [left90 staggered] | valid=${validation3.valid}`);
  }
}

run().catch(console.error);
