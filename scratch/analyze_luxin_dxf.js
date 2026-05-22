import fs from 'fs';
import path from 'path';

const dxfPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
const content = fs.readFileSync(dxfPath, 'utf8');

const lines = content.split(/\r?\n/);
console.log('Total lines:', lines.length);

const entities = [];
let currentEntity = null;
let inEntitiesSection = false;
let sectionName = '';

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
    sectionName = val;
    if (sectionName === 'ENTITIES') {
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

console.log('Total entities found in ENTITIES section:', entities.length);

const typeCounts = {};
const layerCounts = {};
const textValues = [];

for (const ent of entities) {
  typeCounts[ent.type] = (typeCounts[ent.type] || 0) + 1;
  let layer = '';
  for (const prop of ent.properties) {
    if (prop.code === 8) {
      layer = prop.val;
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    }
    if (prop.code === 1 && (ent.type === 'TEXT' || ent.type === 'MTEXT')) {
      textValues.push(prop.val);
    }
  }
}

console.log('Entity type counts:', typeCounts);
console.log('Layer counts:', layerCounts);
console.log('First 20 text values:', textValues.slice(0, 20));
console.log('Total text values:', textValues.length);
