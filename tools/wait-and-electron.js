import { exec } from 'child_process';
import waitOn from 'wait-on';

const port = process.env.CLIENT_PORT || process.env.PORT || 3000;
const url = `http://localhost:${port}`;

console.log(`[Wait-And-Electron] Waiting for ${url}...`);

waitOn({
  resources: [url],
  timeout: 60000, // 60s
}, (err) => {
  if (err) {
    console.error('[Wait-And-Electron] Timeout waiting for client:', err);
    process.exit(1);
  }
  console.log(`[Wait-And-Electron] ${url} is ready, starting electron...`);
  const electronCmd = 'npx electron .';
  const child = exec(electronCmd);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('exit', (code) => process.exit(code));
});
