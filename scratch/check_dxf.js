import fs from 'fs';
import DxfParser from 'dxf-parser';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(dxfFile, 'utf-8');
  const parser = new DxfParser();
  const dxf = parser.parseSync(fileContent);

  console.log("=== DXF GENERAL INFO ===");
  console.log(`Entities count: ${dxf.entities ? dxf.entities.length : 0}`);
  
  const layerCounts = {};
  const typeCounts = {};
  for (const entity of dxf.entities || []) {
    layerCounts[entity.layer] = (layerCounts[entity.layer] || 0) + 1;
    typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
  }

  console.log("\n=== ENTITY COUNTS BY LAYER ===");
  console.log(JSON.stringify(layerCounts, null, 2));

  console.log("\n=== ENTITY COUNTS BY TYPE ===");
  console.log(JSON.stringify(typeCounts, null, 2));

  // Let's print some details about the layers and their entities
  console.log("\n=== ENTITY EXAMPLES ===");
  const examples = {};
  for (const entity of dxf.entities || []) {
    if (!examples[entity.layer]) {
      examples[entity.layer] = [];
    }
    if (examples[entity.layer].length < 2) {
      examples[entity.layer].push({
        type: entity.type,
        color: entity.color,
        closed: entity.closed,
        verticesCount: entity.vertices ? entity.vertices.length : undefined
      });
    }
  }
  console.log(JSON.stringify(examples, null, 2));
}

run().catch(console.error);
