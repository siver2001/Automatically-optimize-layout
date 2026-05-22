import fs from 'fs';
import path from 'path';

const eorDir = 'EOR-13';
const files = fs.readdirSync(eorDir).filter(f => f.endsWith('.DXF'));

files.forEach(file => {
  const dxfPath = path.join(eorDir, file);
  const dxfContent = fs.readFileSync(dxfPath, 'utf8');
  const lines = dxfContent.split(/\r?\n/);
  
  const vertices = [];
  let inPolyline = false;
  let count = 0;
  
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const val = lines[i+1]?.trim();
    
    if (code === '0') {
      if (val === 'POLYLINE') {
        inPolyline = true;
        count++;
      } else if (val === 'SEQEND') {
        if (inPolyline && count === 1) {
          break;
        }
      }
    } else if (inPolyline && count === 1) {
      if (code === '10') {
        const x = parseFloat(val);
        const y = parseFloat(lines[i+3].trim());
        vertices.push({ x, y });
      }
    }
  }
  
  console.log(`File: ${file}`);
  console.log(`  Vertices:`, JSON.stringify(vertices));
});
