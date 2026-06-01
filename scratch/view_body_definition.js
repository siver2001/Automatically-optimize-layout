import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== VIEW LINES 4850-4910 ===");
for (let i = 4849; i < 4910 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
