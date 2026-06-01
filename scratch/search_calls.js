import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

console.log("=== OCCURRENCES OF _canPlaceSplitOrient ===");
lines.forEach((line, index) => {
  if (line.includes('_canPlaceSplitOrient')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
