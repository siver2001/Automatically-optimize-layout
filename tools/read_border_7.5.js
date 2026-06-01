import fs from 'fs';
import DxfParser from 'dxf-parser';

async function run() {
  const file = 'EOR-13/8.5i_1.DXF';
  const parser = new DxfParser();
  const dxf = parser.parseSync(fs.readFileSync(file, 'utf-8'));
  
  // Find all rectangles/polylines that look like a border
  for (const entity of dxf.entities) {
    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const vertices = entity.vertices;
      if (vertices.length === 4 || vertices.length === 5) {
        // Calculate bounds of this polyline
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const v of vertices) {
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
        }
        const w = maxX - minX;
        const h = maxY - minY;
        
        // Print if it looks like a sheet border
        if (w > 1000 && h > 1000) {
          console.log(`Potential Border LWPOLYLINE:`);
          console.log(`  Bounds: X [${minX.toFixed(2)}, ${maxX.toFixed(2)}], Y [${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);
          console.log(`  Dimensions: ${w.toFixed(2)} x ${h.toFixed(2)} mm`);
        }
      }
    }
  }
}

run().catch(console.error);
