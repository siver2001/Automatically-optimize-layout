# Hướng dẫn cài đặt và chạy ứng dụng Electron

## Tổng quan

Ứng dụng Rectangle Packing Optimizer đã được chuyển đổi để sử dụng:
- **Tailwind CSS** cho styling thay vì styled-components
- **Electron** để đóng gói thành ứng dụng desktop offline
- **Kiến trúc hybrid** với backend Node.js và frontend React

## Yêu cầu hệ thống

- Node.js (phiên bản 16 trở lên)
- npm hoặc yarn
- Windows 10/11, macOS, hoặc Linux
- RAM: tối thiểu 4GB (khuyến nghị 8GB)
- Dung lượng ổ cứng: 500MB trống

## Cài đặt

### Bước 1: Cài đặt dependencies

```bash
# Cài đặt tất cả dependencies
npm run install-all

# Hoặc cài đặt từng phần riêng biệt
npm install
cd client
npm install
cd ..
```

### Bước 2: Cài đặt dependencies bổ sung cho Electron

```bash
cd client
npm install --save-dev electron-is-dev
```

## Chạy ứng dụng

### Chế độ Development

#### Cách 1: Chạy đồng thời (Khuyến nghị)
```bash
# Từ thư mục gốc
npm run electron-dev
```

#### Cách 2: Chạy riêng biệt
```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend + Electron
cd client
npm run electron-dev
```

### Chế độ Production

#### Build và chạy
```bash
cd client
npm run electron-pack
```

#### Chạy file đã build
```bash
cd client
npm run electron
```

## Đóng gói ứng dụng

### Tạo installer cho Windows
```bash
cd client
npm run electron-pack
```

File installer sẽ được tạo trong thư mục `client/dist/`

### Các platform khác
```bash
# macOS
npm run electron-pack -- --mac

# Linux
npm run electron-pack -- --linux
```

## Cấu trúc dự án sau khi chuyển đổi

```
AutoLayout/
├── client/                 # React + Electron frontend
│   ├── public/
│   │   ├── electron.js     # Main process
│   │   ├── preload.js      # Preload script
│   │   └── index.html
│   ├── src/
│   │   ├── components/     # React components (Tailwind)
│   │   ├── services/       # API services
│   │   ├── context/        # React Context
│   │   └── styles/         # Tailwind CSS
│   ├── tailwind.config.js  # Tailwind config
│   ├── postcss.config.js   # PostCSS config
│   └── package.json        # Electron config
├── server/                 # Node.js backend
└── package.json
```

## Tính năng mới với Electron

### 1. Menu ứng dụng
- **File**: New Project, Open Project, Save Project, Export Results
- **Edit**: Cut, Copy, Paste, Undo, Redo
- **View**: Reload, DevTools, Zoom controls
- **Window**: Minimize, Close
- **Help**: About dialog

### 2. Native dialogs
- Open/Save file dialogs
- Message boxes
- Error handling

### 3. Offline mode
- Ứng dụng hoạt động hoàn toàn offline
- Không cần kết nối internet
- Dữ liệu được lưu trữ local

### 4. Cross-platform
- Windows: NSIS installer
- macOS: DMG package
- Linux: AppImage

## Troubleshooting

### Lỗi thường gặp

1. **Electron không khởi động**
   ```bash
   # Kiểm tra dependencies
   cd client
   npm install
   
   # Chạy lại
   npm run electron-dev
   ```

2. **Lỗi build Tailwind**
   ```bash
   # Rebuild Tailwind
   cd client
   npx tailwindcss -i ./src/index.css -o ./src/output.css --watch
   ```

3. **Lỗi kết nối backend**
   - Đảm bảo backend đang chạy trên port 5000
   - Kiểm tra firewall settings

4. **Lỗi packaging**
   ```bash
   # Xóa cache và rebuild
   cd client
   rm -rf node_modules dist
   npm install
   npm run electron-pack
   ```

### Performance

- **Memory usage**: ~200-300MB RAM
- **Startup time**: 2-3 giây
- **File size**: ~150MB (unpacked)

## Phát triển thêm

### Thêm tính năng native
1. Chỉnh sửa `public/electron.js`
2. Thêm IPC handlers
3. Cập nhật `public/preload.js`
4. Sử dụng trong React components

### Tùy chỉnh UI
1. Chỉnh sửa `tailwind.config.js`
2. Thêm custom components trong `src/index.css`
3. Sử dụng Tailwind classes trong components

### Build cho production
1. Cập nhật `package.json` build config
2. Thêm code signing (cho macOS/Windows)
3. Cấu hình auto-updater

## Scripts có sẵn

```bash
# Development
npm run dev              # Chạy web version
npm run electron-dev     # Chạy Electron version

# Production
npm run build           # Build React app
npm run electron-pack   # Build Electron app
npm run electron        # Chạy Electron (production)

# Utilities
npm run install-all     # Cài đặt tất cả dependencies
```

## Lưu ý quan trọng

1. **Security**: Preload script được sử dụng để bảo mật
2. **Performance**: Electron app có thể chậm hơn web version
3. **Updates**: Cần implement auto-updater cho production
4. **Code signing**: Cần certificate để distribute

## Liên hệ hỗ trợ

Nếu gặp vấn đề với Electron setup, vui lòng tạo issue hoặc liên hệ qua email.

