# 🎯 Tính Năng Kéo Thả & Chỉnh Sửa Layout

## 📋 Tổng Quan

Hệ thống đã được nâng cấp với khả năng chỉnh sửa layout trực tiếp bằng cách kéo thả, giống như AutoCAD. Người dùng có thể điều chỉnh vị trí các hình chữ nhật sau khi thuật toán tối ưu đã sắp xếp.

---

## ✨ Tính Năng Chính

### 1. **Chế Độ Chỉnh Sửa (Edit Mode)**
- Bật/tắt bằng nút "Bật Chỉnh Sửa" / "Đang Chỉnh Sửa"
- Khi bật, tất cả các hình chữ nhật có thể kéo thả
- Hiển thị các công cụ chỉnh sửa nâng cao

### 2. **Kéo Thả (Drag & Drop)**
- **Cách sử dụng:** Click và giữ chuột trái, kéo hình đến vị trí mong muốn
- **Trực quan:** Hình sẽ có hiệu ứng phóng to nhẹ khi đang kéo
- **Smooth:** Di chuyển mượt mà với transition

### 3. **Tự Động Canh Chỉnh (Auto-Snap)**
- **Grid Snapping:** Tự động căn chỉnh theo lưới 50mm
- **Edge Snapping:** Căn theo cạnh của các hình khác
- **Center Alignment:** Căn giữa với các hình khác
- **Độ nhạy:** Có thể điều chỉnh độ nhạy snap (5-30px)

### 4. **Chọn Nhiều Hình (Multi-Selection)**
- **Cách 1:** Giữ `Ctrl` (hoặc `Cmd` trên Mac) + Click để chọn nhiều hình
- **Cách 2:** Click vào vùng trống để bỏ chọn tất cả
- **Trực quan:** Các hình đã chọn có viền vàng và góc tròn

### 5. **Công Cụ Căn Chỉnh**
- **Căn Trái (⬅️):** Căn tất cả các hình đã chọn về cạnh trái
- **Căn Giữa (↕️):** Căn giữa theo chiều dọc
- **Căn Trên (⬆️):** Căn tất cả lên cạnh trên
- **Yêu cầu:** Phải chọn ít nhất 2 hình

### 6. **Xoay Hình (Rotate)**
- Click nút "🔄 Xoay" để xoay 90° các hình đã chọn
- Tự động hoán đổi chiều rộng và chiều dài
- Cập nhật trạng thái `rotated`

### 7. **Xóa Hình (Delete)**
- Click nút "🗑️ Xóa" để xóa các hình đã chọn
- Có xác nhận trước khi xóa
- Không thể hoàn tác (nên lưu trước khi xóa)

### 8. **Lưu & Hủy Thay Đổi**
- **💾 Lưu:** Lưu tất cả thay đổi vào hệ thống
- **❌ Hủy:** Hoàn tác tất cả thay đổi chưa lưu
- **Cảnh báo:** Hệ thống sẽ thông báo khi có thay đổi chưa lưu

---

## 🎮 Hướng Dẫn Sử Dụng

### Bước 1: Kích Hoạt Chế Độ Chỉnh Sửa
1. Sau khi thuật toán sắp xếp xong, click nút **"Bật Chỉnh Sửa"**
2. Giao diện sẽ chuyển sang màu xanh và hiển thị các công cụ

### Bước 2: Di Chuyển Hình
1. Click vào hình muốn di chuyển (hình sẽ có viền vàng)
2. Giữ chuột trái và kéo đến vị trí mong muốn
3. Thả chuột để đặt hình

### Bước 3: Sử Dụng Auto-Snap
- Khi kéo hình, các đường canh chỉnh màu xanh lá sẽ xuất hiện
- **Xanh lá (Grid):** Đang snap với lưới
- **Xanh dương (Align):** Đang căn với hình khác
- Hình sẽ tự động "dính" vào vị trí gần nhất

### Bước 4: Chọn Nhiều & Căn Chỉnh
1. Giữ `Ctrl` và click vào các hình muốn chọn
2. Click nút căn chỉnh (Trái, Giữa, Trên) để sắp xếp
3. Các hình sẽ tự động di chuyển đến vị trí căn chỉnh

### Bước 5: Lưu Kết Quả
1. Sau khi hoàn thành chỉnh sửa, click **"💾 Lưu"**
2. Hệ thống sẽ lưu layout mới
3. Có thể thoát chế độ chỉnh sửa bằng nút **"❌ Hủy"**

---

## ⌨️ Phím Tắt (Keyboard Shortcuts)

| Phím | Chức năng |
|------|-----------|
| `Ctrl + Click` | Chọn/bỏ chọn nhiều hình |
| `Delete` | Xóa hình đã chọn *(coming soon)* |
| `Ctrl + Z` | Hoàn tác *(coming soon)* |
| `Ctrl + Y` | Làm lại *(coming soon)* |
| `R` | Xoay 90° *(coming soon)* |
| `Escape` | Bỏ chọn tất cả *(coming soon)* |

---

## 🎨 Giao Diện & Trực Quan

### Màu Sắc Snap Lines
- **🟢 Xanh Lá:** Grid snapping (lưới 50mm)
- **🔵 Xanh Dương:** Edge alignment (căn cạnh)
- **🟡 Vàng:** Selected rectangles (đã chọn)

### Trạng Thái Hình
- **Bình Thường:** Border trắng, có shadow nhẹ
- **Hover:** Scale 1.02x, shadow đậm hơn
- **Đang Kéo:** Scale 1.05x, opacity 70%
- **Đã Chọn:** Border vàng 4px, có 4 góc tròn vàng

---

## 🔧 Cấu Hình Nâng Cao

### Điều Chỉnh Độ Nhạy Snap
1. Trong chế độ chỉnh sửa, tìm thanh trượt "Độ nhạy"
2. Kéo sang trái = ít nhạy hơn (5px)
3. Kéo sang phải = nhạy hơn (30px)
4. Mặc định: 10px

### Tắt Auto-Snap
- Bỏ tick ô "Tự động canh"
- Hình sẽ di chuyển tự do không bị snap

---

## 🐛 Xử Lý Lỗi & Giới Hạn

### Giới Hạn Hiện Tại
- ⚠️ Không kiểm tra chồng lấn khi di chuyển
- ⚠️ Chưa có undo/redo
- ⚠️ Không lưu lịch sử thay đổi vào database
- ⚠️ Chưa hỗ trợ resize hình

### Lưu Ý
- Luôn **lưu** trước khi thoát chế độ chỉnh sửa
- Nếu làm sai, click **"Hủy"** để reset
- Grid snapping hoạt động tốt nhất với lưới 50mm

---

## 🚀 Tính Năng Sắp Tới (Roadmap)

- [ ] **Undo/Redo System** - Hoàn tác nhiều bước
- [ ] **Keyboard Shortcuts** - Phím tắt đầy đủ
- [ ] **Collision Detection** - Cảnh báo khi hình chồng lấn
- [ ] **Resize Handles** - Thay đổi kích thước hình
- [ ] **Group Selection** - Nhóm nhiều hình lại
- [ ] **Copy/Paste** - Sao chép hình
- [ ] **Measurement Tools** - Đo khoảng cách
- [ ] **Export to DXF** - Xuất file AutoCAD
- [ ] **History Log** - Lịch sử thay đổi chi tiết

---

## 📦 Files Liên Quan

### Components
- `DraggableRectangle.js` - Component hình có thể kéo
- `EditModeControls.js` - Bảng điều khiển chỉnh sửa
- `PackingResult.js` - Component chính (đã cập nhật)

### Utilities
- `geometryUtils.js` - Hàm tiện ích hình học
- `DraggableStyles.css` - CSS cho drag & drop

### Updated Files
- `index.css` - Thêm class mới cho edit mode

---

## 💡 Tips & Tricks

1. **Căn Chỉnh Nhanh:** Chọn tất cả hình cùng loại → Căn trái → Căn trên
2. **Di Chuyển Tinh:** Tắt auto-snap để di chuyển chính xác pixel
3. **Kiểm Tra Trước Khi Lưu:** Zoom out để xem toàn bộ layout trước khi lưu
4. **Snap With Confidence:** Màu xanh lá = an toàn, hình đang căn đúng grid

---

## 📞 Hỗ Trợ

Nếu gặp lỗi hoặc có đề xuất, vui lòng liên hệ team phát triển hoặc tạo issue trên repository.

---

**Version:** 2.0.0  
**Last Updated:** November 2025  
**Author:** Development Team