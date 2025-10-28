# Hướng dẫn cài đặt và chạy ứng dụng

## Yêu cầu hệ thống

- Node.js (phiên bản 14 trở lên)
- npm hoặc yarn
- Windows 10/11 (để kết nối Modbus TCP/IP)

## Cài đặt

### Bước 1: Clone hoặc tải dự án
```bash
# Nếu có git
git clone <repository-url>
cd AutoLayout

# Hoặc giải nén file zip vào thư mục AutoLayout
```

### Bước 2: Cài đặt dependencies
```bash
# Cài đặt tất cả dependencies (cả backend và frontend)
npm run install-all

# Hoặc cài đặt từng phần riêng biệt
npm install
cd client
npm install
cd ..
```

### Bước 3: Chạy ứng dụng

#### Cách 1: Chạy đồng thời backend và frontend
```bash
npm run dev
```

#### Cách 2: Chạy riêng biệt
```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run client
```

### Bước 4: Truy cập ứng dụng
- Mở trình duyệt và truy cập: `http://localhost:3000`
- Backend API chạy tại: `http://localhost:5000`

## Sử dụng ứng dụng

### 1. Nhập thông số Container
- Nhập chiều rộng (mm)
- Nhập chiều cao (mm) 
- Nhập số lớp cần sắp xếp
- Click "Cập nhật Container"

### 2. Quản lý hình chữ nhật
- Xem danh sách 16 hình chữ nhật mặc định
- Chọn số lượng cho từng hình chữ nhật
- Chọn các hình chữ nhật cần sắp xếp
- Click "Tối ưu sắp xếp"

### 3. Xem kết quả
- Kết quả hiển thị trên giao diện trực quan
- Thống kê hiệu suất sắp xếp
- Màu sắc phân biệt theo kích thước

### 4. Kết nối PLC (tùy chọn)
- Click tab "Kết nối PLC"
- Nhập địa chỉ IP và port của PLC
- Click "Kết nối"
- Sử dụng chức năng đọc/ghi dữ liệu

## Cấu trúc dự án

```
AutoLayout/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # API services
│   │   ├── context/        # React Context
│   │   └── styles/         # CSS files
│   └── package.json
├── server/                 # Node.js backend
│   ├── algorithms/         # Packing algorithms
│   ├── modbus/            # Modbus communication
│   ├── models/            # Data models
│   ├── routes/            # API routes
│   └── index.js
├── package.json
└── README.md
```

## Troubleshooting

### Lỗi thường gặp

1. **Port đã được sử dụng**
   ```bash
   # Thay đổi port trong server/index.js
   const PORT = process.env.PORT || 5001;
   ```

2. **Lỗi cài đặt dependencies**
   ```bash
   # Xóa node_modules và cài lại
   rm -rf node_modules client/node_modules
   npm run install-all
   ```

3. **Lỗi kết nối Modbus**
   - Kiểm tra địa chỉ IP PLC
   - Kiểm tra port (mặc định 502)
   - Kiểm tra kết nối mạng

4. **Lỗi build React**
   ```bash
   cd client
   npm run build
   ```

### Performance

- Để tối ưu hiệu suất với nhiều hình chữ nhật, giảm số lượng hình chữ nhật hoặc tăng kích thước container
- Thuật toán có thể mất vài giây với dữ liệu phức tạp

## Phát triển thêm

### Thêm thuật toán mới
1. Tạo file mới trong `server/algorithms/`
2. Implement interface tương tự `PackingAlgorithm`
3. Thêm vào danh sách strategies trong `optimize()`

### Thêm tính năng UI
1. Tạo component mới trong `client/src/components/`
2. Import và sử dụng trong `App.js`
3. Cập nhật context nếu cần

### Tùy chỉnh Modbus
1. Chỉnh sửa `server/modbus/modbusService.js`
2. Thêm các function đọc/ghi mới
3. Cập nhật API routes trong `server/routes/modbus.js`

## Liên hệ hỗ trợ

Nếu gặp vấn đề, vui lòng tạo issue hoặc liên hệ qua email.
