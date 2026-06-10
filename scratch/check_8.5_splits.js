import fs from 'fs';

const oldLayouts = JSON.parse(fs.readFileSync('scratch/old_layouts.json', 'utf8'));
const newLayouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));

for (const type of ['old', 'new']) {
  const layouts = type === 'old' ? oldLayouts : newLayouts;
  const size8_5 = layouts['8.5'] || [];
  const splits = size8_5.filter(p => p.id.includes('split') || p.foot.startsWith('split-'));
  console.log(`=== Size 8.5 ${type} layout has ${splits.length} splits ===`);
  splits.sort((a, b) => a.minY - b.minY);
  for (const p of splits) {
    console.log(`ID: ${p.id.padEnd(22)} | Foot: ${p.foot.padEnd(12)} | X: [${p.minX.toFixed(1).padStart(5)} - ${p.maxX.toFixed(1).padStart(5)}] | Y: [${p.minY.toFixed(1).padStart(6)} - ${p.maxY.toFixed(1).padStart(6)}]`);
  }
}
