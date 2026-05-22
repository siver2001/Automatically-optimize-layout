import fs from 'fs';
import path from 'path';

function analyzeCyc(cycPath) {
  if (!fs.existsSync(cycPath)) return [];
  const content = fs.readFileSync(cycPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const cycles = [];
  let currentCycle = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<Cycle Name="DXFData">')) {
      currentCycle = {};
    } else if (trimmed.startsWith('</Cycle>')) {
      if (currentCycle) cycles.push(currentCycle);
      currentCycle = null;
    } else if (trimmed.startsWith('<Field ')) {
      const nameMatch = trimmed.match(/Name="([^"]+)"/);
      const valueMatch = trimmed.match(/Value="([^"]+)"/);
      if (nameMatch && valueMatch && currentCycle) {
        currentCycle[nameMatch[1]] = valueMatch[1];
      }
    }
  }
  return cycles;
}

function analyzeDxf(dxfPath) {
  const content = fs.readFileSync(dxfPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entities = [];
  let currentEntity = null;
  let inEntitiesSection = false;

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i+1]?.trim();
    
    if (code === 0) {
      if (val === 'SECTION') {
        // Start section
      } else if (val === 'ENDSEC') {
        inEntitiesSection = false;
      }
      
      if (inEntitiesSection) {
        if (currentEntity) {
          entities.push(currentEntity);
        }
        currentEntity = { type: val, properties: [] };
      }
    } else if (code === 2 && lines[i-2]?.trim() === '0' && lines[i-1]?.trim() === 'SECTION') {
      if (val === 'ENTITIES') {
        inEntitiesSection = true;
      }
    } else {
      if (inEntitiesSection && currentEntity) {
        currentEntity.properties.push({ code, val });
      }
    }
  }
  if (currentEntity) {
    entities.push(currentEntity);
  }
  return entities;
}

const dxfPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/qqqqqq/0256 SIZE 12B_1.DXF';
const cycPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/qqqqqq/0256 SIZE 12B_1.CYC';

console.log('Analyzing files in qqqqqq folder:');
const entities = analyzeDxf(dxfPath);
const cycles = analyzeCyc(cycPath);

console.log(`Entities count in DXF: ${entities.length}`);
console.log(`Cycles count in CYC: ${cycles.length}`);

// Group by type
const typeCounts = {};
entities.forEach(ent => {
  typeCounts[ent.type] = (typeCounts[ent.type] || 0) + 1;
});
console.log('Entity types:', typeCounts);

// Find all polylines and check their vertices count, bounding boxes
const polylines = [];
let i = 0;
while (i < entities.length) {
  const ent = entities[i];
  if (ent.type === 'POLYLINE') {
    const vertices = [];
    let layer = '';
    for (const prop of ent.properties) {
      if (prop.code === 8) layer = prop.val;
    }
    
    let j = i + 1;
    while (j < entities.length && entities[j].type === 'VERTEX') {
      const vProps = entities[j].properties;
      let x = 0, y = 0;
      for (const p of vProps) {
        if (p.code === 10) x = parseFloat(p.val);
        if (p.code === 20) y = parseFloat(p.val);
      }
      vertices.push({ x, y });
      j++;
    }
    polylines.push({ layer, vertices });
    i = j;
  } else {
    i++;
  }
}

console.log(`Total polylines found: ${polylines.length}`);
polylines.forEach((pl, idx) => {
  // calculate bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  pl.vertices.forEach(v => {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  });
  const width = maxX - minX;
  const height = maxY - minY;
  console.log(`Polyline [${idx}] layer=${pl.layer} vertices=${pl.vertices.length} bbox=[w=${width.toFixed(2)}, h=${height.toFixed(2)}] center=[x=${((minX+maxX)/2).toFixed(2)}, y=${((minY+maxY)/2).toFixed(2)}]`);
});

// Also print the CYC fields of the first few
console.log('First 5 CYC entries:');
console.log(cycles.slice(0, 5));
