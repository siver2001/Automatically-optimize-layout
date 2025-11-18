const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

const isDev = !app.isPackaged;
let serverProcess;

// 1. Hàm khởi động server
function startServer() {
  // Đường dẫn đến server/index.js
  // Khi dev, __dirname là thư mục gốc.
  // Khi build, __dirname là .../resources/app.asar
  const serverPath = path.join(__dirname, 'server', 'index.js');

  console.log(`[Electron] Starting server at ${serverPath}...`);
  serverProcess = fork(serverPath);

  serverProcess.on('error', err => console.error('[Server Error]', err));
  serverProcess.on('exit', code => console.log(`[Server] Exited with code ${code}`));
}

// 2. Hàm tạo cửa sổ client
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    title: 'Tự động sắp xếp liệu',
    // Cập nhật đường dẫn icon (tính từ gốc)
    icon: path.join(__dirname, 'client', 'public', 'icon.png'), 
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    // Chế độ Dev: Load React dev server (sẽ chạy ở port 3000)
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // Chế độ Production: Load file build của React
    const indexPath = path.join(__dirname, 'client', 'build', 'index.html');
    mainWindow.loadFile(indexPath);
  }
}

// 3. Quản lý vòng đời App
app.on('ready', () => {
  if (!isDev) {
    startServer(); 
  }
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