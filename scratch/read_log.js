import fs from 'fs';

const logPath = 'C:\\Users\\long.nh\\.gemini\\antigravity-ide\\brain\\11a066c1-b46b-418f-9088-3783b6bc10b9\\.system_generated\\tasks\\task-1497.log';
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);

const addRankedLines = lines.filter(line => line.includes('[SPY addRankedCandidate]'));
console.log(`Total addRankedCandidate log lines: ${addRankedLines.length}`);
addRankedLines.forEach(line => console.log(line));
