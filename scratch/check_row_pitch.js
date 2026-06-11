import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  const size4_5 = shapes.find(s => s.sizeName === '4.5');

  const runConfig = async (width, height) => {
    const config = {
      sheetWidth: width,
      sheetHeight: height,
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
    const res = await engine.testCapacity([size4_5], config);
    console.log(`\n=== Sheet Size: ${width}x${height} ===`);
    console.log(`Pairs: ${res.summary[0].pairs}`);
    const sheet = res.sheetsBySize['4.5'];
    if (sheet && sheet.placed) {
      console.log(`Placements count: ${sheet.placed.length}`);
      const bodyPlacements = sheet.placed.filter(p => !p.id.startsWith('split_fill_'));
      const splitPlacements = sheet.placed.filter(p => p.id.startsWith('split_fill_'));
      console.log(`Body placements: ${bodyPlacements.length}`);
      console.log(`Split placements: ${splitPlacements.length}`);
      
      // Group body placements by row (by grouping Y coordinates within 1mm)
      const rows = {};
      for (const p of bodyPlacements) {
        const y = p.y;
        let found = false;
        for (const ry of Object.keys(rows)) {
          if (Math.abs(Number(ry) - y) < 1.0) {
            rows[ry].push(p);
            found = true;
            break;
          }
        }
        if (!found) {
          rows[y] = [p];
        }
      }
      
      const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
      console.log('Row Y coordinates and number of items per row:');
      sortedY.forEach((y, i) => {
        console.log(`  Row ${i + 1}: Y = ${y.toFixed(3)} | items: ${rows[y].length}`);
      });
    }
  };

  await runConfig(1070, 1970);
  await runConfig(1080, 1980);
}

run().catch(console.error);
