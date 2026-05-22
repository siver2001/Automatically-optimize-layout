import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';

const samplePayload = {
  title: 'ASICS-DC-EOR-13',
  sheetWidth: 1789.4647,
  sheetHeight: 1027.5245,
  labelMode: 'prepared-sequence',
  sizeList: [
    { sizeName: '10.5Q' }
  ],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      placed: [
        {
          id: 'placed_1',
          sizeName: '10.5Q',
          foot: 'L',
          x: 200.5,
          y: 150.3,
          angle: 12.5,
          polygon: [
            { x: 260.842, y: 169.055 },
            { x: 280.5, y: 180.2 },
            { x: 275.1, y: 220.4 },
            { x: 250.3, y: 195.8 }
          ],
          internals: [
            [
              { x: 265.0, y: 185.0 },
              { x: 270.0, y: 200.0 }
            ]
          ]
        }
      ]
    }
  ]
};

const dxf = generateDieCutDxf(samplePayload);
const lines = dxf.split(/\r?\n/);

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

console.log('Entities in generated DXF:');
entities.forEach((ent, index) => {
  if (ent.type === 'POLYLINE' || ent.type === 'TEXT') {
    let extra = '';
    if (ent.type === 'TEXT') {
      const textProp = ent.properties.find(p => p.code === 1);
      extra = ` (${textProp?.val})`;
    } else if (ent.type === 'POLYLINE') {
      const layerProp = ent.properties.find(p => p.code === 8);
      extra = ` (Layer: ${layerProp?.val})`;
    }
    console.log(`  [${index}] ${ent.type}${extra}`);
  }
});
