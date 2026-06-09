import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  clearCapacityResultCache();
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const targetSize = shapes.find(shape => (shape.sizeName || shape.name) === '9');
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
  const res = await engine.testCapacity([targetSize], config);
  const placements = res.sheetsBySize['9'].placed;

  const itemA = placements.find(p => p.id === '9_X_41');
  const itemB = placements.find(p => p.id === '9_split-left_48');

  if (itemA && itemB) {
    const bbA = getBoundingBox(itemA.polygon);
    const bbB = getBoundingBox(itemB.polygon);
    console.log(`9_X_41 bounding box: minX=${bbA.minX.toFixed(2)}, maxX=${bbA.maxX.toFixed(2)}, minY=${bbA.minY.toFixed(2)}, maxY=${bbA.maxY.toFixed(2)}`);
    console.log(`9_split-left_48 bounding box: minX=${bbB.minX.toFixed(2)}, maxX=${bbB.maxX.toFixed(2)}, minY=${bbB.minY.toFixed(2)}, maxY=${bbB.maxY.toFixed(2)}`);
    
    // Check Cyc bounding box of split
    const bbCycB = getBoundingBox(itemB.cycPolygon || []);
    console.log(`9_split-left_48 CYC bounding box: minX=${bbCycB.minX.toFixed(2)}, maxX=${bbCycB.maxX.toFixed(2)}, minY=${bbCycB.minY.toFixed(2)}, maxY=${bbCycB.maxY.toFixed(2)}`);
  } else {
    console.log("Could not find items");
  }
}

run().catch(console.error);
