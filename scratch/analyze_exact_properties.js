import fs from 'fs';

const dxfContent = fs.readFileSync('EOR-13/10.5Q_1.DXF', 'utf8');
const lines = dxfContent.split(/\r?\n/);

let currentEntity = null;
let entities = [];

for (let i = 0; i < lines.length - 1; i += 2) {
  const code = lines[i].trim();
  const val = lines[i+1]?.trim();
  
  if (code === '0') {
    if (currentEntity) {
      entities.push(currentEntity);
    }
    currentEntity = { type: val, props: [] };
  } else if (currentEntity) {
    currentEntity.props.push({ code, val });
  }
}
if (currentEntity) entities.push(currentEntity);

console.log('--- FIRST 15 ENTITIES WITH ALL DETAILS ---');
entities.slice(0, 15).forEach((ent, idx) => {
  console.log(`\n[${idx}] Type: ${ent.type}`);
  ent.props.forEach(p => {
    console.log(`  Code ${p.code}: "${p.val}"`);
  });
});
