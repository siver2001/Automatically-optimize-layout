const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const isDev = !app.isPackaged;
let serverProcess;

// 1. Hàm khởi động server (ĐÃ CHUYỂN SANG PROMISE)
function startServer() {
  // Trả về một Promise, chỉ hoàn thành khi nhận được tin nhắn 'server-ready'
  return new Promise((resolve, reject) => {
    // Đường dẫn đến server/index.js
// Khi dev, __dirname là thư mục gốc. Khi build, __dirname là .../resources/app.asar
    const serverPath = path.join(__dirname, 'server', 'index.js');

    console.log(`[Electron] Starting server at ${serverPath}...`);

serverProcess = fork(serverPath, [], {
      // BẮT BUỘC: Thêm 'ipc' để nhận message
      // silent: false để log của server vẫn ra console
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      silent: false 
    });

    serverProcess.on('error', err => {
      console.error('[Server Error]', err);
      reject(err); // Promise thất bại nếu server lỗi
    });

    serverProcess.on('exit', code => console.log(`[Server] Exited with code ${code}`));

    // LẮNG NGHE TIN NHẮN TỪ TIẾN TRÌNH CON
    serverProcess.on('message', (message) => {
      if (message === 'server-ready') {
        console.log('[Electron] Server is ready!');
        resolve(); // Promise thành công!
      }
    });
  });
}

// 2. Hàm tạo cửa sổ client (Không đổi)
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    title: 'Tự động sắp xếp liệu',
    icon: path.join(__dirname, 'client', 'public', 'icon.png'), 
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

if (isDev) {
    // Chế độ Dev
mainWindow.loadURL('http://localhost:3000');
} else {
    // Chế độ Production
    const indexPath = path.join(__dirname, 'client', 'build', 'index.html');
mainWindow.loadFile(indexPath);
  }
}

// 3. Quản lý vòng đời App (DÙNG ASYNC/AWAIT)
app.on('ready', async () => { // Thêm 'async'
  if (!isDev) {
    try {
      console.log('[Electron] Waiting for server to start...');
      await startServer(); // ĐỢI cho server sẵn sàng
      console.log('[Electron] Server started, creating window...');
    } catch (err) {
      console.error("[Electron] Không thể khởi động server:", err);
      app.quit(); // Thoát nếu server lỗi
      return;
    }
  }
  // Chỉ gọi createWindow SAU KHI server đã sẵn sàng (hoặc ở chế độ dev)
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Quan trọng: Tắt server khi app Electron tắt
app.on('before-quit', () => {
  if (serverProcess) {
    console.log('[Electron] Killing server process...');
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});