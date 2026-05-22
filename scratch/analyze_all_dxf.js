import fs from 'fs';
import path from 'path';

const dirPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.DXF'));

console.log(`Found ${files.length} DXF files to analyze.\n`);

files.slice(0, 5).forEach(file => {
  const filePath = path.join(dirPath, file);
  const content = fs.readFileSync(filePath, 'utf8');
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
  
  console.log(`File: ${file}`);
  console.log(`  Total entities: ${entities.length}`);
  
  // Print sequence of first 10 entities
  const sequence = entities.map(e => e.type);
  console.log(`  First 15 entities:`, sequence.slice(0, 15));
  
  // Count types
  const typeCounts = {};
  entities.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });
  console.log(`  Entity counts:`, typeCounts);
  console.log('----------------------------------------------------');
});
