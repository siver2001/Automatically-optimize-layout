import fs from 'fs';
import path from 'path';

function analyzeDxfEntities(dxfPath) {
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

const dxfFile = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF';
const entities = analyzeDxfEntities(dxfFile);

console.log('Total entities:', entities.length);

// Interleave analyze
const structure = [];
let i = 0;
while (i < entities.length) {
  const ent = entities[i];
  if (ent.type === 'POLYLINE') {
    // Collect polyline vertices
    const vertices = [];
    let j = i + 1;
    let layer = '';
    for (const prop of ent.properties) {
      if (prop.code === 8) layer = prop.val;
    }
    while (j < entities.length && entities[j].type === 'VERTEX') {
      const vProps = entities[j].properties;
      let x, y;
      for (const p of vProps) {
        if (p.code === 10) x = parseFloat(p.val);
        if (p.code === 20) y = parseFloat(p.val);
      }
      vertices.push({ x, y });
      j++;
    }
    let hasSeqend = false;
    if (j < entities.length && entities[j].type === 'SEQEND') {
      hasSeqend = true;
      j++;
    }
    let text = null;
    if (j < entities.length && entities[j].type === 'TEXT') {
      const tProps = entities[j].properties;
      for (const p of tProps) {
        if (p.code === 1) text = p.val;
      }
      j++;
    }
    structure.push({
      type: 'POLYLINE_GROUP',
      layer,
      vertexCount: vertices.length,
      hasSeqend,
      text,
      indexRange: [i, j - 1]
    });
    i = j;
  } else {
    structure.push({
      type: ent.type,
      index: i
    });
    i++;
  }
}

console.log('Parsed Structure Groups:');
structure.forEach((g, index) => {
  if (g.type === 'POLYLINE_GROUP') {
    console.log(`  [Group ${index}] Polyline with ${g.vertexCount} vertices, layer ${g.layer}, hasSeqend: ${g.hasSeqend}, associated text: ${g.text}`);
  } else {
    console.log(`  [Entity ${index}] type: ${g.type}`);
  }
});
