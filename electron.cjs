const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const isDev = !app.isPackaged;
let serverProcess;

// 1. Hàm khởi động server 
function startServer() {
  // Trả về một Promise, chỉ hoàn thành khi nhận được tin nhắn 'server-ready'
  return new Promise((resolve, reject) => {
    // Đường dẫn đến server/index.js
    const serverPath = path.join(__dirname, 'server', 'index.js');

    console.log(`[Electron] Starting server at ${serverPath}...`);

serverProcess = fork(serverPath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      silent: false ,
      execArgv: ['--max-old-space-size=4096']
    });

    const timeout = setTimeout(() => {
      reject(new Error('Server startup timeout after 10s'));
    }, 10000);
    
    serverProcess.on('error', err => {
      console.error('[Server Error]', err);
      reject(err); // Promise thất bại nếu server lỗi
    });

    serverProcess.on('exit', code => console.log(`[Server] Exited with code ${code}`));

    // LẮNG NGHE TIN NHẮN TỪ TIẾN TRÌNH CON
    serverProcess.on('message', (message) => {
      if (typeof message === 'object' && message.type === 'server-ready') {
        clearTimeout(timeout);
        console.log(`[Electron] Server is ready on port ${message.port}!`);
        resolve(message.port); // Promise thành công với port!
      } else if (message === 'server-ready') {
        // Fallback cho version cũ nếu cần
        clearTimeout(timeout);
        console.log('[Electron] Server is ready on default port!');
        resolve(5000);
      }
    });
  });
}

// 2. Hàm tạo cửa sổ client (Không đổi)
function createWindow(serverPort = 5000) {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    title: 'Netting',
    icon: path.join(__dirname, 'client', 'public', 'icon.png'), 
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  const startUrl = process.env.ELECTRON_START_URL || `http://localhost:${process.env.CLIENT_PORT || 3000}`;
  if (isDev) {
    mainWindow.loadURL(startUrl);
  } else {
    // ✅ LOAD từ Server Express thay vì file local
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }
}

// 3. Quản lý vòng đời App (DÙNG ASYNC/AWAIT)
app.on('ready', async () => { // Thêm 'async'
  let port = 5000;
  if (!isDev) {
    try {
      console.log('[Electron] Waiting for server to start...');
      port = await startServer(); // ĐỢI cho server sẵn sàng và lấy port
      console.log(`[Electron] Server started on port ${port}, creating window...`);
    } catch (err) {
      console.error("[Electron] Không thể khởi động server:", err);
      app.quit(); // Thoát nếu server lỗi
      return;
    }
  }
  // Cấu hình lưu file: Luôn hiển thị hộp thoại "Save As" khi tải file
  session.defaultSession.on('will-download', (event, item, webContents) => {
    item.setSaveDialogOptions({
      title: 'Chọn vị trí lưu file',
      defaultPath: item.getFilename(),
      buttonLabel: 'Lưu'
    });
  });

  // Chỉ gọi createWindow SAU KHI server đã sẵn sàng (hoặc ở chế độ dev)
  createWindow(port);
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