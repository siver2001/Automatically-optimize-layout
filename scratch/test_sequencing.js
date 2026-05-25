import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { normalizeDieCutExportData } from '../server/utils/diecutExportUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
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
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).filter(shape => shape.sizeName === '7');

  if (testSizes.length === 0) {
    console.error("Size 7 not found!");
    process.exit(1);
  }

  console.log(`Running single test for Size 7...`);
  const res = await engine.testCapacity(testSizes, config);
  
  console.log("\n=== Nesting complete. Normalizing export data... ===");
  const sheet = res.sheetsBySize['7'];
  if (!sheet) {
    console.error("No sheet found for Size 7");
    process.exit(1);
  }

  // Construct payload for normalizeDieCutExportData
  const payload = {
    sheets: [{
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placed: sheet.placed || sheet.placements
    }],
    sheetWidth: config.sheetWidth,
    sheetHeight: config.sheetHeight,
    sizeList: testSizes,
    labelMode: 'prepared-sequence',
    title: 'ASICS Test'
  };

  const normalized = normalizeDieCutExportData(payload);
  const normalizedSheet = normalized.sheets[0];
  const placed = normalizedSheet.placed;

  console.log(`\nTotal placed items: ${placed.length}`);
  
  // Sort placed items by their N value so we can check if they are consecutive and snake properly
  const sortedByN = [...placed].sort((a, b) => {
    const aN = parseInt(a.label.replace('N=', ''), 10);
    const bN = parseInt(b.label.replace('N=', ''), 10);
    return aN - bN;
  });

  console.log("\n=== PLACEMENTS IN ORDER OF SEQUENCE LABEL (N) ===");
  for (const p of sortedByN) {
    const isSplit = p.id.includes('split') || p.id.startsWith('margin_fill_');
    console.log(`Label: ${p.label} | ID: ${p.id.padEnd(20)} | Centroid X: ${p.centroid.x.toFixed(1)}, Y: ${p.centroid.y.toFixed(1)} | isSplit: ${isSplit}`);
  }
}

run().catch(console.error);
