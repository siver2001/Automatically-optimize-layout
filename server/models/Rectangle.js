class Rectangle {
  constructor(id, width, height, color = '#000000', name = '') {
    this.id = id;
    this.width = width;
    this.height = height;
    this.color = color;
    this.name = name;
    this.x = 0;
    this.y = 0;
    this.rotated = false;
    this.layer = 0;
  }

  // Xoay hình chữ nhật 90 độ
  rotate() {
    this.rotated = !this.rotated;
    [this.width, this.height] = [this.height, this.width];
  }

  // Lấy kích thước hiện tại (có thể đã xoay)
  getCurrentWidth() {
    return this.width;
  }

  getCurrentHeight() {
    return this.height;
  }

  // Kiểm tra xem hình chữ nhật có vừa với container không
  fitsIn(containerWidth, containerHeight) {
    return this.width <= containerWidth && this.height <= containerHeight;
  }

  // Tính diện tích
  getArea() {
    return this.width * this.height;
  }

  // Tính tỷ lệ khung hình
  getAspectRatio() {
    return this.width / this.height;
  }

  // Sao chép hình chữ nhật
  clone() {
    const cloned = new Rectangle(this.id, this.width, this.height, this.color, this.name);
    cloned.x = this.x;
    cloned.y = this.y;
    cloned.rotated = this.rotated;
    cloned.layer = this.layer;
    return cloned;
  }

  // Chuyển đổi thành object JSON
  toJSON() {
    return {
      id: this.id,
      width: this.width,
      height: this.height,
      color: this.color,
      name: this.name,
      x: this.x,
      y: this.y,
      rotated: this.rotated,
      layer: this.layer
    };
  }

  // Tạo từ object JSON
  static fromJSON(data) {
    const rect = new Rectangle(data.id, data.width, data.height, data.color, data.name);
    rect.x = data.x || 0;
    rect.y = data.y || 0;
    rect.rotated = data.rotated || false;
    rect.layer = data.layer || 0;
    return rect;
  }
}

module.exports = Rectangle;
