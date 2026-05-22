import fs from 'fs';

const dxfPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF';
const content = fs.readFileSync(dxfPath, 'utf8');
const lines = content.split(/\r?\n/);

console.log('Total lines:', lines.length);

const sections = [];
for (let i = 0; i < lines.length - 1; i += 2) {
  const code = parseInt(lines[i].trim(), 10);
  const val = lines[i+1]?.trim();
  if (code === 2 && lines[i-2]?.trim() === '0' && lines[i-1]?.trim() === 'SECTION') {
    sections.push(val);
  }
}

console.log('Sections found in reference DXF:', sections);

console.log('\nFirst 20 lines of reference DXF:');
console.log(lines.slice(0, 20).join('\n'));
