import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

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
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const targetShape = shapes.find(s => String(s.sizeName || s.name) === '5');
  
  if (!targetShape) {
    console.error('Size 5 shape not found!');
    process.exit(1);
  }

  console.log('Running capacity test for Size 5...');
  const res = await engine.testCapacity([targetShape], config);
  const sheet = res.sheetsBySize['5'];
  if (!sheet) {
    console.error('No sheet generated for Size 5');
    process.exit(1);
  }

  const toolCodeMap = { '5': '50' };

  const dxfContent = generateDieCutDxf({
    sheets: [sheet],
    sheetWidth: config.sheetWidth,
    sheetHeight: config.sheetHeight,
    sizeList: [{ sizeName: '5', sizeValue: 5 }],
    toolCodeMap,
    title: 'Test DXF Size 5'
  });

  const cycContent = generateDieCutCyc({
    sheets: [sheet],
    sheetWidth: config.sheetWidth,
    sheetHeight: config.sheetHeight,
    sizeList: [{ sizeName: '5', sizeValue: 5 }],
    toolCodeMap,
    title: 'Test CYC Size 5'
  });

  console.log('\n--- VERIFYING DXF TEXT ENTITIES ---');
  const dxfTextEntities = [];
  const lines = dxfContent.split('\n');
  let currentGroupCode = null;
  let textValue = null;
  let textX = null;
  let textY = null;
  let inText = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'TEXT') {
      inText = true;
      textValue = null;
      textX = null;
      textY = null;
    } else if (inText && line === '0') {
      if (textValue && textValue.startsWith('N=')) {
        dxfTextEntities.push({ label: textValue, x: textX, y: textY });
      }
      inText = false;
    } else if (inText) {
      const groupCode = line;
      const value = lines[++i].trim();
      if (groupCode === '1') {
        textValue = value;
      } else if (groupCode === '10') {
        textX = parseFloat(value);
      } else if (groupCode === '20') {
        textY = parseFloat(value);
      }
    }
  }

  // Sort dxfTextEntities by Y descending (rotated coords bottom to top)
  const dxfRows = [];
  const Y_THRESHOLD = 75.0;
  const sortedDxfText = [...dxfTextEntities].sort((a, b) => b.y - a.y);
  
  for (const t of sortedDxfText) {
    if (dxfRows.length === 0) {
      dxfRows.push([t]);
    } else {
      const lastRow = dxfRows[dxfRows.length - 1];
      const avgY = lastRow.reduce((sum, k) => sum + k.y, 0) / lastRow.length;
      if (Math.abs(t.y - avgY) < Y_THRESHOLD) {
        lastRow.push(t);
      } else {
        dxfRows.push([t]);
      }
    }
  }

  console.log(`Grouped DXF Rows: ${dxfRows.length}`);
  dxfRows.forEach((row, idx) => {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    console.log(`DXF Row ${idx + 1}:`);
    for (const t of sortedRow) {
      console.log(`  X: ${t.x.toFixed(1)} | Y: ${t.y.toFixed(1)} | Label: ${t.label}`);
    }
  });

  console.log('\n--- VERIFYING CYC XML ENTITIES ---');
  const cycCycles = [];
  const cycMatches = [...cycContent.matchAll(/<Cycle Name="DXFData">[\s\S]*?<Field Name="X" Value="([^"]+)"\/>[\s\S]*?<Field Name="Y" Value="([^"]+)"\/>[\s\S]*?<Field Name="N" Value="([^"]+)"\/>[\s\S]*?<\/Cycle>/g)];
  
  for (const match of cycMatches) {
    cycCycles.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      n: parseInt(match[3])
    });
  }

  const cycRows = [];
  const sortedCycText = [...cycCycles].sort((a, b) => b.y - a.y);
  for (const c of sortedCycText) {
    if (cycRows.length === 0) {
      cycRows.push([c]);
    } else {
      const lastRow = cycRows[cycRows.length - 1];
      const avgY = lastRow.reduce((sum, k) => sum + k.y, 0) / lastRow.length;
      if (Math.abs(c.y - avgY) < Y_THRESHOLD) {
        lastRow.push(c);
      } else {
        cycRows.push([c]);
      }
    }
  }

  console.log(`Grouped CYC Rows: ${cycRows.length}`);
  cycRows.forEach((row, idx) => {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    console.log(`CYC Row ${idx + 1}:`);
    for (const c of sortedRow) {
      console.log(`  X: ${c.x.toFixed(1)} | Y: ${c.y.toFixed(1)} | N: ${c.n}`);
    }
  });
}

run().catch(console.error);
