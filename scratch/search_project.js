import fs from 'fs';
import path from 'path';

const searchDir = 'D:/Automatically-optimize-layout';

function recSearch(dir) {
  // skip node_modules, .git, dist
  const baseName = path.basename(dir);
  if (baseName === 'node_modules' || baseName === '.git' || baseName === 'dist') return;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      recSearch(filePath);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.ts'))) {
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

console.log("=== PROJECT RECURSIVE SEARCH FOR _squeezePlacements ===");
recSearch(searchDir);
