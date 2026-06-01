import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== VIEW LINES 2920-2960 ===");
for (let i = 2919; i < 2960 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
