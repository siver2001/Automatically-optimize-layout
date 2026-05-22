import fs from 'fs';
import path from 'path';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

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

function extractPlacedItemsFromRefDxf(dxfContent, sizeName) {
  const entities = parseDxfEntities(dxfContent);
  const placed = [];
  let index = 0;
  
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
      
      // If it's a 5-vertex border frame, skip it from placed items
      if (vertices.length === 5 && 
          Math.abs(vertices[0].x - vertices[3].x) < 0.01 && 
          Math.abs(vertices[1].x - vertices[2].x) < 0.01) {
        i = j;
        if (j < entities.length && entities[j].type === 'SEQEND') i++;
        if (i < entities.length && entities[i].type === 'TEXT') i++;
        continue;
      }
      
      let hasSeqend = false;
      if (j < entities.length && entities[j].type === 'SEQEND') {
        hasSeqend = true;
        j++;
      }
      
      let label = '';
      if (j < entities.length && entities[j].type === 'TEXT') {
        const tProps = entities[j].properties;
        for (const p of tProps) {
          if (p.code === 1) label = p.val;
        }
        j++;
      }
      
      // Calculate simple centroid
      let sumX = 0, sumY = 0;
      vertices.forEach(v => { sumX += v.x; sumY += v.y; });
      const centroid = { x: sumX / vertices.length, y: sumY / vertices.length };
      
      // Clean polygon by stripping the repeated vertex if it exists, matching database state
      const polygon = [...vertices];
      if (polygon.length >= 2) {
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-3) {
          polygon.pop();
        }
      }

      placed.push({
        id: `placed_${index++}`,
        sizeName: sizeName,
        foot: 'L',
        x: centroid.x,
        y: centroid.y,
        angle: 0.0,
        polygon,
        centroid,
        label
      });
      
      i = j;
    } else {
      i++;
    }
  }
  
  return placed;
}

const eorDir = 'EOR-13';
const refDxfPath = path.join(eorDir, '10.5Q_1.DXF');
const refDxfContent = fs.readFileSync(refDxfPath, 'utf8');
const placedItems = extractPlacedItemsFromRefDxf(refDxfContent, '10.5Q');

const payload = {
  title: 'ASICS-DC-EOR-13',
  sheetWidth: 1789.4647,
  sheetHeight: 1027.5245,
  isLuxin: true,
  toolCodeMap: { '10.5Q': '7' },
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      placed: placedItems
    }
  ]
};

const genDxf = generateDieCutDxf(payload);
const genCyc = generateDieCutCyc(payload);

fs.writeFileSync('scratch/gen_10.5Q_1.DXF', genDxf, 'utf8');
fs.writeFileSync('scratch/gen_10.5Q_1.CYC', genCyc, 'utf8');

console.log('Successfully regenerated and saved gen_10.5Q_1.DXF and gen_10.5Q_1.CYC!');
