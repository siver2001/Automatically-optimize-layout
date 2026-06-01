import fs from 'fs';
import path from 'path';

const dir = 'D:/Automatically-optimize-layout/server/algorithms/diecut/strategies/capacity';
const files = fs.readdirSync(dir);

console.log("=== SEARCHING _squeezePlacements ===");
for (const file of files) {
  const filePath = path.join(dir, file);
  if (fs.statSync(filePath).isFile() && file.endsWith('.js')) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('_squeezePlacements')) {
        console.log(`${file} Line ${index + 1}: ${line.trim()}`);
      }
    });
  }
}
