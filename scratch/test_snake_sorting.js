import fs from 'fs';
import path from 'path';

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

function extractPlacedItemsFromRefDxf(dxfPath, sizeName) {
  const dxfContent = fs.readFileSync(dxfPath, 'utf8');
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
      
      let sumX = 0, sumY = 0;
      vertices.forEach(v => { sumX += v.x; sumY += v.y; });
      const centroid = { x: sumX / vertices.length, y: sumY / vertices.length };
      
      placed.push({
        id: `placed_${index++}`,
        sizeName: sizeName,
        foot: 'L',
        x: centroid.x,
        y: centroid.y,
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

// Hàm sắp xếp Snake mới
function applySnakeSorting(items = []) {
  // Sắp xếp Y tăng dần trước
  const sortedByY = [...items].sort((a, b) => a.centroid.y - b.centroid.y);
  
  const rows = [];
  const Y_THRESHOLD = 50.0;
  
  for (const item of sortedByY) {
    if (rows.length === 0) {
      rows.push([item]);
    } else {
      const lastRow = rows[rows.length - 1];
      const avgY = lastRow.reduce((sum, it) => sum + it.centroid.y, 0) / lastRow.length;
      if (Math.abs(item.centroid.y - avgY) < Y_THRESHOLD) {
        lastRow.push(item);
      } else {
        rows.push([item]);
      }
    }
  }
  
  console.log(`Detected ${rows.length} rows:`);
  rows.forEach((row, rIdx) => {
    console.log(`  Row ${rIdx + 1}: ${row.length} items, avgY = ${(row.reduce((s, i) => s + i.centroid.y, 0) / row.length).toFixed(3)}`);
  });

  const snakeSorted = [];
  rows.forEach((row, rIdx) => {
    // Sắp xếp các chi tiết trong hàng theo X tăng dần
    const sortedRow = [...row].sort((a, b) => a.centroid.x - b.centroid.x);
    if (rIdx % 2 === 1) {
      // Hàng lẻ (0-indexed, hàng thứ 2, 4...) -> Đảo ngược thứ tự (Snake)
      sortedRow.reverse();
    }
    snakeSorted.push(...sortedRow);
  });
  
  return snakeSorted;
}

const items = extractPlacedItemsFromRefDxf('EOR-13/10.5Q_1.DXF', '10.5Q');
console.log(`Extracted ${items.length} items from Reference DXF.`);

const snakeItems = applySnakeSorting(items);

console.log('\n--- COMPARISON OF SEQUENCES ---');
for (let idx = 0; idx < Math.min(items.length, snakeItems.length); idx++) {
  const refLabel = items[idx].label; // Thứ tự gốc trong file (là Snake)
  const genSnakeLabel = `N=${idx + 1}`;
  
  // So sánh tọa độ của chi tiết ở vị trí idx trong danh sách đã sắp xếp Snake của chúng ta
  // với tọa độ của chi tiết ở vị trí idx trong danh sách gốc
  const refItem = items[idx];
  const snakeItem = snakeItems[idx];
  
  const dist = Math.hypot(refItem.centroid.x - snakeItem.centroid.x, refItem.centroid.y - snakeItem.centroid.y);
  if (dist > 1.0) {
    console.log(`❌ Mismatch at index ${idx}:`);
    console.log(`   Ref: label=${refLabel}, x=${refItem.centroid.x.toFixed(3)}, y=${refItem.centroid.y.toFixed(3)}`);
    console.log(`   SnakeGen: label=${genSnakeLabel}, x=${snakeItem.centroid.x.toFixed(3)}, y=${snakeItem.centroid.y.toFixed(3)}`);
  } else {
    console.log(`✅ Match index ${idx}: Ref has ${refLabel}, SnakeGen has ${genSnakeLabel}`);
  }
}
