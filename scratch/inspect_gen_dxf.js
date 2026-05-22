import fs from 'fs';

function parseDxfEntities(dxfContent) {
  const lines = dxfContent.split(/\r?\n/);
  const entities = [];
  let currentEntity = null;
  let inEntitiesSection = false;

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i+1]?.trim();
    
    if (code === 0) {
      if (val === 'SECTION') {
        // Start
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

const file = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/qqqqqq/0256 SIZE 12B_1.DXF';
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const entities = parseDxfEntities(content);
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
  console.log(`Generated file ${file} has ${polylines.length} polylines.`);
  console.log('Border polyline vertices:', polylines[0]?.vertices);
} else {
  console.log(`File ${file} does not exist.`);
}
