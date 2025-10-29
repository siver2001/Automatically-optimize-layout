// client/public/electron.js

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Định nghĩa lại __dirname và __filename cho môi trường ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kiểm tra môi trường phát triển (Development Mode)
const isDev = process.env.NODE_ENV === 'development';

const startUrl = isDev
  ? 'http://localhost:3000'
  : `file://${path.join(__dirname, '../build/index.html')}`;


function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920, 
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    title: 'Rectangle Packing Optimizer',
    webPreferences: {
      // ⚠️ Thiết lập bảo mật cốt lõi:
      // Tắt Node.js APIs trong Renderer (React side)
      nodeIntegration: false, 
      // Bật Context Isolation để ngăn chặn xung đột môi trường và bảo mật
      contextIsolation: true,
      // Đặt preload script tại đây nếu cần cầu nối giữa Node và React
      // preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(startUrl);
}

// Khi Electron sẵn sàng, tạo cửa sổ chính
app.whenReady().then(() => {
  createWindow();
  
  // --- IPC Main Handlers (Đã chuyển sang ES Module) ---
  
  // Ví dụ: Lắng nghe sự kiện từ Renderer (React)
  ipcMain.on('app:get-version', (event) => {
    // Phản hồi lại phiên bản ứng dụng
    event.reply('app:version-reply', app.getVersion());
  });

  // Ví dụ: Lắng nghe và log dữ liệu từ Renderer
  ipcMain.on('to-main-channel', (event, data) => {
    console.log('[Main Process] Message from renderer:', data);
    // Nếu muốn phản hồi, sử dụng event.sender.send() hoặc event.reply()
  });
});


// Thoát ứng dụng khi tất cả cửa sổ đã đóng (trừ trên macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Xử lý khi icon ứng dụng được click (chỉ hoạt động trên macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
