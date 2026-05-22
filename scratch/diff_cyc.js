import fs from 'fs';

const ref = fs.readFileSync('EOR-13/10.5Q_1.CYC', 'utf8').split(/\r?\n/);
const gen = fs.readFileSync('scratch/gen_10.5Q_1.CYC', 'utf8').split(/\r?\n/);

console.log(`Ref lines: ${ref.length}, Gen lines: ${gen.length}`);

let diffs = 0;
for (let i = 0; i < Math.max(ref.length, gen.length); i++) {
  const r = ref[i] !== undefined ? ref[i] : '[EOF]';
  const g = gen[i] !== undefined ? gen[i] : '[EOF]';
  if (r.trim() !== g.trim()) {
    console.log(`Line ${i + 1}:`);
    console.log(`  Ref: "${r}"`);
    console.log(`  Gen: "${g}"`);
    diffs++;
    if (diffs > 10) break;
  }
}
if (diffs === 0) {
  console.log('CYC files are identical!');
}
