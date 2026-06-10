import fs from 'fs';

const layouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));

for (const size of ['12', '12.5']) {
  console.log(`\n=== Pieces in Size ${size} layout on the left margin (X close to 0) ===`);
  const placements = layouts[size] || [];
  placements.sort((a, b) => a.minY - b.minY);
  for (const p of placements) {
    if (p.minX < 150) {
      console.log(`ID: ${p.id.padEnd(22)} | Foot: ${p.foot.padEnd(12)} | X: [${p.minX.toFixed(1).padStart(5)} - ${p.maxX.toFixed(1).padStart(5)}] | Y: [${p.minY.toFixed(1).padStart(6)} - ${p.maxY.toFixed(1).padStart(6)}]`);
    }
  }
}
