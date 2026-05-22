import fs from 'fs';
import path from 'path';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';

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
      
      placed.push({
        id: `placed_${index++}`,
        sizeName: sizeName,
        foot: 'L',
        x: centroid.x,
        y: centroid.y,
        angle: 0.0,
        polygon: vertices,
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

const eorDir = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
const refDxfPath = path.join(eorDir, '10.5Q_1.DXF');
const refCycPath = path.join(eorDir, '10.5Q_1.CYC');

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

const refEntities = parseDxfEntities(refDxfContent);
const genEntities = parseDxfEntities(genDxf);

// Compare structures
const refHighLevel = refEntities.filter(e => e.type === 'POLYLINE' || e.type === 'TEXT');
const genHighLevel = genEntities.filter(e => e.type === 'POLYLINE' || e.type === 'TEXT');

console.log('--- HIGH LEVEL STRUCTURE COMPARISON ---');
console.log(`Reference high level entities count: ${refHighLevel.length}`);
console.log(`Generated high level entities count: ${genHighLevel.length}`);

console.log('\nFirst 10 of Reference:');
refHighLevel.slice(0, 10).forEach((e, idx) => {
  let detail = '';
  if (e.type === 'TEXT') {
    detail = ` (val: ${e.properties.find(p => p.code === 1)?.val})`;
  } else {
    const isBoundary = e.properties.some(p => p.code === 8 && p.val === 'BORDER') || idx === 0;
    detail = isBoundary ? ' (BORDER)' : ' (CUT PATH)';
  }
  console.log(`  [${idx}] ${e.type}${detail}`);
});

console.log('\nFirst 10 of Generated:');
genHighLevel.slice(0, 10).forEach((e, idx) => {
  let detail = '';
  if (e.type === 'TEXT') {
    detail = ` (val: ${e.properties.find(p => p.code === 1)?.val})`;
  } else {
    const isBoundary = e.properties.some(p => p.code === 8 && p.val === 'BORDER') || idx === 0;
    detail = isBoundary ? ' (BORDER)' : ' (CUT PATH)';
  }
  console.log(`  [${idx}] ${e.type}${detail}`);
});

// Compare attributes of POLYLINE
const refPolylines = refEntities.filter(e => e.type === 'POLYLINE');
const genPolylines = genEntities.filter(e => e.type === 'POLYLINE');

console.log('\n--- POLYLINE PROPERTIES COMPARISON ---');
if (refPolylines.length > 0 && genPolylines.length > 0) {
  console.log('Reference POLYLINE properties:', JSON.stringify(refPolylines[1].properties));
  console.log('Generated POLYLINE properties:', JSON.stringify(genPolylines[1].properties));
}

// Compare attributes of VERTEX
const refVertices = refEntities.filter(e => e.type === 'VERTEX');
const genVertices = genEntities.filter(e => e.type === 'VERTEX');

console.log('\n--- VERTEX PROPERTIES COMPARISON ---');
if (refVertices.length > 0 && genVertices.length > 0) {
  console.log('Reference VERTEX properties:', JSON.stringify(refVertices[10].properties));
  console.log('Generated VERTEX properties:', JSON.stringify(genVertices[10].properties));
}

// Compare attributes of TEXT
const refTexts = refEntities.filter(e => e.type === 'TEXT');
const genTexts = genEntities.filter(e => e.type === 'TEXT');

console.log('\n--- TEXT PROPERTIES COMPARISON ---');
if (refTexts.length > 0 && genTexts.length > 0) {
  console.log('Reference TEXT properties:', JSON.stringify(refTexts[0].properties));
  console.log('Generated TEXT properties:', JSON.stringify(genTexts[0].properties));
}
