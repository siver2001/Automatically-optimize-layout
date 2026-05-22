import fs from 'fs';
import path from 'path';

const dir = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.DXF'));

files.forEach(file => {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = content.split(/\r?\n/);
  let polys = 0;
  let texts = 0;
  for (let i = 0; i < lines.length - 1; i += 2) {
    const c = lines[i].trim();
    const v = lines[i+1]?.trim();
    if (c === '0') {
      if (v === 'POLYLINE') polys++;
      if (v === 'TEXT') texts++;
    }
  }
  console.log(`${file}: POLYLINE = ${polys}, TEXT = ${texts}`);
});
