import fs from 'fs';
import path from 'path';

const folder = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
const files = fs.readdirSync(folder).filter(f => f.endsWith('.CYC'));

console.log('Analyzing tools and N-sequence for each reference CYC file:');

for (const file of files) {
  const content = fs.readFileSync(path.join(folder, file), 'utf8');
  const lines = content.split(/\r?\n/);
  
  const cycles = [];
  let currentCycle = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<Cycle Name="DXFData">')) {
      currentCycle = {};
    } else if (trimmed.startsWith('</Cycle>')) {
      if (currentCycle) cycles.push(currentCycle);
      currentCycle = null;
    } else if (trimmed.startsWith('<Field ')) {
      const nameMatch = trimmed.match(/Name="([^"]+)"/);
      const valueMatch = trimmed.match(/Value="([^"]+)"/);
      if (nameMatch && valueMatch && currentCycle) {
        currentCycle[nameMatch[1]] = valueMatch[1];
      }
    }
  }

  const tSet = new Set(cycles.map(c => c.T));
  const nList = cycles.map(c => parseInt(c.N, 10));
  const uniqueNs = new Set(nList);
  
  console.log(`File: ${file}`);
  console.log(`  Total cycles: ${cycles.length}`);
  console.log(`  Unique T:`, [...tSet]);
  console.log(`  N sequence range: min=${Math.min(...nList)}, max=${Math.max(...nList)}, unique count=${uniqueNs.size}`);
  
  // Check if N is purely consecutive 1..M
  let consecutive = true;
  for (let i = 1; i <= cycles.length; i++) {
    if (!uniqueNs.has(i)) consecutive = false;
  }
  console.log(`  Is N sequence consecutive 1..${cycles.length}:`, consecutive);
  if (!consecutive) {
    console.log(`  First 10 cycles N values:`, cycles.slice(0, 10).map(c => `N=${c.N} T=${c.T}`));
  }
}
