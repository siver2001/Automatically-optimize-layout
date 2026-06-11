import fs from 'fs';

function run() {
  const logPath = 'C:\\Users\\long.nh\\.gemini\\antigravity-ide\\brain\\11a066c1-b46b-418f-9088-3783b6bc10b9\\.system_generated\\tasks\\task-435.log';
  if (!fs.existsSync(logPath)) {
    console.error('Log file not found');
    return;
  }

  const buffer = fs.readFileSync(logPath);
  let content = '';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    content = buffer.toString('utf16le');
  } else {
    content = buffer.toString('utf8');
  }

  const lines = content.split(/\r?\n/);
  
  let currentHeader = '';
  const parsedByHeader = {};

  for (const line of lines) {
    if (line.includes('=== DETAIL ANALYSIS FOR')) {
      currentHeader = line;
      parsedByHeader[currentHeader] = [];
    }
    if (line.includes('[Build Candidate]') && line.includes('result=SUCCESS') && currentHeader) {
      parsedByHeader[currentHeader].push(line);
    }
  }

  for (const [header, list] of Object.entries(parsedByHeader)) {
    console.log(`\n==============================================`);
    console.log(`${header} (Total SUCCESS: ${list.length})`);
    console.log(`==============================================`);
    // Group and count by placements number
    const countByPlacements = {};
    for (const item of list) {
      const match = item.match(/placements=(\d+)/);
      if (match) {
        const count = match[1];
        countByPlacements[count] = (countByPlacements[count] || 0) + 1;
      }
    }
    console.log('Count by placements size:', countByPlacements);

    // List any candidates that had 56 placements or more, but group by unique signature (relAngle, bodyCols, bodyRows) to keep output very short
    const seenSigs = new Set();
    console.log('Unique patterns with >= 56 placements:');
    for (const item of list) {
      const match = item.match(/placements=(\d+), relAngle=(\d+), bodyCols=(\d+), bodyRows=(\d+)/);
      if (match) {
        const placements = parseInt(match[1]);
        if (placements >= 56) {
          const relAngle = match[2];
          const bodyCols = match[3];
          const bodyRows = match[4];
          const sig = `placements=${placements}, relAngle=${relAngle}, bodyCols=${bodyCols}, bodyRows=${bodyRows}`;
          if (!seenSigs.has(sig)) {
            seenSigs.add(sig);
            // find one sample of this in the list to print with dy and dx
            const sample = list.find(l => l.includes(`placements=${placements}`) && l.includes(`relAngle=${relAngle}`) && l.includes(`bodyCols=${bodyCols}`) && l.includes(`bodyRows=${bodyRows}`));
            console.log(`  ${sample.trim()}`);
          }
        }
      }
    }
  }
}

run();
