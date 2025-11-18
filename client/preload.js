// client/public/preload.js

// SỬ DỤNG ES MODULE IMPORT
import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, limited API to the renderer process (React)
contextBridge.exposeInMainWorld('electron', {
  // Lấy thông tin phiên bản của Electron, Node.js và Chromium
  versions: process.versions,

  // --- IPC Communication Utilities ---
  
  // Các kênh được phép gửi tin nhắn đồng bộ tới Main Process
  sendSync: (channel, data) => {
    const validChannels = ['app-control-sync']; 
    if (validChannels.includes(channel)) {
      return ipcRenderer.sendSync(channel, data);
    }
    // Tránh gửi nếu kênh không hợp lệ
    return undefined; 
  },

  // Các kênh được phép gửi tin nhắn bất đồng bộ tới Main Process
  send: (channel, data) => {
    const validChannels = ['to-main-channel', 'packing:start-optimization', 'modbus:connect', 'modbus:disconnect', 'modbus:read', 'modbus:write']; 
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`[Preload] Attempted to send to invalid channel: ${channel}`);
    }
  },
  
  // Các kênh được phép nhận tin nhắn từ Main Process
  on: (channel, func) => {
    const validChannels = ['from-main-channel', 'app-status', 'modbus:status-update', 'modbus:read-reply', 'modbus:write-reply']; 
    
    if (validChannels.includes(channel)) {
      // Bọc hàm để đảm bảo chỉ truyền data, không truyền event object
      const wrappedFunc = (event, ...args) => func(...args);
      ipcRenderer.on(channel, wrappedFunc);
      
      // Cung cấp hàm cleanup (unsubscribe)
      return () => ipcRenderer.removeListener(channel, wrappedFunc);
    } else {
      console.warn(`[Preload] Attempted to subscribe to invalid channel: ${channel}`);
      return () => {}; // Trả về hàm rỗng để tránh lỗi
    }
  },

  // Các kênh được phép gọi hàm và chờ kết quả (nên dùng thay cho sendSync)
  invoke: (channel, data) => {
    const validChannels = ['invoke-channel', 'modbus:ping', 'packing:get-config'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
  }
});
