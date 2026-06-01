import fs from 'fs';
import DxfParser from 'dxf-parser';

async function run() {
  const file = 'EOR-13/7.5Q_1.DXF';
  const parser = new DxfParser();
  const dxf = parser.parseSync(fs.readFileSync(file, 'utf-8'));
  
  console.log(`DXF Layers:`, dxf.layers ? Object.keys(dxf.layers) : 'none');
  
  // Find bounding box of all entities in DXF
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  const addPoint = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const entity of dxf.entities) {
    if (entity.type === 'LINE') {
      addPoint(entity.vertices[0].x, entity.vertices[0].y);
      addPoint(entity.vertices[1].x, entity.vertices[1].y);
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      for (const v of entity.vertices) {
        addPoint(v.x, v.y);
      }
    }
  }
  
  console.log(`DXF Bounding Box of all entities:`);
  console.log(`  X: [${minX.toFixed(2)}, ${maxX.toFixed(2)}] (Width: ${(maxX - minX).toFixed(2)} mm)`);
  console.log(`  Y: [${minY.toFixed(2)}, ${maxY.toFixed(2)}] (Height: ${(maxY - minY).toFixed(2)} mm)`);
}

run().catch(console.error);
