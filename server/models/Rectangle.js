// client/src/components/Rectangle.js - ĐÃ SỬA LỖI
class Rectangle {
  constructor(id, width, length, color = '#000000', name = '') {
    this.id = id;
    this.width = width;
    this.length = length;
    this.color = color;
    this.name = name;
    this.x = 0;
    this.y = 0;
    this.rotated = false;
    this.layer = 0;

    // ✅ Thêm các thuộc tính metadata
    this.typeId = id; // Mặc định
    this.originalTypeId = id; // Mặc định
    this.pairId = null;
    this.pieceIndex = 0;
    this.splitDirection = 'none';
    this.originalWidth = width;
    this.originalLength = length;
    this.transform = null;
  }

  // Xoay hình chữ nhật 90 độ
  rotate() {
    this.rotated = !this.rotated;
    [this.width, this.length] = [this.length, this.width];
  }

  // Lấy kích thước hiện tại (có thể đã xoay)
  getCurrentWidth() {
    return this.width;
  }

  getCurrentLength() {
    return this.length;
  }

  // Kiểm tra xem hình chữ nhật có vừa với container không
  fitsIn(containerWidth, containerLength) {
    return this.width <= containerWidth && this.length <= containerLength;
  }

  // Tính diện tích
  getArea() {
    return this.width * this.length;
  }

  // Tính tỷ lệ khung hình
  getAspectRatio() {
    return this.width / this.length;
  }

  // Sao chép hình chữ nhật
  clone() {
    const cloned = new Rectangle(this.id, this.width, this.length, this.color, this.name);
    cloned.x = this.x;
    cloned.y = this.y;
    cloned.rotated = this.rotated;
    cloned.layer = this.layer;
    
    // ✅ Sao chép metadata
    cloned.typeId = this.typeId;
    cloned.originalTypeId = this.originalTypeId;
    cloned.pairId = this.pairId;
    cloned.pieceIndex = this.pieceIndex;
    cloned.splitDirection = this.splitDirection;
    cloned.originalWidth = this.originalWidth;
    cloned.originalLength = this.originalLength;
    cloned.transform = this.transform ? { ...this.transform } : null;

    return cloned;
  }

  // Chuyển đổi thành object JSON
  toJSON() {
    return {
      id: this.id,
      width: this.width,
      length: this.length,
      color: this.color,
      name: this.name,
      x: this.x,
      y: this.y,
      rotated: this.rotated,
      layer: this.layer,
      
      // ✅ Thêm metadata vào JSON
      typeId: this.typeId,
      originalTypeId: this.originalTypeId,
      pairId: this.pairId,
      pieceIndex: this.pieceIndex,
      splitDirection: this.splitDirection,
      originalWidth: this.originalWidth,
      originalLength: this.originalLength,
      transform: this.transform
    };
  }

  // Tạo từ object JSON
  static fromJSON(data) {
    const rect = new Rectangle(data.id, data.width, data.length, data.color, data.name);
    rect.x = data.x || 0;
    rect.y = data.y || 0;
    rect.rotated = data.rotated || false;
    rect.layer = data.layer || 0;

    // ✅ Khôi phục metadata từ JSON
    rect.typeId = data.typeId ?? data.id;
    rect.originalTypeId = data.originalTypeId ?? data.id;
    rect.pairId = data.pairId ?? null;
    rect.pieceIndex = data.pieceIndex ?? 0;
    rect.splitDirection = data.splitDirection ?? 'none';
    rect.originalWidth = data.originalWidth ?? data.width;
    rect.originalLength = data.originalLength ?? data.length;
    rect.transform = data.transform ?? null;

    return rect;
  }
}

export default Rectangle;