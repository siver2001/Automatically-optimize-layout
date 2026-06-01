import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== VIEW LINES 2650-2690 ===");
for (let i = 2649; i < 2690 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
