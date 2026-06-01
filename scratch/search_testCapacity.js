import fs from 'fs';
import path from 'path';

const searchDir = 'D:/Automatically-optimize-layout/server';

function recSearch(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      recSearch(filePath);
    } else if (stat.isFile() && file.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('testCapacity')) {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('testCapacity')) {
            console.log(`${filePath}: Line ${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

console.log("=== RECURSIVE SEARCH FOR testCapacity ===");
recSearch(searchDir);
