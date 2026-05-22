import fs from 'fs';
import path from 'path';

const folder = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
const files = fs.readdirSync(folder).filter(f => f.endsWith('.CYC'));

console.log('Total CYC files in EOR-13:', files.length);

const allT = new Set();
const allC = new Set();

for (const file of files) {
  const content = fs.readFileSync(path.join(folder, file), 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<Field ')) {
      const nameMatch = trimmed.match(/Name="([^"]+)"/);
      const valueMatch = trimmed.match(/Value="([^"]+)"/);
      if (nameMatch && valueMatch) {
        const name = nameMatch[1];
        const val = valueMatch[1];
        if (name === 'T') allT.add(val);
        if (name === 'C') allC.add(val);
      }
    }
  }
}

console.log('All unique T across all CYC files:', [...allT]);
console.log('All unique C across all CYC files:', [...allC]);
