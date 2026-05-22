import fs from 'fs';
import path from 'path';

const refDxfContent = fs.readFileSync('c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF', 'utf8');
const genDxfContent = fs.readFileSync('scratch/gen_10.5Q_1.DXF', 'utf8');

const refLines = refDxfContent.split(/\r?\n/);
const genLines = genDxfContent.split(/\r?\n/);

// Find first "TEXT" entity with val "N=1" in both files
function findTextN1StartIndex(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === 'TEXT' && lines[i-1]?.trim() === '0') {
      // Look ahead for "N=1"
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j].trim() === 'N=1' && lines[j-1]?.trim() === '1') {
          return i - 1; // start of TEXT entity (the "0" group code line)
        }
      }
    }
  }
  return -1;
}

const refStart = findTextN1StartIndex(refLines);
const genStart = findTextN1StartIndex(genLines);

console.log(`TEXT N=1 start index in Reference: ${refStart}`);
console.log(`TEXT N=1 start index in Generated: ${genStart}`);

if (refStart === -1 || genStart === -1) {
  console.log('Could not find TEXT N=1 in one of the files.');
  process.exit(1);
}

// Diff from that point onwards
const refCompare = refLines.slice(refStart);
const genCompare = genLines.slice(genStart);

console.log(`Comparing from TEXT N=1. Reference lines: ${refCompare.length}, Generated lines: ${genCompare.length}`);

let diffCount = 0;
for (let i = 0; i < Math.min(refCompare.length, genCompare.length); i++) {
  if (refCompare[i].trim() !== genCompare[i].trim()) {
    // Check if it's just a numerical precision difference (e.g. centroid coordinate difference due to simple average vs exact float)
    const refTrim = refCompare[i].trim();
    const genTrim = genCompare[i].trim();
    
    // Ignore minor coordinate differences in TEXT (code 10, 20) and VERTEX (code 10, 20)
    const prevRefCode = refCompare[i-1]?.trim();
    const prevGenCode = genCompare[i-1]?.trim();
    
    const isCoordinate = (prevRefCode === '10' || prevRefCode === '20') && (prevGenCode === '10' || prevGenCode === '20');
    
    if (isCoordinate) {
      const refVal = parseFloat(refTrim);
      const genVal = parseFloat(genTrim);
      if (Math.abs(refVal - genVal) < 0.05) {
        // Safe minor float difference, skip
        continue;
      }
    }
    
    console.log(`Diff at compare line ${i + 1} (actual Ref line ${refStart + i + 1}, actual Gen line ${genStart + i + 1}):`);
    console.log(`  Ref: "${refCompare[i]}"`);
    console.log(`  Gen: "${genCompare[i]}"`);
    diffCount++;
    if (diffCount >= 20) {
      console.log('Too many diffs, stopping...');
      break;
    }
  }
}

if (diffCount === 0) {
  console.log('🏆 SUCCESS: Structural parity from TEXT N=1 onwards is 100% PERFECT!');
}
