const Rectangle = require('../models/Rectangle');

class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.rectangles = [];
    this.layers = 1;
    this.results = [];
  }

  // Thuật toán chính để tối ưu sắp xếp
  async optimize(container, rectangles, layers) {
    this.container = container;
    this.rectangles = rectangles;
    this.layers = layers;
    this.results = [];

    // Sắp xếp hình chữ nhật theo diện tích giảm dần (First Fit Decreasing)
    const sortedRectangles = this.sortRectanglesByArea(rectangles);
    
    // Thử các chiến lược khác nhau
    const strategies = [
      () => this.bottomLeftFill(),
      () => this.bestFitDecreasing(),
      () => this.nextFitDecreasing()
    ];

    let bestResult = null;
    let bestEfficiency = 0;

    for (let layer = 0; layer < layers; layer++) {
      for (const strategy of strategies) {
        const result = await strategy();
        if (result && result.efficiency > bestEfficiency) {
          bestResult = result;
          bestEfficiency = result.efficiency;
        }
      }
    }

    return bestResult || this.getEmptyResult();
  }

  // Sắp xếp hình chữ nhật theo diện tích giảm dần
  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaB - areaA;
    });
  }

  // Chiến lược Bottom-Left Fill
  bottomLeftFill() {
    const placedRectangles = [];
    const freeSpaces = [{
      x: 0,
      y: 0,
      width: this.container.width,
      height: this.container.height
    }];

    for (const rect of this.rectangles) {
      let placed = false;
      
      // Thử đặt hình chữ nhật ở vị trí bottom-left nhất có thể
      for (let i = 0; i < freeSpaces.length; i++) {
        const space = freeSpaces[i];
        
        if (this.canFitInSpace(rect, space)) {
          const placedRect = this.placeRectangle(rect, space);
          placedRectangles.push(placedRect);
          
          // Cập nhật free spaces
          this.updateFreeSpaces(freeSpaces, placedRect, space);
          placed = true;
          break;
        }
      }
      
      if (!placed) {
        // Thử xoay hình chữ nhật
        const rotatedRect = { ...rect };
        [rotatedRect.width, rotatedRect.height] = [rotatedRect.height, rotatedRect.width];
        rotatedRect.rotated = true;
        
        for (let i = 0; i < freeSpaces.length; i++) {
          const space = freeSpaces[i];
          
          if (this.canFitInSpace(rotatedRect, space)) {
            const placedRect = this.placeRectangle(rotatedRect, space);
            placedRectangles.push(placedRect);
            
            this.updateFreeSpaces(freeSpaces, placedRect, space);
            placed = true;
            break;
          }
        }
      }
    }

    return this.calculateResult(placedRectangles);
  }

  // Chiến lược Best Fit Decreasing
  bestFitDecreasing() {
    const placedRectangles = [];
    const freeSpaces = [{
      x: 0,
      y: 0,
      width: this.container.width,
      height: this.container.height
    }];

    for (const rect of this.rectangles) {
      let bestSpace = null;
      let bestWaste = Infinity;
      
      // Tìm không gian phù hợp nhất
      for (const space of freeSpaces) {
        if (this.canFitInSpace(rect, space)) {
          const waste = this.calculateWaste(rect, space);
          if (waste < bestWaste) {
            bestWaste = waste;
            bestSpace = space;
          }
        }
      }
      
      if (bestSpace) {
        const placedRect = this.placeRectangle(rect, bestSpace);
        placedRectangles.push(placedRect);
        this.updateFreeSpaces(freeSpaces, placedRect, bestSpace);
      }
    }

    return this.calculateResult(placedRectangles);
  }

  // Chiến lược Next Fit Decreasing
  nextFitDecreasing() {
    const placedRectangles = [];
    let currentX = 0;
    let currentY = 0;
    let currentHeight = 0;

    for (const rect of this.rectangles) {
      // Kiểm tra xem có thể đặt ở vị trí hiện tại không
      if (currentX + rect.width <= this.container.width && 
          currentY + rect.height <= this.container.height) {
        
        const placedRect = {
          ...rect,
          x: currentX,
          y: currentY,
          layer: 0
        };
        
        placedRectangles.push(placedRect);
        currentX += rect.width;
        currentHeight = Math.max(currentHeight, rect.height);
      } else {
        // Chuyển sang hàng mới
        currentX = 0;
        currentY += currentHeight;
        currentHeight = 0;
        
        if (currentY + rect.height <= this.container.height) {
          const placedRect = {
            ...rect,
            x: currentX,
            y: currentY,
            layer: 0
          };
          
          placedRectangles.push(placedRect);
          currentX += rect.width;
          currentHeight = rect.height;
        }
      }
    }

    return this.calculateResult(placedRectangles);
  }

  // Kiểm tra xem hình chữ nhật có vừa trong không gian không
  canFitInSpace(rect, space) {
    return rect.width <= space.width && rect.height <= space.height;
  }

  // Đặt hình chữ nhật vào không gian
  placeRectangle(rect, space) {
    return {
      ...rect,
      x: space.x,
      y: space.y,
      layer: 0
    };
  }

  // Cập nhật các không gian trống
  updateFreeSpaces(freeSpaces, placedRect, usedSpace) {
    const newSpaces = [];
    
    // Không gian bên phải
    if (placedRect.x + placedRect.width < usedSpace.x + usedSpace.width) {
      newSpaces.push({
        x: placedRect.x + placedRect.width,
        y: usedSpace.y,
        width: usedSpace.x + usedSpace.width - (placedRect.x + placedRect.width),
        height: usedSpace.height
      });
    }
    
    // Không gian phía trên
    if (placedRect.y + placedRect.height < usedSpace.y + usedSpace.height) {
      newSpaces.push({
        x: usedSpace.x,
        y: placedRect.y + placedRect.height,
        width: usedSpace.width,
        height: usedSpace.y + usedSpace.height - (placedRect.y + placedRect.height)
      });
    }
    
    // Xóa không gian đã sử dụng
    const index = freeSpaces.indexOf(usedSpace);
    if (index > -1) {
      freeSpaces.splice(index, 1);
    }
    
    // Thêm không gian mới
    freeSpaces.push(...newSpaces);
  }

  // Tính toán waste (không gian lãng phí)
  calculateWaste(rect, space) {
    return (space.width * space.height) - (rect.width * rect.height);
  }

  // Tính toán kết quả
  calculateResult(placedRectangles) {
    const totalArea = this.container.width * this.container.height;
    const usedArea = placedRectangles.reduce((sum, rect) => 
      sum + (rect.width * rect.height), 0
    );
    
    const efficiency = (usedArea / totalArea) * 100;
    
    return {
      rectangles: placedRectangles,
      efficiency: efficiency,
      usedArea: usedArea,
      totalArea: totalArea,
      wasteArea: totalArea - usedArea,
      layer: 0
    };
  }

  // Kết quả rỗng
  getEmptyResult() {
    return {
      rectangles: [],
      efficiency: 0,
      usedArea: 0,
      totalArea: this.container.width * this.container.height,
      wasteArea: this.container.width * this.container.height,
      layer: 0
    };
  }
}

module.exports = PackingAlgorithm;
