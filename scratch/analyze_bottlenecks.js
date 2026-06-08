import fs from 'fs';
import path from 'path';

const logPath = 'C:\\Users\\long.nh\\.gemini\\antigravity-ide\\brain\\25df539a-fdee-4422-bfc8-c5e30e3643fe\\.system_generated\\tasks\\task-4254.log';
if (!fs.existsSync(logPath)) {
  console.error("Log file not found!");
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

const events = [];
lines.forEach((line, index) => {
  if (line.includes('Started') && line.includes('Size')) {
    events.push({ type: 'start', text: line.trim(), lineNum: index + 1 });
  }
  if (line.includes('Completed') && line.includes('Size')) {
    events.push({ type: 'done', text: line.trim(), lineNum: index + 1 });
  }
});

console.log("=== WORKER ACTIVITY LOG ===");
events.forEach(e => {
  console.log(`[Line ${e.lineNum}] ${e.text}`);
});
