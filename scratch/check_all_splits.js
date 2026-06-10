import fs from 'fs';

const layouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));

for (const size of ['12', '12.5']) {
  console.log(`\n=== All split pieces in Size ${size} layout ===`);
  const placements = layouts[size] || [];
  const splits = placements.filter(p => p.id.includes('split') || p.foot.startsWith('split-'));
  splits.sort((a, b) => a.minY - b.minY);
  for (const p of splits) {
    console.log(`ID: ${p.id.padEnd(22)} | Foot: ${p.foot.padEnd(12)} | X: [${p.minX.toFixed(1).padStart(5)} - ${p.maxX.toFixed(1).padStart(5)}] | Y: [${p.minY.toFixed(1).padStart(6)} - ${p.maxY.toFixed(1).padStart(6)}]`);
  }
}
