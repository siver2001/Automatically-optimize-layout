# 🚀 Quick Start - Đưa dự án lên GitHub

## Cách 1: Sử dụng Script Tự động (Khuyến nghị)

### Windows:
```bash
# Chạy file batch
setup-github.bat
```

### macOS/Linux:
```bash
# Cấp quyền thực thi
chmod +x setup-github.sh

# Chạy script
./setup-github.sh
```

## Cách 2: Làm thủ công

### 1. Cài đặt Git (nếu chưa có)
- **Windows**: Tải từ https://git-scm.com/download/win
- **macOS**: `brew install git`
- **Linux**: `sudo apt install git`

### 2. Cấu hình Git
```bash
git config --global user.name "Tên của bạn"
git config --global user.email "email@example.com"
```

### 3. Khởi tạo repository
```bash
# Trong thư mục dự án
git init
git add .
git commit -m "Initial commit: Rectangle Packing Optimizer"
```

### 4. Tạo repository trên GitHub
1. Truy cập: https://github.com/new
2. Repository name: `rectangle-packing-optimizer`
3. Description: `Ứng dụng desktop tối ưu sắp xếp hình chữ nhật`
4. **KHÔNG** tích "Initialize with README"
5. Click "Create repository"

### 5. Kết nối và push
```bash
# Thay YOUR_USERNAME bằng username GitHub của bạn
git remote add origin https://github.com/YOUR_USERNAME/rectangle-packing-optimizer.git
git branch -M main
git push -u origin main
```

## ✅ Hoàn thành!

Dự án của bạn sẽ có sẵn tại:
`https://github.com/YOUR_USERNAME/rectangle-packing-optimizer`

## 📚 Tài liệu chi tiết

Xem file `GITHUB_SETUP.md` để biết hướng dẫn chi tiết hơn.

## 🔧 Lệnh Git hữu ích

```bash
# Xem trạng thái
git status

# Thêm thay đổi
git add .

# Commit
git commit -m "Mô tả thay đổi"

# Push lên GitHub
git push origin main

# Pull từ GitHub
git pull origin main
```

## 🆘 Hỗ trợ

Nếu gặp vấn đề, hãy kiểm tra:
1. Git đã được cài đặt chưa
2. Đã cấu hình user.name và user.email chưa
3. Repository trên GitHub đã được tạo chưa
4. URL remote origin có đúng không
