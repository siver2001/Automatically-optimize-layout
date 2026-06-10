import fs from 'fs';

const layouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));
const size7 = layouts['7'] || [];

console.log("=== All pieces in Size 7 layout with minX < 150 ===");
for (const p of size7) {
  if (p.minX < 150) {
    console.log(`ID: ${p.id.padEnd(20)} | Foot: ${p.foot.padEnd(12)} | X: [${p.minX.toFixed(1)} - ${p.maxX.toFixed(1)}] | Y: [${p.minY.toFixed(1)} - ${p.maxY.toFixed(1)}]`);
  }
}
