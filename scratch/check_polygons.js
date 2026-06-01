import fs from 'fs';
import DxfParser from 'dxf-parser';
import { getBoundingBox, area } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(dxfFile, 'utf-8');
  const parser = new DxfParser();
  const dxf = parser.parseSync(fileContent);

  const polylines = [];
  for (const entity of dxf.entities || []) {
    if (entity.type === 'POLYLINE' || entity.type === 'LWPOLYLINE') {
      const points = (entity.vertices || []).map(v => ({ x: v.x, y: -v.y }));
      polylines.push({
        layer: entity.layer,
        points,
        bb: getBoundingBox(points),
        area: area(points)
      });
    }
  }

  console.log(`Parsed ${polylines.length} polylines.`);
  
  // Sort polylines by bounding box center or area to see patterns
  polylines.sort((a, b) => a.area - b.area);

  console.log("\n=== POLYLINE AREAS AND BOUNDS ===");
  for (let i = 0; i < polylines.length; i++) {
    const p = polylines[i];
    const center = {
      x: (p.bb.minX + p.bb.maxX) / 2,
      y: (p.bb.minY + p.bb.maxY) / 2
    };
    console.log(`Polyline ${i}: Area = ${p.area.toFixed(1)} | Center = (${center.x.toFixed(1)}, ${center.y.toFixed(1)}) | BB: Width = ${p.bb.width.toFixed(1)}, Height = ${p.bb.height.toFixed(1)}`);
  }
}

run().catch(console.error);
