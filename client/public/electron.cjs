// CommonJS entry for Electron main process
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Kiểm tra môi trường dev
const isDev = !app.isPackaged;

// URL khởi động
const startUrl = isDev
  ? 'http://localhost:3000'
  : `file://${path.join(__dirname, '../build/index.html')}`;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    title: 'Tự động sắp xếp liệu',
    // Icon path phải được xử lý đúng cho cả dev và production
    icon: isDev 
      ? path.join(__dirname, 'icon.png')
      : path.join(process.resourcesPath, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Thêm preload nếu cần
      // preload: path.join(__dirname, 'preload.js')
    },
  });

  // Load URL với xử lý lỗi
  mainWindow.loadURL(startUrl).catch(err => {
    console.error('Failed to load URL:', err);
    
    // Fallback: Thử load từ file
    if (!isDev) {
      const fallbackPath = path.join(__dirname, '../build/index.html');
      console.log('Trying fallback path:', fallbackPath);
      mainWindow.loadFile(fallbackPath);
    }
  });


  // Log khi window sẵn sàng
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded successfully');
  });

  // Xử lý lỗi load
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
}

// Khởi động app
app.whenReady().then(() => {
  createWindow();

  // IPC handlers
  ipcMain.on('app:get-version', (event) => {
    event.reply('app:version-reply', app.getVersion());
  });

  ipcMain.on('to-main-channel', (event, data) => {
    console.log('[Main Process] Message from renderer:', data);
  });
});

// Thoát app khi đóng tất cả cửa sổ (trừ macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Tạo lại window khi click icon trên macOS
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Xử lý khi app thoát
app.on('before-quit', () => {
  console.log('App is quitting...');
});