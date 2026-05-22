import fs from 'fs';

const cycPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.CYC';
const content = fs.readFileSync(cycPath, 'utf8');

const lines = content.split(/\r?\n/);
console.log('Total lines:', lines.length);

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

console.log('Total cycles parsed:', cycles.length);
console.log('First 5 cycles:', cycles.slice(0, 5));

// Check unique T values, unique C values
const tSet = new Set();
const cSet = new Set();
cycles.forEach(c => {
  tSet.add(c.T);
  cSet.add(c.C);
});

console.log('Unique T values:', [...tSet]);
console.log('Unique C values:', [...cSet]);
