# Rectangle Packing Optimizer

Ứng dụng desktop offline tối ưu sắp xếp các hình chữ nhật nhỏ vào hình chữ nhật lớn sử dụng thuật toán 2D bin packing.

## ✨ Tính năng chính

- 🎯 **Tối ưu sắp xếp** với thuật toán 2D bin packing tiên tiến
- 🎨 **Giao diện trực quan** với Tailwind CSS và màu sắc phân biệt
- 📦 **Hỗ trợ nhiều lớp** sắp xếp
- 🔌 **Kết nối Modbus TCP/IP** với PLC
- 💻 **Ứng dụng desktop** với Electron
- 📱 **Responsive design** cho mọi kích thước màn hình
- 💾 **Offline mode** hoàn toàn

## 🏗️ Kiến trúc dự án

```
├── client/                 # React + Electron frontend
│   ├── public/
│   │   ├── electron.js     # Electron main process
│   │   ├── preload.js      # Preload script
│   │   └── index.html
│   ├── src/
│   │   ├── components/     # React components (Tailwind)
│   │   ├── services/       # API services
│   │   ├── context/        # React Context
│   │   └── styles/         # Tailwind CSS
│   ├── tailwind.config.js  # Tailwind configuration
│   └── package.json        # Electron configuration
├── server/                 # Node.js backend
│   ├── algorithms/         # Packing algorithms
│   ├── modbus/            # Modbus communication
│   ├── models/            # Data models
│   └── routes/            # API routes
└── docs/                  # Documentation
```

## 🚀 Cài đặt và chạy

### Cài đặt dependencies
```bash
npm run install-all
```

### Chạy ứng dụng

#### Web version (Development)
```bash
npm run dev
```
Truy cập: `http://localhost:3000`

#### Desktop version (Electron)
```bash
npm run electron-dev
```

#### Production build
```bash
npm run electron-pack
```

## 📖 Hướng dẫn sử dụng

1. **Nhập thông số Container**
   - Chiều rộng, chiều cao (mm)
   - Số lớp sắp xếp

2. **Quản lý hình chữ nhật**
   - 16 hình chữ nhật mặc định với màu sắc phân biệt
   - Chọn số lượng cho từng hình
   - Chọn/bỏ chọn nhiều hình cùng lúc

3. **Tối ưu sắp xếp**
   - Click "Tối ưu sắp xếp"
   - Xem kết quả trực quan với hiệu suất

4. **Kết nối PLC** (tùy chọn)
   - Nhập địa chỉ IP và port
   - Đọc/ghi dữ liệu Modbus

## 🛠️ Công nghệ sử dụng

### Frontend
- **React 18** - UI framework
- **Tailwind CSS** - Styling
- **Electron** - Desktop app
- **React Context** - State management
- **Axios** - HTTP client

### Backend
- **Node.js** - Runtime
- **Express** - Web framework
- **Socket.io** - Real-time communication
- **Modbus Serial** - PLC communication

### Algorithms
- **2D Bin Packing** - Bottom-Left Fill
- **Best Fit Decreasing** - Optimization
- **Next Fit Decreasing** - Alternative strategy

## 📦 Đóng gói ứng dụng

### Windows
```bash
npm run electron-pack
```
Tạo file installer trong `client/dist/`

### macOS
```bash
cd client && npm run electron-pack -- --mac
```

### Linux
```bash
cd client && npm run electron-pack -- --linux
```

## 🔧 Scripts có sẵn

```bash
# Development
npm run dev              # Web version
npm run electron-dev     # Desktop version

# Production
npm run build           # Build React app
npm run electron-pack   # Build Electron app
npm run electron        # Run Electron

# Utilities
npm run install-all     # Install all dependencies
```

## 📋 Yêu cầu hệ thống

- **Node.js**: 16+ 
- **RAM**: 4GB+ (khuyến nghị 8GB)
- **OS**: Windows 10+, macOS 10.14+, Linux
- **Dung lượng**: 500MB trống

## 📚 Tài liệu

- [🚀 Quick Start - Đưa lên GitHub](QUICK_START.md)
- [📖 Hướng dẫn GitHub chi tiết](GITHUB_SETUP.md)
- [💻 Hướng dẫn cài đặt](INSTALLATION.md)
- [⚡ Hướng dẫn Electron](ELECTRON_SETUP.md)

## 🤝 Đóng góp

1. Fork dự án
2. Tạo feature branch
3. Commit changes
4. Push to branch
5. Tạo Pull Request

## 📄 License

MIT License - xem file [LICENSE](LICENSE) để biết thêm chi tiết.
