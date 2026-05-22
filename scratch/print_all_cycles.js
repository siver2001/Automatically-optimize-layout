import fs from 'fs';

function analyzeCyc(cycPath) {
  const content = fs.readFileSync(cycPath, 'utf8');
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
  return cycles;
}

const cycPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/qqqqqq/0256 SIZE 12B_1.CYC';
const cycles = analyzeCyc(cycPath);

cycles.forEach((c, idx) => {
  console.log(`Cycle [${idx}] (N=${c.N}): T=${c.T}, X=${c.X}, Y=${c.Y}, C=${c.C}`);
});
