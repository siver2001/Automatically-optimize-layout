import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log("=== VIEW LINES 4780-4850 ===");
for (let i = 4779; i < 4850 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
