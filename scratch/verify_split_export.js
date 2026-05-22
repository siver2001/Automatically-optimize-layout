import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';

const samplePayloadWithSplit = {
  title: 'TEST-SPLIT-EXPORT',
  sheetWidth: 1789.4647,
  sheetHeight: 1027.5245,
  isLuxin: true,
  toolCodeMap: { '10.5Q': 7 },
  sizeList: [{ sizeName: '10.5Q' }],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      placed: [
        {
          id: 'placed_normal',
          sizeName: '10.5Q',
          x: 200,
          y: 150,
          centroid: { x: 200, y: 150 },
          // Whole polygon (box)
          polygon: [{ x: 190, y: 140 }, { x: 210, y: 140 }, { x: 210, y: 160 }, { x: 190, y: 160 }],
          label: 'N=1'
        },
        {
          id: 'split_fill_1',
          sizeName: '10.5Q',
          foot: 'split-left',
          x: 300,
          y: 250,
          centroid: { x: 300, y: 250 },
          // Half polygon
          polygon: [{ x: 290, y: 240 }, { x: 300, y: 240 }, { x: 300, y: 260 }, { x: 290, y: 260 }],
          // Whole polygon (saved in cycPolygon)
          cycPolygon: [{ x: 290, y: 240 }, { x: 310, y: 240 }, { x: 310, y: 260 }, { x: 290, y: 260 }],
          label: 'N=2'
        }
      ]
    }
  ]
};

console.log('--- STARTING SPLIT EXPORT TEST ---');

// Generate DXF
const dxfContent = generateDieCutDxf(samplePayloadWithSplit);
const dxfLines = dxfContent.split(/\r?\n/);

// Parse DXF to find polylines and their vertex counts
const polylines = [];
let currentPolyline = null;

for (let i = 0; i < dxfLines.length - 1; i += 2) {
  const code = parseInt(dxfLines[i].trim(), 10);
  const val = dxfLines[i+1]?.trim();
  
  if (code === 0) {
    if (val === 'POLYLINE') {
      if (currentPolyline) polylines.push(currentPolyline);
      currentPolyline = { type: 'POLYLINE', vertices: [] };
    } else if (val === 'VERTEX' && currentPolyline) {
      let j = i + 2;
      let x = 0, y = 0;
      while (j < dxfLines.length - 1) {
        const subCode = parseInt(dxfLines[j].trim(), 10);
        const subVal = dxfLines[j+1]?.trim();
        if (subCode === 0) break;
        if (subCode === 10) x = parseFloat(subVal);
        if (subCode === 20) y = parseFloat(subVal);
        j += 2;
      }
      currentPolyline.vertices.push({ x, y });
    }
  }
}
if (currentPolyline) polylines.push(currentPolyline);

console.log(`Parsed ${polylines.length} polylines from DXF.`);

// polylines[0] is the border.
// polylines[1] is the normal item (placed_normal).
// polylines[2] is the split item (split_fill_1).

const borderPl = polylines[0];
const normalPl = polylines[1];
const splitPl = polylines[2];

console.log('Normal Polyline vertices:', normalPl.vertices);
console.log('Split Polyline vertices (expected to be WHOLE polygon matching cycPolygon):', splitPl.vertices);

let success = true;

// Verify normal polyline (should have 5 vertices including closed vertex)
if (normalPl.vertices.length !== 5) {
  console.error(`❌ FAILED: Normal polyline should have 5 vertices (4 original + 1 repeat), got ${normalPl.vertices.length}`);
  success = false;
} else {
  console.log('✔ PASSED: Normal polyline has 5 vertices (including closed vertex).');
}

// Verify split polyline (should use cycPolygon: 4 vertices, repeated to 5)
// If it used polygon (half shape), the X coordinates would only go up to 300.
// If it used cycPolygon (whole shape), the X coordinates go up to 310.
const maxSplitX = Math.max(...splitPl.vertices.map(v => v.x));
console.log(`Max X coordinate of split polyline: ${maxSplitX}`);

if (maxSplitX === 310) {
  console.log('✔ PASSED: Split polyline correctly exported as the WHOLE shape (max X = 310) from cycPolygon!');
} else if (maxSplitX === 300) {
  console.error('❌ FAILED: Split polyline was exported as the HALF shape (max X = 300) from polygon!');
  success = false;
} else {
  console.error(`❌ FAILED: Unexpected max X = ${maxSplitX}`);
  success = false;
}

if (success) {
  console.log('\n🏆 ALL SPLIT EXPORT TESTS PASSED PERFECTLY!');
  process.exit(0);
} else {
  console.log('\n❌ TEST FAILED!');
  process.exit(1);
}
