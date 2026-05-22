import fs from 'fs';

const dxfPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF';
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

console.log('Total entities parsed:', entities.length);
console.log('Printing first 30 entities sequentially:');
for (let idx = 0; idx < Math.min(30, entities.length); idx++) {
  const ent = entities[idx];
  let extra = '';
  if (ent.type === 'TEXT') {
    const textProp = ent.properties.find(p => p.code === 1);
    extra = ` (Text: ${textProp?.val})`;
  } else if (ent.type === 'POLYLINE') {
    const layerProp = ent.properties.find(p => p.code === 8);
    extra = ` (Layer: ${layerProp?.val})`;
  }
  console.log(`  [${idx}] ${ent.type}${extra}`);
}
