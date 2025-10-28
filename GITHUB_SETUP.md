# 🚀 Hướng dẫn đưa dự án lên GitHub

## Bước 1: Cài đặt Git (nếu chưa có)

### Windows:
1. Tải Git từ: https://git-scm.com/download/win
2. Cài đặt với cài đặt mặc định
3. Mở Git Bash hoặc Command Prompt

### macOS:
```bash
# Sử dụng Homebrew
brew install git

# Hoặc tải từ: https://git-scm.com/download/mac
```

### Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install git
```

## Bước 2: Cấu hình Git

```bash
# Cấu hình tên người dùng
git config --global user.name "Tên của bạn"

# Cấu hình email
git config --global user.email "email@example.com"

# Kiểm tra cấu hình
git config --list
```

## Bước 3: Khởi tạo Git repository

```bash
# Di chuyển vào thư mục dự án
cd C:\Users\long.nh\Desktop\AutoLayout

# Khởi tạo Git repository
git init

# Thêm tất cả files vào staging
git add .

# Commit lần đầu
git commit -m "Initial commit: Rectangle Packing Optimizer with Tailwind CSS and Electron"
```

## Bước 4: Tạo repository trên GitHub

1. Truy cập: https://github.com
2. Đăng nhập vào tài khoản GitHub
3. Click nút **"New"** hoặc **"+"** → **"New repository"**
4. Điền thông tin:
   - **Repository name**: `rectangle-packing-optimizer`
   - **Description**: `Ứng dụng desktop tối ưu sắp xếp hình chữ nhật với thuật toán 2D bin packing`
   - **Visibility**: Public hoặc Private (tùy chọn)
   - **Initialize**: ❌ Không tích (vì đã có code)
5. Click **"Create repository"**

## Bước 5: Kết nối local repository với GitHub

```bash
# Thêm remote origin (thay YOUR_USERNAME bằng username GitHub của bạn)
git remote add origin https://github.com/YOUR_USERNAME/rectangle-packing-optimizer.git

# Kiểm tra remote
git remote -v

# Push code lên GitHub
git branch -M main
git push -u origin main
```

## Bước 6: Tạo README.md đẹp

Tạo file `README.md` với nội dung:

```markdown
# 📦 Rectangle Packing Optimizer

Ứng dụng desktop offline tối ưu sắp xếp các hình chữ nhật nhỏ vào hình chữ nhật lớn sử dụng thuật toán 2D bin packing.

![Demo](https://via.placeholder.com/800x400/667eea/ffffff?text=Rectangle+Packing+Optimizer)

## ✨ Tính năng chính

- 🎯 **Tối ưu sắp xếp** với thuật toán 2D bin packing tiên tiến
- 🎨 **Giao diện trực quan** với Tailwind CSS và màu sắc phân biệt
- 📦 **Hỗ trợ nhiều lớp** sắp xếp
- 🔌 **Kết nối Modbus TCP/IP** với PLC
- 💻 **Ứng dụng desktop** với Electron
- 📱 **Responsive design** cho mọi kích thước màn hình
- 💾 **Offline mode** hoàn toàn

## 🚀 Cài đặt và chạy

### Yêu cầu hệ thống
- Node.js 16+
- npm hoặc yarn
- Windows 10+, macOS 10.14+, hoặc Linux

### Cài đặt
```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/rectangle-packing-optimizer.git
cd rectangle-packing-optimizer

# Cài đặt dependencies
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

## 🛠️ Công nghệ sử dụng

- **Frontend**: React 18, Tailwind CSS, Electron
- **Backend**: Node.js, Express, Socket.io
- **Algorithms**: 2D Bin Packing, Best Fit Decreasing
- **Communication**: Modbus TCP/IP

## 📖 Hướng dẫn sử dụng

1. **Cấu hình Container**: Nhập kích thước và số lớp
2. **Chọn hình chữ nhật**: Click để chọn và nhập số lượng
3. **Tối ưu sắp xếp**: Click "Tối ưu sắp xếp"
4. **Xem kết quả**: Layout trực quan với hiệu suất

## 📦 Đóng gói ứng dụng

```bash
# Windows
npm run electron-pack

# macOS
cd client && npm run electron-pack -- --mac

# Linux
cd client && npm run electron-pack -- --linux
```

## 🤝 Đóng góp

1. Fork dự án
2. Tạo feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Tạo Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## 📞 Liên hệ

- **Tác giả**: Tên của bạn
- **Email**: email@example.com
- **GitHub**: [@yourusername](https://github.com/yourusername)

## 🙏 Acknowledgments

- Thuật toán 2D bin packing
- Tailwind CSS framework
- Electron desktop framework
- React community
```

## Bước 7: Cập nhật .gitignore

Đảm bảo file `.gitignore` đã có sẵn và bao gồm:

```gitignore
# Dependencies
node_modules/
client/node_modules/

# Production builds
client/build/
dist/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory
coverage/

# Dependency directories
jspm_packages/

# Optional npm cache
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless/

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/

# TernJS port file
.tern-port

# Stores VSCode versions used for testing VSCode extensions
.vscode-test

# Electron build output
dist/
build/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Windows image file caches
Thumbs.db
ehthumbs.db

# Folder config file
Desktop.ini

# Recycle Bin used on file shares
$RECYCLE.BIN/

# Windows Installer files
*.cab
*.msi
*.msm
*.msp

# Windows shortcuts
*.lnk
```

## Bước 8: Push code lên GitHub

```bash
# Kiểm tra trạng thái
git status

# Thêm tất cả thay đổi
git add .

# Commit với message mô tả
git commit -m "Add comprehensive documentation and setup files"

# Push lên GitHub
git push origin main
```

## Bước 9: Tạo GitHub Pages (Tùy chọn)

Nếu muốn tạo website demo:

1. Vào **Settings** của repository
2. Scroll xuống **Pages**
3. Chọn **Source**: Deploy from a branch
4. Chọn **Branch**: main
5. Chọn **Folder**: / (root)
6. Click **Save**

## Bước 10: Tạo Release (Tùy chọn)

1. Vào **Releases** trong repository
2. Click **Create a new release**
3. Điền thông tin:
   - **Tag version**: v1.0.0
   - **Release title**: Rectangle Packing Optimizer v1.0.0
   - **Description**: Mô tả chi tiết về release
4. Click **Publish release**

## 🔧 Lệnh Git hữu ích

```bash
# Xem trạng thái
git status

# Xem lịch sử commit
git log --oneline

# Xem thay đổi
git diff

# Undo thay đổi chưa commit
git checkout -- <file>

# Undo commit cuối
git reset --soft HEAD~1

# Xem remote
git remote -v

# Thay đổi remote URL
git remote set-url origin <new-url>

# Pull thay đổi từ GitHub
git pull origin main

# Push thay đổi lên GitHub
git push origin main
```

## 🎉 Hoàn thành!

Sau khi hoàn thành các bước trên, dự án của bạn sẽ có sẵn trên GitHub tại:
`https://github.com/YOUR_USERNAME/rectangle-packing-optimizer`

### Các tính năng GitHub bạn có thể sử dụng:

- **Issues**: Theo dõi bugs và feature requests
- **Projects**: Quản lý dự án với Kanban board
- **Wiki**: Tạo tài liệu chi tiết
- **Discussions**: Thảo luận với cộng đồng
- **Actions**: CI/CD tự động
- **Releases**: Phân phối phiên bản

Chúc bạn thành công! 🚀
