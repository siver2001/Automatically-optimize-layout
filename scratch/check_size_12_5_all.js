import fs from 'fs';

const layouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));
const size12_5 = layouts['12.5'] || [];

size12_5.sort((a, b) => {
  if (Math.abs(a.minY - b.minY) > 50) return a.minY - b.minY;
  return a.minX - b.minX;
});

console.log("=== All pieces in Size 12.5 ===");
for (const p of size12_5) {
  console.log(`ID: ${p.id.padEnd(22)} | Foot: ${p.foot.padEnd(12)} | X: [${p.minX.toFixed(1).padStart(5)} - ${p.maxX.toFixed(1).padStart(5)}] | Y: [${p.minY.toFixed(1).padStart(6)} - ${p.maxY.toFixed(1).padStart(6)}]`);
}
