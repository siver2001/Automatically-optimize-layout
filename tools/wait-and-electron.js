import waitOn from 'wait-on';
import { spawn } from 'child_process';
import net from 'net';

// Hàm tìm cổng trống
function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

async function start() {
  const clientPort = await findFreePort(3000);
  const serverPort = 5000; // Có thể làm tương tự nếu muốn linh hoạt cả server

  console.log(`Using port ${clientPort} for Client...`);

  // 1. Khởi động Server (cổng 5000)
  const server = spawn('npm', ['run', 'server'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PORT: serverPort }
  });

  // 2. Khởi động Client với cổng đã tìm được
  const client = spawn('npm', ['run', 'client'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PORT: clientPort, BROWSER: 'none' }
  });

  // 3. Đợi Client sẵn sàng
  const opts = {
    resources: [`http://127.0.0.1:${clientPort}`],
    timeout: 60000,
  };

  console.log(`Waiting for Client on port ${clientPort}...`);

  try {
    await waitOn(opts);
    console.log('Client is ready. Launching Electron...');
    
    // 4. Khởi động Electron và truyền cổng vào để Electron biết
    const electron = spawn('npx', ['electron', '.'], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_START_URL: `http://localhost:${clientPort}` }
    });

    electron.on('close', (code) => {
      server.kill();
      client.kill();
      process.exit(code);
    });
  } catch (err) {
    console.error('Error starting dev environment:', err);
    server.kill();
    client.kill();
    process.exit(1);
  }
}

start();
