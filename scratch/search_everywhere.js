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
      if (content.includes('_squeezePlacements')) {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('_squeezePlacements')) {
            console.log(`${filePath}: Line ${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

console.log("=== RECURSIVE SEARCH FOR _squeezePlacements ===");
recSearch(searchDir);
