import fs from 'fs';

function getPolylineVertexCounts(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  
  const counts = [];
  let currentCount = 0;
  let inPolyline = false;
  
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const val = lines[i+1]?.trim();
    
    if (code === '0') {
      if (val === 'POLYLINE') {
        inPolyline = true;
        currentCount = 0;
      } else if (val === 'VERTEX') {
        if (inPolyline) currentCount++;
      } else if (val === 'SEQEND') {
        if (inPolyline) {
          counts.push(currentCount);
          inPolyline = false;
        }
      }
    }
  }
  return counts;
}

const refCounts = getPolylineVertexCounts('EOR-13/10.5Q_1.DXF');
const genCounts = getPolylineVertexCounts('scratch/gen_10.5Q_1.DXF');

console.log(`Ref polylines count: ${refCounts.length}, Gen polylines count: ${genCounts.length}`);
console.log(`Border vertex count - Ref: ${refCounts[0]}, Gen: ${genCounts[0]}`);

let mismatch = 0;
for (let i = 0; i < Math.min(refCounts.length, genCounts.length); i++) {
  if (refCounts[i] !== genCounts[i]) {
    console.log(`Mismatch at polyline ${i}: Ref has ${refCounts[i]} vertices, Gen has ${genCounts[i]} vertices.`);
    mismatch++;
  }
}

if (mismatch === 0 && refCounts.length === genCounts.length) {
  console.log('🏆 SUCCESS: All polylines have 100% identical vertex counts!');
} else {
  console.log(`⚠️ Mismatch count: ${mismatch}`);
}
