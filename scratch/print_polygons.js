import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, normalizeToOrigin } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

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
    doubleContourDeepSearch: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7.5');

  const res = await engine.testCapacity(testSizes, config);
  
  console.log(`Engine split halves inside map:`);
  const source = engine._doubleContourSourceBySize.get('7.5');
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const halfDefs = buildSplitHalfDefinitions(source.polygon, testSizes[0].internals?.[0] || []);
  for (const hd of halfDefs) {
    const bb = getBoundingBox(normalizeToOrigin(hd.polygon));
    console.log(` - Half ${hd.key}: Width: ${bb.width.toFixed(2)}, Height: ${bb.height.toFixed(2)}`);
  }
  const sheet = res.sheetsBySize['7.5'];
  const placements = sheet.placed;
  
  const actualSplit = placements.find(p => p.id === '7.5_split-right_49');
  const actualWhole = placements.find(p => p.id === '7.5_X_43');
  
  console.log(`Actual split:`, actualSplit.id, `x:`, actualSplit.x, `y:`, actualSplit.y, `angle:`, actualSplit.angle);
  console.log(`Actual whole:`, actualWhole.id, `x:`, actualWhole.x, `y:`, actualWhole.y, `angle:`, actualWhole.angle);
  
  const bbS = getBoundingBox(actualSplit.polygon);
  const bbW = getBoundingBox(actualWhole.polygon);
  
  console.log(`Actual Split BB:`, [bbS.minX, bbS.maxX, bbS.minY, bbS.maxY]);
  console.log(`Actual Whole BB:`, [bbW.minX, bbW.maxX, bbW.minY, bbW.maxY]);
  
  const overlap = cachedPolygonsOverlap(
    actualWhole.polygon,
    actualSplit.polygon,
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    config.spacing,
    bbW,
    bbS
  );
  console.log(`Manual overlap check between actual whole and actual split:`, overlap);
}

run().catch(console.error);
