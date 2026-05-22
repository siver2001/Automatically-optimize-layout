import fs from 'fs';
import path from 'path';

function analyzeCyc(cycPath) {
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

const cycFile = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.CYC';
const dxfFile = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF';

console.log('--- ANALYZING REFERECE CYC ---');
const cycles = analyzeCyc(cycFile);
console.log('Total cycles:', cycles.length);
console.log('First 5 cycles:', cycles.slice(0, 5));

console.log('\n--- ANALYZING REFERENCE DXF ---');
const entities = analyzeDxf(dxfFile);
console.log('Total entities in ENTITIES section:', entities.length);

const typeCounts = {};
const layerCounts = {};
const textValues = [];
const plineCount = { default: 0, nonDefault: 0 };

for (const ent of entities) {
  typeCounts[ent.type] = (typeCounts[ent.type] || 0) + 1;
  let layer = '';
  for (const prop of ent.properties) {
    if (prop.code === 8) {
      layer = prop.val;
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    }
    if (prop.code === 1 && ent.type === 'TEXT') {
      textValues.push(prop.val);
    }
  }
}

console.log('Entity types:', typeCounts);
console.log('Layers:', layerCounts);
console.log('Text labels count:', textValues.length);
console.log('First 10 labels:', textValues.slice(0, 10));
console.log('Last 10 labels:', textValues.slice(-10));
