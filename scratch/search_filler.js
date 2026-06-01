import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== OCCURRENCES OF filler PLACEMENT IN CapacityTestDoubleInsoleDoubleContourPattern.js ===");
lines.forEach((line, index) => {
  if (line.includes('filler') && (line.includes('y') || line.includes('Y') || line.includes('place') || line.includes('Row'))) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
