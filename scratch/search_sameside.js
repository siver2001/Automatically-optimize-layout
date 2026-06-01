import fs from 'fs';

const filePath = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';
if (fs.existsSync(filePath)) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  console.log("=== SEARCHING IN CapacityTestSameSidePattern.js ===");
  lines.forEach((line, index) => {
    if (line.includes('squeeze') || line.includes('Squeeze') || line.includes('compact') || line.includes('Compact')) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  });
} else {
  console.log("File not found!");
}
