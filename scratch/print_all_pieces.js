import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox, translate, polygonsOverlap } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size85 = shapes.find(s => s.sizeName === '8.5' || s.name === '8.5');
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // We run the engine to get the best candidate before margin filling
  const result = await engine.testCapacity([size85], config);
  const sheet = result.sheetsBySize['8.5'];
  
  // Let's find the split-right orient definition
  const sourceShape = engine._doubleContourSourceBySize?.get('8.5') || size85;
  const { buildSplitHalfDefinitions } = await import('../server/algorithms/diecut/strategies/capacity/splittingUtils.js');
  const halfDefs = buildSplitHalfDefinitions(sourceShape.polygon, sourceShape.internals?.[0] || []);
  const splitDef = halfDefs.find(h => h.key === 'split-right');
  const splitOrient = engine._decorateSplitHalfOrient('8.5', splitDef, 180, config, 0.25);
  
  // Let's filter out the split pieces placed in the margin to get the base placements
  const basePlacements = sheet.placed.filter(p => !p.id.includes('split') && !p.id.includes('margin_fill'));
  
  console.log(`Base placements count: ${basePlacements.length}`);
  
  // Now let's test collision for splitOrient at y = 1659.18 and different X values going leftwards from 945.18
  const testY = 1659.18;
  const spacing = config.spacing || 0;
  
  console.log(`\nTesting collisions for splitOrient at y = ${testY}:`);
  for (let x = 945.18; x >= 500; x -= 5) {
    let collisionDetected = false;
    let collidedWith = null;
    
    for (const bp of basePlacements) {
      const isOverlap = polygonsOverlap(
        splitOrient.polygon,
        bp.polygon,
        { x, y: testY },
        { x: 0, y: 0 },
        spacing
      );
      
      if (isOverlap) {
        collisionDetected = true;
        collidedWith = bp;
        break;
      }
    }
    
    if (collisionDetected) {
      console.log(`  x = ${x.toFixed(2)}: COLLISION with ${collidedWith.id} at worldX=${collidedWith.x.toFixed(2)}, worldY=${collidedWith.y.toFixed(2)}`);
      break;
    } else {
      console.log(`  x = ${x.toFixed(2)}: Safe`);
    }
  }
}

run().catch(console.error);
