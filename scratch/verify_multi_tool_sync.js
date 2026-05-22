import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

const toolCodeMap = {
  '10.5Q': 7,
  '8i': 11
};

const samplePayload = {
  title: 'TEST-MULTI-TOOL',
  sheetWidth: 1789.4647,
  sheetHeight: 1027.5245,
  labelMode: 'prepared-sequence',
  toolCodeMap,
  sizeList: [
    { sizeName: '10.5Q' },
    { sizeName: '8i' }
  ],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      placed: [
        {
          id: 'placed_1',
          sizeName: '10.5Q',
          x: 200.5,
          y: 150.3,
          centroid: { x: 200.5, y: 150.3 },
          polygon: [{ x: 190, y: 140 }, { x: 210, y: 140 }, { x: 210, y: 160 }, { x: 190, y: 160 }],
          label: 'N=1'
        },
        {
          id: 'placed_2',
          sizeName: '8i',
          x: 300.5,
          y: 250.3,
          centroid: { x: 300.5, y: 250.3 },
          polygon: [{ x: 290, y: 240 }, { x: 310, y: 240 }, { x: 310, y: 260 }, { x: 290, y: 260 }],
          label: 'N=2'
        },
        {
          id: 'placed_3',
          sizeName: '10.5Q',
          x: 400.5,
          y: 350.3,
          centroid: { x: 400.5, y: 350.3 },
          polygon: [{ x: 390, y: 340 }, { x: 410, y: 340 }, { x: 410, y: 360 }, { x: 390, y: 360 }],
          label: 'N=3'
        },
        {
          id: 'placed_4',
          sizeName: '8i',
          x: 500.5,
          y: 450.3,
          centroid: { x: 500.5, y: 450.3 },
          polygon: [{ x: 490, y: 440 }, { x: 510, y: 440 }, { x: 510, y: 460 }, { x: 490, y: 460 }],
          label: 'N=4'
        }
      ]
    }
  ]
};

console.log('--- STARTING MULTI-TOOL DXF / CYC SYNCHRONIZATION TEST ---');

// 1. Generate CYC
const cycContent = generateDieCutCyc(samplePayload);
console.log('\n--- GENERATED CYC CONTENT ---');
console.log(cycContent.trim());

// 2. Parse CYC cycles
const cycles = [];
const cycleRegex = /<Cycle[^>]*>([\s\S]*?)<\/Cycle>/g;
const fieldRegex = /<Field Name="([^"]+)" Value="([^"]+)"/g;
let match;
while ((match = cycleRegex.exec(cycContent)) !== null) {
  const fieldsText = match[1];
  const fields = {};
  let fMatch;
  while ((fMatch = fieldRegex.exec(fieldsText)) !== null) {
    fields[fMatch[1]] = fMatch[2];
  }
  cycles.push(fields);
}

console.log(`\nParsed ${cycles.length} cycles from CYC.`);

// 3. Generate DXF
const dxfContent = generateDieCutDxf(samplePayload);
const dxfLines = dxfContent.split(/\r?\n/);

// 4. Parse DXF TEXT labels in order of appearance
const dxfLabels = [];
for (let i = 0; i < dxfLines.length - 1; i += 2) {
  const code = parseInt(dxfLines[i].trim(), 10);
  const val = dxfLines[i+1]?.trim();
  if (code === 0 && val === 'TEXT') {
    // Find text value inside the TEXT block
    let j = i + 2;
    let labelVal = '';
    while (j < dxfLines.length - 1) {
      const subCode = parseInt(dxfLines[j].trim(), 10);
      const subVal = dxfLines[j+1]?.trim();
      if (subCode === 0) break; // Next entity
      if (subCode === 1) {
        labelVal = subVal;
      }
      j += 2;
    }
    if (labelVal.startsWith('N=')) {
      dxfLabels.push(labelVal);
    }
  }
}

console.log(`Parsed ${dxfLabels.length} TEXT labels from DXF:`, dxfLabels);

// 5. Assertions
let allPassed = true;

if (cycles.length !== 4) {
  console.error(`❌ FAILED: Expected 4 cycles in CYC, got ${cycles.length}`);
  allPassed = false;
} else {
  console.log(`✔ PASSED: Got exactly 4 cycles in CYC.`);
}

if (dxfLabels.length !== 4) {
  console.error(`❌ FAILED: Expected 4 text labels in DXF, got ${dxfLabels.length}`);
  allPassed = false;
} else {
  console.log(`✔ PASSED: Got exactly 4 text labels in DXF.`);
}

// Expected sequence (sorted by tool code [7 before 11], and sequence number [1 before 3, 2 before 4])
const expectedSequence = ['N=1', 'N=3', 'N=2', 'N=4'];

for (let i = 0; i < expectedSequence.length; i++) {
  const expected = expectedSequence[i];
  
  // Verify DXF label order
  if (dxfLabels[i] !== expected) {
    console.error(`❌ FAILED: DXF label at index ${i} is "${dxfLabels[i]}", expected "${expected}"`);
    allPassed = false;
  } else {
    console.log(`✔ PASSED: DXF label at index ${i} is correctly "${expected}"`);
  }

  // Verify CYC cycle order
  if (cycles[i]) {
    const cycLabel = `N=${cycles[i].N}`;
    const cycTool = cycles[i].T;
    const expectedTool = expected === 'N=1' || expected === 'N=3' ? '7' : '11';
    
    if (cycLabel !== expected || cycTool !== expectedTool) {
      console.error(`❌ FAILED: CYC cycle at index ${i} has N="${cycles[i].N}" T="${cycTool}", expected N="${expected.substring(2)}" T="${expectedTool}"`);
      allPassed = false;
    } else {
      console.log(`✔ PASSED: CYC cycle at index ${i} has correctly N="${cycles[i].N}" T="${cycTool}"`);
    }
  }
}

if (allPassed) {
  console.log('\n======================================================');
  console.log('✔ SUCCESS: DXF AND CYC ARE 100% PERFECTLY SYNCHRONIZED!');
  console.log('======================================================');
  process.exit(0);
} else {
  console.log('\n======================================================');
  console.error('❌ FAILURE: SYNCHRONIZATION MISMATCH DETECTED!');
  console.log('======================================================');
  process.exit(1);
}
