import Rectangle from '../models/Rectangle.js';

class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.layers = 1;
  }

  // Sắp xếp hình chữ nhật theo diện tích giảm dần
  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaB - areaA;
    });
  }

  // --- Core 2D Packing Logic (Chọn chiến lược tốt nhất cho 1 lớp) ---
  run2DPacking(rectanglesToPack) {
    const sortedRectangles = this.sortRectanglesByArea(rectanglesToPack);

    const strategies = [
      () => this._bottomLeftFill(sortedRectangles),
      () => this._bestFitDecreasing(sortedRectangles),
      () => this._nextFitDecreasing(sortedRectangles)
    ];

    let bestResult = { placed: [], remaining: sortedRectangles };
    let bestUsedArea = 0;

    for (const strategy of strategies) {
        const { placed: currentPlaced, remaining: currentRemaining } = strategy();
        const currentUsedArea = currentPlaced.reduce((sum, rect) => sum + (rect.width * rect.height), 0);
        
        if (currentUsedArea > bestUsedArea) {
            bestUsedArea = currentUsedArea;
            bestResult = { placed: currentPlaced, remaining: currentRemaining };
        }
    }

    return bestResult;
  }

  // --- Implementations of 2D Packing Algorithms ---

  _bottomLeftFill(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    const remainingRectangles = [];
    const freeSpaces = [{
      x: 0,
      y: 0,
      width: this.container.width,
      height: this.container.height
    }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      
      let bestSpaceIndex = -1;
      let bestWaste = Infinity;
      let isRotated = false;

      // Check normal and rotated fit for minimum waste (Best Fit-like selection)
      const attempts = [
          { rect: rect, rotated: false },
          { rect: { ...rect, width: rect.height, height: rect.width }, rotated: true }
      ];

      for (const attempt of attempts) {
          for (let i = 0; i < freeSpaces.length; i++) {
              const space = freeSpaces[i];
              if (this.canFitInSpace(attempt.rect, space)) {
                  const waste = this.calculateWaste(attempt.rect, space);
                  if (waste < bestWaste) {
                      bestWaste = waste;
                      bestSpaceIndex = i;
                      isRotated = attempt.rotated;
                  }
              }
          }
      }
      
      if (bestSpaceIndex !== -1) {
        const bestSpace = freeSpaces[bestSpaceIndex];
        let placedRect;
        
        if (isRotated) {
          placedRect = this.placeRectangle({ ...rect, width: rect.height, height: rect.width, rotated: true }, bestSpace);
        } else {
          placedRect = this.placeRectangle(rect, bestSpace);
        }
        
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        this.updateFreeSpaces(freeSpaces, placedRect, bestSpace, bestSpaceIndex);
      }
    }

    for (const rect of rectanglesToPack) {
        if (!usedRectIds.has(rect.id)) {
            remainingRectangles.push(rect);
        }
    }

    return { placed: placedRectangles, remaining: remainingRectangles };
  }

  _bestFitDecreasing(rectanglesToPack) {
    // This implementation is structurally similar to BLF in its space-search/placement loop, 
    // honoring the initial sort by area (Decreasing) and min-waste placement (Best Fit).
    return this._bottomLeftFill(rectanglesToPack); 
  }

  _nextFitDecreasing(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    const remainingRectangles = [];
    
    let currentX = 0;
    let currentY = 0;
    let currentHeight = 0; // Height of the current row

    for (const rect of rectanglesToPack) {
        if (usedRectIds.has(rect.id)) continue;
        
        let width = rect.width;
        let height = rect.height;
        let rotated = false;

        // Try placement (including rotation check)
        const checkFitAndRotate = (x, y, w, h) => {
            const fitNormal = (x + w <= this.container.width && y + h <= this.container.height);
            const fitRotated = (x + h <= this.container.width && y + w <= this.container.height);
            
            if (fitNormal) return { w, h, rotated: false };
            if (fitRotated) return { w: h, h: w, rotated: true };
            return null;
        };

        let placement = checkFitAndRotate(currentX, currentY, width, height);

        if (!placement) {
            // Move to the next row
            currentX = 0;
            currentY += currentHeight;
            currentHeight = 0;
            
            placement = checkFitAndRotate(currentX, currentY, width, height);
            
            if (!placement) {
                // Cannot fit in this layer even in a new row
                remainingRectangles.push(rect);
                continue;
            }
        }
        
        // Place the determined rectangle
        const placedRect = {
            ...rect,
            width: placement.w,
            height: placement.h,
            x: currentX,
            y: currentY,
            layer: 0,
            rotated: placement.rotated
        };
        
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        
        // Update row position and height
        currentX += placement.w;
        currentHeight = Math.max(currentHeight, placement.h);

        if (currentX >= this.container.width) {
            currentX = 0;
            currentY += currentHeight;
            currentHeight = 0;
        }
    }

    for (const rect of rectanglesToPack) {
        if (!usedRectIds.has(rect.id)) {
            remainingRectangles.push(rect);
        }
    }

    return { placed: placedRectangles, remaining: remainingRectangles };
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
      layer: 0 // Sẽ được gán lại trong hàm optimize chính
    };
  }
  
  // Cập nhật các không gian trống (Phân chia khu vực)
  updateFreeSpaces(freeSpaces, placedRect, usedSpace, index) {
    // Loại bỏ không gian đã sử dụng
    freeSpaces.splice(index, 1);

    // Không gian mới bên phải
    if (placedRect.x + placedRect.width < usedSpace.x + usedSpace.width) {
      freeSpaces.push({
        x: placedRect.x + placedRect.width,
        y: usedSpace.y,
        width: usedSpace.x + usedSpace.width - (placedRect.x + placedRect.width),
        height: placedRect.height
      });
    }

    // Không gian mới phía trên
    if (placedRect.y + placedRect.height < usedSpace.y + usedSpace.height) {
      freeSpaces.push({
        x: usedSpace.x,
        y: placedRect.y + placedRect.height,
        width: usedSpace.width,
        height: usedSpace.y + usedSpace.height - (placedRect.y + placedRect.height)
      });
    }

    // Sắp xếp lại các không gian trống (BLF strategy: ưu tiên Y thấp nhất, sau đó là X thấp nhất)
    freeSpaces.sort((a, b) => a.y - b.y || a.x - b.x); 
  }

  calculateWaste(rect, space) {
    return (space.width * space.height) - (rect.width * rect.height);
  }

  // --- Main Optimization for Minimum Layers (Xếp lớp Tham Lam) ---
  async optimize(container, initialRectangles, maxLayers) {
    this.container = container;
    this.layers = maxLayers;
    
    // Bắt đầu với bản sao của tất cả các hình chữ nhật cần đóng gói
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
    let allPlacedRectangles = [];
    let layersUsed = 0;

    for (let layer = 0; layer < maxLayers && unpackedRectangles.length > 0; layer++) {
      
      // Chạy thuật toán 2D tốt nhất trên các hình còn lại
      const { placed: placedInLayer, remaining: remainingAfterLayer } = this.run2DPacking(unpackedRectangles);
      
      // Nếu không xếp được hình nào và vẫn còn hình cần xếp, dừng lại vì không thể xếp được nữa
      if (placedInLayer.length === 0 && unpackedRectangles.length > 0) {
        break; 
      }
      
      // Đánh dấu lớp hiện tại cho các hình đã xếp
      placedInLayer.forEach(rect => {
        rect.layer = layer;
        allPlacedRectangles.push(rect);
      });
      
      unpackedRectangles = remainingAfterLayer;
      layersUsed++;
    }

    // Tính toán các chỉ số cuối cùng
    const containerAreaPerLayer = container.width * container.height;
    
    const finalUsedArea = allPlacedRectangles.reduce((sum, rect) => 
      sum + (rect.width * rect.height), 0
    );
    
    // Tổng diện tích lý thuyết tối đa (maxLayers * diện tích 1 lớp)
    const maxTotalArea = containerAreaPerLayer * container.layers;

    return {
      rectangles: allPlacedRectangles,
      // Tính hiệu suất dựa trên tổng diện tích lý thuyết tối đa (container.layers)
      efficiency: maxTotalArea > 0 ? (finalUsedArea / maxTotalArea) * 100 : 0, 
      usedArea: finalUsedArea,
      totalArea: maxTotalArea, 
      wasteArea: maxTotalArea - finalUsedArea,
      layersUsed: layersUsed
    };
  }
}

export default PackingAlgorithm;