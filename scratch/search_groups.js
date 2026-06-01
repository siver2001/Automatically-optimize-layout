import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== OCCURRENCES OF _findSplitPairGroupPlacementOptions ===");
lines.forEach((line, index) => {
  if (line.includes('_findSplitPairGroupPlacementOptions')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
