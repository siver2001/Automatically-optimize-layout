import waitOn from 'wait-on';
import { spawn, execSync } from 'child_process';
import net from 'net';

let server = null;
let client = null;
let electron = null;
let isCleaningUp = false;

// Hàm tìm cổng trống
function findFreePort(startPort) {
  return new Promise((resolve) => {
    const serverSocket = net.createServer();
    serverSocket.listen(startPort, () => {
      const { port } = serverSocket.address();
      serverSocket.close(() => resolve(port));
    });
    serverSocket.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

// Hàm giải phóng cổng nếu cổng đang bị chiếm dụng bởi tiến trình Node/Electron cũ (chỉ áp dụng trên Windows)
function freePort(port) {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      // Tìm PID của tiến trình đang LISTENING trên cổng này
      // Dùng netstat -ano để tìm PID
      const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, { encoding: 'utf8' });
      const lines = output.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // Định dạng của netstat: TCP  [Địa chỉ local]:[Port]  [Địa chỉ foreign]  LISTENING  [PID]
        // Ví dụ: TCP    0.0.0.0:5000           0.0.0.0:0              LISTENING       14232
        const localAddress = parts[1];
        if (localAddress && localAddress.endsWith(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && !isNaN(pid)) {
            try {
              // Lấy tên tiến trình (Image Name) của PID để tránh kill nhầm ứng dụng khác
              const taskInfo = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' }).trim();
              if (taskInfo) {
                // Tên tiến trình nằm ở cột đầu tiên, định dạng CSV: "node.exe","[PID]","Console","1",...
                const processName = taskInfo.split(',')[0].replace(/"/g, '').toLowerCase();

                // Chỉ tự động kill nếu đó là node.exe hoặc electron.exe (các tiến trình Node/Electron cũ bị treo)
                if (processName === 'node.exe' || processName === 'electron.exe') {
                  console.log(`[Wait-and-Electron] Phát hiện cổng ${port} đang bị chiếm bởi tiến trình cũ '${processName}' (PID ${pid}). Tiến hành giải phóng...`);
                  execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                } else {
                  console.warn(`[Wait-and-Electron] ⚠️ Cảnh báo: Cổng ${port} đang bị chiếm bởi chương trình khác: '${processName}' (PID ${pid}).`);
                  console.warn(`[Wait-and-Electron] Để tránh mất dữ liệu của bạn, hệ thống KHÔNG tự động tắt nó. Vui lòng kiểm tra hoặc tắt thủ công chương trình này nếu ứng dụng của bạn gặp lỗi kết nối.`);
                }
              }
            } catch (err) {
              console.warn(`[Wait-and-Electron] Cổng ${port} đang bị chiếm bởi PID ${pid} nhưng không xác định được tên tiến trình. Để an toàn, hệ thống không tự động tắt.`);
            }
          }
        }
      }
      resolve();
    } catch (e) {
      // Thường throw lỗi nếu không tìm thấy dòng nào khớp (cổng trống), đây là bình thường
      resolve();
    }
  });
}

// Hàm kết thúc hoàn toàn cây tiến trình để tránh tiến trình mồ côi
function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try {
      // Sử dụng execSync để dừng ĐỒNG BỘ, đảm bảo tiến trình bị kill hoàn toàn trước khi lệnh tiếp theo chạy
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch (e) {}
  } else {
    try {
      // Trên Unix, gửi SIGKILL cho nhóm tiến trình (process group)
      process.kill(-proc.pid, 'SIGKILL');
    } catch (e) {
      try {
        proc.kill('SIGKILL');
      } catch (err) {}
    }
  }
}

// Hàm dọn dẹp tất cả các tiến trình con và thoát
function cleanupAndExit(code = 0) {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log('\n[Wait-and-Electron] Đang dừng tất cả các tiến trình chạy ngầm để giải phóng port...');

  if (electron) {
    console.log('[Wait-and-Electron] Đang tắt Electron...');
    killProcessTree(electron);
  }
  if (client) {
    console.log('[Wait-and-Electron] Đang tắt Client...');
    killProcessTree(client);
  }
  if (server) {
    console.log('[Wait-and-Electron] Đang tắt Server...');
    killProcessTree(server);
  }

  console.log('[Wait-and-Electron] Hoàn tất dọn dẹp. Thoát chương trình.');
  process.exit(code);
}

// Đăng ký các sự kiện kết thúc chương trình để dọn dẹp tài nguyên
process.on('SIGINT', () => {
  console.log('\n[Wait-and-Electron] Nhận tín hiệu ngắt (Ctrl+C).');
  cleanupAndExit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Wait-and-Electron] Nhận tín hiệu kết thúc (SIGTERM).');
  cleanupAndExit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Wait-and-Electron] Lỗi không mong muốn:', err);
  cleanupAndExit(1);
});

async function start() {
  const serverPort = 5000;
  
  console.log('[Wait-and-Electron] Đang kiểm tra và giải phóng cổng 5000...');
  await freePort(serverPort);

  const clientPort = await findFreePort(3000);
  console.log(`[Wait-and-Electron] Sử dụng cổng ${clientPort} cho Client...`);

  // 1. Khởi động Server (cổng 5000)
  server = spawn('npm', ['run', 'server'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PORT: serverPort }
  });

  // 2. Khởi động Client với cổng đã tìm được
  client = spawn('npm', ['run', 'client'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PORT: clientPort, BROWSER: 'none' }
  });

  // 3. Đợi Client sẵn sàng
  const opts = {
    resources: [`http://127.0.0.1:${clientPort}`],
    timeout: 60000,
  };

  console.log(`[Wait-and-Electron] Đang đợi Client khởi động tại cổng ${clientPort}...`);

  try {
    await waitOn(opts);
    console.log('[Wait-and-Electron] Client đã sẵn sàng. Đang khởi chạy Electron...');
    
    // 4. Khởi động Electron và truyền cổng vào để Electron biết
    electron = spawn('npx', ['electron', '.'], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_START_URL: `http://localhost:${clientPort}` }
    });

    electron.on('close', (code) => {
      console.log(`[Wait-and-Electron] Cửa sổ Electron đã đóng (mã thoát: ${code}).`);
      cleanupAndExit(code);
    });
  } catch (err) {
    console.error('[Wait-and-Electron] Lỗi khi khởi động môi trường dev:', err);
    cleanupAndExit(1);
  }
}

start();
