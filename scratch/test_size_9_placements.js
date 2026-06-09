import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    process.exit(1);
  }

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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  class TestEngine extends CapacityTestDoubleInsoleDoubleContourPattern {
    _resolveOverlapPlacements(placements, spacing) {
      console.log(`\n[_resolveOverlapPlacements] Running on ${placements.length} placements.`);
      
      // Look for the specific placements that will end up as idx 41 and 48
      // Let's find placement with id containing '41' (or near x=793) and 'margin_fill_right_6' (idx 48, near x=955)
      const p41 = placements.find(p => p.id === '9_X_41' || p.id?.includes('41') || (Math.abs(p.x - 793.8) < 5));
      const p48 = placements.find(p => p.id === 'margin_fill_right_6' || p.id?.includes('right_6') || (Math.abs(p.x - 955.68) < 5 && Math.abs(p.y - 1681.8) < 5));

      if (p41 && p48) {
        console.log('--- Found target placements in raw state! ---');
        console.log(`p41 (Whole): id=${p41.id}, x=${p41.x}, y=${p41.y}, foot=${p41.orient?.foot || p41.foot}`);
        console.log(`p48 (Split): id=${p48.id}, x=${p48.x}, y=${p48.y}, foot=${p48.orient?.foot || p48.foot}`);
        
        const bb41 = p41.orient?.bb || getBoundingBox(p41.orient?.polygon || []);
        const bb48 = p48.orient?.bb || getBoundingBox(p48.orient?.polygon || []);
        const bbCyc48 = p48.orient?.bbCyc || (p48.orient?.cycPolygon ? getBoundingBox(p48.orient.cycPolygon) : null);

        console.log(`p41 local bb: ${JSON.stringify(bb41)}`);
        console.log(`p48 local bb: ${JSON.stringify(bb48)}`);
        console.log(`p48 cyc local bb: ${JSON.stringify(bbCyc48)}`);

        // Test overlap check
        const overlap = cachedPolygonsOverlap(
          p48.orient.polygon,
          p41.orient.polygon,
          { x: p48.x, y: p48.y },
          { x: p41.x, y: p41.y },
          spacing,
          bb48,
          bb41
        );
        console.log(`Overlap Material-to-Material: ${overlap}`);

        if (p48.orient.cycPolygon) {
          const overlapCyc = cachedPolygonsOverlap(
            p48.orient.cycPolygon,
            p41.orient.polygon,
            { x: p48.x, y: p48.y },
            { x: p41.x, y: p41.y },
            spacing,
            bbCyc48,
            bb41
          );
          console.log(`Overlap Die-to-Material: ${overlapCyc}`);
        } else {
          console.log('Warning: p48.orient.cycPolygon is missing!');
        }
      } else {
        console.log(`Could not find target placements. p41: ${!!p41}, p48: ${!!p48}`);
        if (!p41) {
          // Print all placements near x=793 or y=1681
          placements.forEach(p => {
            if (Math.abs(p.x - 793) < 30 && Math.abs(p.y - 1681) < 30) {
              console.log(`  Close raw placement: id=${p.id}, x=${p.x}, y=${p.y}, foot=${p.orient?.foot}`);
            }
          });
        }
      }

      return super._resolveOverlapPlacements(placements, spacing);
    }
  }

  const engine = new TestEngine(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '9');

  await engine.testCapacity(testSizes, config);
}

run().catch(console.error);
