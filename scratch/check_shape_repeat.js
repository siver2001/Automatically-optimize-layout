import fs from 'fs';

const dxfContent = fs.readFileSync('EOR-13/10.5Q_1.DXF', 'utf8');
const lines = dxfContent.split(/\r?\n/);

let currentEntity = null;
let entities = [];

for (let i = 0; i < lines.length - 1; i += 2) {
  const code = lines[i].trim();
  const val = lines[i+1]?.trim();
  
  if (code === '0') {
    if (currentEntity) {
      entities.push(currentEntity);
    }
    currentEntity = { type: val, props: [] };
  } else if (currentEntity) {
    currentEntity.props.push({ code, val });
  }
}
if (currentEntity) entities.push(currentEntity);

// Find cutting polylines (skip the first one which is BORDER)
const polylines = [];
let idx = 0;
while (idx < entities.length) {
  const ent = entities[idx];
  if (ent.type === 'POLYLINE') {
    const vertices = [];
    let j = idx + 1;
    while (j < entities.length && entities[j].type === 'VERTEX') {
      const vProps = entities[j].props;
      let x = 0, y = 0;
      for (const p of vProps) {
        if (p.code === '10') x = parseFloat(p.val);
        if (p.code === '20') y = parseFloat(p.val);
      }
      vertices.push({ x, y });
      j++;
    }
    polylines.push({
      index: idx,
      vertices
    });
    idx = j;
  } else {
    idx++;
  }
}

console.log(`Total polylines found: ${polylines.length}`);

// For each shape polyline (index > 0), check if first and last vertices are identical
let repeatCount = 0;
let nonRepeatCount = 0;
for (let i = 1; i < polylines.length; i++) {
  const p = polylines[i];
  const first = p.vertices[0];
  const last = p.vertices[p.vertices.length - 1];
  const distance = Math.sqrt((first.x - last.x)**2 + (first.y - last.y)**2);
  if (distance < 1e-4) {
    repeatCount++;
  } else {
    nonRepeatCount++;
    if (nonRepeatCount <= 5) {
      console.log(`Polyline ${i} does not repeat first vertex: first=${JSON.stringify(first)}, last=${JSON.stringify(last)}`);
    }
  }
}

console.log(`Shapes with repeated first vertex: ${repeatCount}`);
console.log(`Shapes without repeated first vertex: ${nonRepeatCount}`);
