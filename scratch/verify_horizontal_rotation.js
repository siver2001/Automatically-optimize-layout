import { normalizeDieCutExportData } from '../server/utils/diecutExportUtils.js';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

console.log('=== RUNNING AUTOMATED VERIFICATION OF HORIZONTAL ROTATION ===');

// Mock payload representing a vertical (portrait) sheet: 1000mm width x 2000mm height
const mockPayload = {
  title: 'Vertical Nesting Test',
  sheetWidth: 1000,
  sheetHeight: 2000,
  isLuxin: true,
  toolCodeMap: { '10Q': '15' },
  sizeList: [{ sizeName: '10Q' }],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1000,
      sheetHeight: 2000,
      placed: [
        {
          id: 'item_1',
          sizeName: '10Q',
          x: 100,
          y: 200,
          angle: 45,
          polygon: [
            { x: 100, y: 200 },
            { x: 200, y: 200 },
            { x: 200, y: 400 },
            { x: 100, y: 400 }
          ],
          cycPolygon: [
            { x: 100, y: 200 },
            { x: 200, y: 200 },
            { x: 200, y: 400 },
            { x: 100, y: 400 }
          ],
          internals: [
            [
              { x: 120, y: 220 },
              { x: 180, y: 220 }
            ]
          ]
        }
      ]
    }
  ]
};

// 1. Run normalization
const exportData = normalizeDieCutExportData(mockPayload);
const sheet = exportData.sheets[0];

console.log('\n--- Sheet Dimensions ---');
console.log(`Original: Width = ${mockPayload.sheetWidth}, Height = ${mockPayload.sheetHeight}`);
console.log(`Normalized: Width = ${sheet.sheetWidth}, Height = ${sheet.sheetHeight}`);

if (sheet.sheetWidth === 2000 && sheet.sheetHeight === 1000) {
  console.log('✅ PASS: Sheet dimensions swapped successfully!');
} else {
  console.log('❌ FAIL: Sheet dimensions not swapped!');
  process.exit(1);
}

const item = sheet.placed[0];

console.log('\n--- Item Orientation & Placements ---');
console.log(`Original placement: x = 100, y = 200, angle = 45`);
console.log(`Rotated placement: x = ${item.x}, y = ${item.y}, angle = ${item.angle}`);

// Under 90 CW rotation:
// x_new = y_old = 200
// y_new = W_old - x_old = 1000 - 100 = 900
// angle_new = (45 - 90 + 360) % 360 = 315
if (item.x === 200 && item.y === 900 && item.angle === 315) {
  console.log('✅ PASS: Placement coordinates and angle rotated successfully!');
} else {
  console.log(`❌ FAIL: Placement rotation mismatch! Expected x=200, y=900, angle=315, got x=${item.x}, y=${item.y}, angle=${item.angle}`);
  process.exit(1);
}

console.log('\n--- Polygon Points ---');
console.log('Original Polygon:', mockPayload.sheets[0].placed[0].polygon);
console.log('Rotated Polygon:', item.polygon);

// Under 90 CW rotation:
// p1: (100, 200) -> (200, 900)
// p2: (200, 200) -> (200, 800)
// p3: (200, 400) -> (400, 800)
// p4: (100, 400) -> (400, 900)
const expectedPoly = [
  { x: 200, y: 900 },
  { x: 200, y: 800 },
  { x: 400, y: 800 },
  { x: 400, y: 900 }
];

let polyOk = true;
for (let i = 0; i < expectedPoly.length; i++) {
  if (Math.abs(item.polygon[i].x - expectedPoly[i].x) > 1e-4 || Math.abs(item.polygon[i].y - expectedPoly[i].y) > 1e-4) {
    polyOk = false;
  }
}

if (polyOk) {
  console.log('✅ PASS: Polygon points rotated successfully!');
} else {
  console.log('❌ FAIL: Polygon points mismatch!');
  console.log('Expected:', expectedPoly);
  process.exit(1);
}

console.log('\n--- Internal Paths ---');
console.log('Original Internals:', mockPayload.sheets[0].placed[0].internals);
console.log('Rotated Internals:', item.internals);

// Original: { x: 120, y: 220 }, { x: 180, y: 220 }
// Rotated: { x: 220, y: 1000 - 120 = 880 }, { x: 220, y: 1000 - 180 = 820 }
const expectedInternals = [
  [
    { x: 220, y: 880 },
    { x: 220, y: 820 }
  ]
];

let internalsOk = true;
for (let i = 0; i < expectedInternals[0].length; i++) {
  if (Math.abs(item.internals[0][i].x - expectedInternals[0][i].x) > 1e-4 || Math.abs(item.internals[0][i].y - expectedInternals[0][i].y) > 1e-4) {
    internalsOk = false;
  }
}

if (internalsOk) {
  console.log('✅ PASS: Internals points rotated successfully!');
} else {
  console.log('❌ FAIL: Internals points mismatch!');
  console.log('Expected:', expectedInternals);
  process.exit(1);
}

console.log('\n--- Recalculated Centroid ---');
console.log('Original Centroid:', mockPayload.sheets[0].placed[0].centroid);
console.log('Recalculated Centroid:', item.centroid);

// Bounding box of rotated poly: x in [200, 400], y in [800, 900]
// Center: x = (200 + 400) / 2 = 300, y = (800 + 900) / 2 = 850
if (item.centroid.x === 300 && item.centroid.y === 850) {
  console.log('✅ PASS: Centroid recalculated successfully!');
} else {
  console.log(`❌ FAIL: Centroid mismatch! Expected x=300, y=850, got x=${item.centroid.x}, y=${item.centroid.y}`);
  process.exit(1);
}

// 2. Generate and check DXF and CYC
console.log('\n--- Exporters Generation Test ---');
try {
  const dxf = generateDieCutDxf(mockPayload);
  const cyc = generateDieCutCyc(mockPayload);
  console.log('✅ PASS: DXF and CYC generated successfully from rotated payload!');
  
  // Verify CYC values
  const cycXMatch = cyc.match(/Name="X" Value="([^"]+)"/);
  const cycYMatch = cyc.match(/Name="Y" Value="([^"]+)"/);
  const cycCMatch = cyc.match(/Name="C" Value="([^"]+)"/);
  
  console.log(`CYC output - X: ${cycXMatch ? cycXMatch[1] : 'null'}, Y: ${cycYMatch ? cycYMatch[1] : 'null'}, C: ${cycCMatch ? cycCMatch[1] : 'null'}`);
  
  if (cycXMatch && parseFloat(cycXMatch[1]) === 300 && cycYMatch && parseFloat(cycYMatch[1]) === 850 && cycCMatch && parseFloat(cycCMatch[1]) === 315) {
    console.log('✅ PASS: CYC coordinates and angle match rotated centroid and rotated angle perfectly!');
  } else {
    console.log('❌ FAIL: CYC coordinates or angle incorrect!');
    process.exit(1);
  }
} catch (err) {
  console.error('❌ FAIL: Error exporting:', err);
  process.exit(1);
}

console.log('\n🏆 ALL AUTOMATED TESTS PASSED 100% PERFECTLY!');
