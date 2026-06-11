import fs from 'fs';

const logPath = 'C:\\Users\\long.nh\\.gemini\\antigravity-ide\\brain\\11a066c1-b46b-418f-9088-3783b6bc10b9\\.system_generated\\tasks\\task-1518.log';
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);

const targetLines = [];
let capture = false;
let count = 0;

for (const line of lines) {
  if (line.includes('=== FOUND FAILING')) {
    capture = true;
    count++;
    if (count > 5) break; // only print first 5 failures to save output space
  }
  if (capture) {
    targetLines.push(line);
    if (line.includes('===') && !line.includes('FOUND FAILING')) {
      // stop capture on next section
      capture = false;
    }
  }
}

console.log(`Found failures: ${count}`);
targetLines.slice(0, 100).forEach(line => console.log(line));
