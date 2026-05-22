import fs from 'fs';

function parseTextPositions(dxfContent) {
  const lines = dxfContent.split(/\r?\n/);
  const texts = [];
  
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === 'TEXT' && lines[i-1]?.trim() === '0') {
      let label = '';
      let x = 0, y = 0;
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j-1]?.trim() === '1') label = lines[j].trim();
        if (lines[j-1]?.trim() === '10') x = parseFloat(lines[j].trim());
        if (lines[j-1]?.trim() === '20') y = parseFloat(lines[j].trim());
      }
      texts.push({ label, x, y });
    }
  }
  return texts;
}

const refTexts = parseTextPositions(fs.readFileSync('EOR-13/10.5Q_1.DXF', 'utf8'));
const genTexts = parseTextPositions(fs.readFileSync('scratch/gen_10.5Q_1.DXF', 'utf8'));

console.log(`Ref texts: ${refTexts.length}, Gen texts: ${genTexts.length}`);

console.log('\nFirst 10 of Ref:');
console.log(refTexts.slice(0, 10));

console.log('\nFirst 10 of Gen:');
console.log(genTexts.slice(0, 10));

console.log('\nAll texts where coordinates differ by more than 10.0:');
for (let i = 0; i < Math.min(refTexts.length, genTexts.length); i++) {
  const r = refTexts[i];
  const g = genTexts[i];
  if (r.label !== g.label || Math.abs(r.x - g.x) > 10.0 || Math.abs(r.y - g.y) > 10.0) {
    console.log(`Index ${i}:`);
    console.log(`  Ref: label=${r.label}, x=${r.x}, y=${r.y}`);
    console.log(`  Gen: label=${g.label}, x=${g.x}, y=${g.y}`);
  }
}
