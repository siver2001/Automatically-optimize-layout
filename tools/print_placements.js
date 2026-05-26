import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true, // Turn ON margin filling to see placements
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '11');

  console.log(`Running initial placements check for Size 11...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== DEBUG RESULT ===");
  console.log(`testSizes length: ${testSizes.length}`);
  console.log(`res keys: ${Object.keys(res || {})}`);
  if (res && res.sheetsBySize) {
    console.log(`sheetsBySize keys: ${Object.keys(res.sheetsBySize)}`);
  }
  
  console.log("\n=== PLACEMENTS LIST WITH SEQUENCE LABELS ===");
  const sheet = res.sheetsBySize && res.sheetsBySize['11'];
  if (sheet && sheet.placed) {
    // Simulate what the export does
    Promise.all([
      import('../server/utils/diecutExportUtils.js'),
      import('../server/utils/diecutCycGenerator.js')
    ]).then(([{ normalizeDieCutExportData }, { generateDieCutCyc }]) => {
      const payload = {
        sheets: [sheet],
        sheetWidth: config.sheetWidth,
        sheetHeight: config.sheetHeight,
        labelMode: 'prepared-sequence',
        title: 'ASICS Test',
        toolCodeMap: { '11': '12' } // Tool Code 12 for Size 11
      };
      
      const normalized = normalizeDieCutExportData(payload);
      const placedWithLabels = normalized.sheets[0].placed;
      console.log(`Total normalized: ${placedWithLabels.length}`);
      
      // Let's also sort them by the N value to see the traversal order!
      const parseN = (lbl) => {
        const m = String(lbl || '').match(/\bN=(\d+)\b/);
        return m ? parseInt(m[1], 10) : 999;
      };
      
      const sortedByN = [...placedWithLabels].sort((a, b) => parseN(a.label) - parseN(b.label));
      
      console.log("\n--- DXF Placements (Y Inverted to match screen) ---");
      for (const p of sortedByN) {
        const dxfY = normalized.sheets[0].sheetHeight - p.centroid.y;
        console.log(` - ${p.label} | ID: ${p.id} | SVG Centroid Y: ${p.centroid.y.toFixed(1)} | DXF Centroid Y: ${dxfY.toFixed(1)} | x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)}`);
      }
      
      console.log("\n--- CYC File Generation check ---");
      const cyc = generateDieCutCyc(payload);
      console.log("CYC File contains the following entries:");
      const cycLines = cyc.split('\r\n').filter(l => l.includes('<Cycle ') || l.includes('Field '));
      // Print first few cycle entries
      console.log(cycLines.slice(0, 14).join('\n'));
      console.log("...");
      console.log(cycLines.slice(-14).join('\n'));
    });
  }
}

run().catch(console.error);
