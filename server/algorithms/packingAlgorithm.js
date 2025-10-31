// server/algorithms/packingAlgorithm.js
// Đã xóa: import DxfWriter from 'dxf-writer';
class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.layers = 1;
  }

  // Sắp xếp hình chữ nhật theo diện tích giảm dần
  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.length;
      const areaB = b.width * b.length;
      return areaB - areaA;
    });
  }

  // Shuffle (Hoán vị ngẫu nhiên) for meta-heuristic
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  // --- HÀM MỚI: Chạy thuật toán 2D đóng gói đơn lớp (KHÔNG XOAY TẠI CHỖ) ---
  _runSingleLayerPacking(rectanglesToPack) {
    // Luôn chạy với các hình chữ nhật đã có kích thước cố định (đã được quyết định xoay hay chưa)
    const sortedRectangles = rectanglesToPack; 

    // Các chiến lược sẽ được chạy để tìm kết quả tốt nhất cho lớp này
    const strategies = [
      () => this._maxRectsBSSF(sortedRectangles),
      () => this._bottomLeftFill(sortedRectangles),
      () => this._bestFitDecreasing(sortedRectangles),
      () => this._nextFitDecreasing(sortedRectangles)
    ];

    let bestResult = { placed: [], remaining: sortedRectangles };
    let bestUsedArea = 0;

    for (const strategy of strategies) {
        // Cần truyền bản sao của rectanglesToPack để mỗi chiến lược bắt đầu với cùng một trạng thái
        const { placed: currentPlaced, remaining: currentRemaining } = strategy(rectanglesToPack.map(r => ({...r})));
        const currentUsedArea = currentPlaced.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        
        if (currentUsedArea > bestUsedArea) {
            bestUsedArea = currentUsedArea;
            // Sao chép kết quả để không bị ảnh hưởng bởi các lần chạy tiếp theo
            bestResult = { 
              placed: currentPlaced.map(r => ({...r, layer: 0})), 
              remaining: currentRemaining.map(r => ({...r})) 
          };
        }
    }

    return bestResult;
  }
  
  // --- HÀM MỚI: Xác định hướng xoay tối ưu (0 độ hoặc 90 độ) cho mỗi loại ---
  determineOptimalRotations(container, allRectangles) {
      // Map: typeId -> shouldRotate (boolean)
      const optimalRotations = new Map(); 
      
      // Tập hợp các thông tin loại hình gốc (typeId) và bản sao đại diện
      const originalTypeDetails = allRectangles.reduce((acc, rect) => {
          acc[rect.typeId] = acc[rect.typeId] || { rect: rect, count: 0 };
          acc[rect.typeId].count++;
          return acc;
      }, {});

      for (const typeId in originalTypeDetails) {
          const originalRect = originalTypeDetails[typeId].rect;
          // Lấy tất cả các bản sao của loại này để kiểm tra (chỉ cần dùng 1 bản sao cũng được, 
          // nhưng dùng tất cả sẽ cho kết quả sát hơn với thực tế)
          const rectsOfType = allRectangles.filter(r => r.typeId === Number(typeId));
          const sortedForTest = this.sortRectanglesByArea(rectsOfType);


          // 1. Kiểm tra trường hợp KHÔNG xoay
          // Sử dụng kích thước gốc
          const rectsNoRotate = sortedForTest.map(r => ({ ...r, width: originalRect.width, length: originalRect.length, rotated: false }));
          const resultNoRotate = this._runSingleLayerPacking(rectsNoRotate);
          const placedCountNoRotate = resultNoRotate.placed.length;

          // 2. Kiểm tra trường hợp XOAY 90 độ
          // Hoán đổi kích thước
          const rectsRotated = sortedForTest.map(r => ({ ...r, width: originalRect.length, length: originalRect.width, rotated: true }));
          const resultRotated = this._runSingleLayerPacking(rectsRotated);
          const placedCountRotated = resultRotated.placed.length;

          // Chọn hướng nào tối đa hóa số lượng hình được đặt
          if (placedCountRotated > placedCountNoRotate) {
              optimalRotations.set(Number(typeId), true);
          } else {
              optimalRotations.set(Number(typeId), false);
          }
      }
      return optimalRotations;
  }

  // --- Core 2D Packing Logic (Đã được đơn giản hóa) ---
  run2DPacking(rectanglesToPack) {
    // Chỉ là một wrapper cho _runSingleLayerPacking
    return this._runSingleLayerPacking(rectanglesToPack);
  }

  // --- Implementations of 2D Packing Algorithms (KHÔNG XOAY TẠI CHỖ) ---

  _maxRectsBSSF(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    // Tạo bản sao FreeNodes cho mỗi lần chạy chiến lược
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    const fitsIn = (rect, node) => rect.width <= node.width && rect.length <= node.length;

    const scoreFor = (rect, node) => {
      const dw = node.width - rect.width;
      const dh = node.length - rect.length;
      const shortFit = Math.min(dw, dh);
      const longFit = Math.max(dw, dh);
      return { shortFit, longFit };
    };
    
    const splitFreeNode = (node, placed) => {
      const newNodes = [];
      // Split to right
      if (placed.x + placed.width < node.x + node.width) {
        newNodes.push({
          x: placed.x + placed.width,
          y: node.y,
          width: node.x + node.width - (placed.x + placed.width),
          length: node.length
        });
      }
      // Split above
      if (placed.y + placed.length < node.y + node.length) {
        newNodes.push({
          x: node.x,
          y: placed.y + placed.length,
          width: node.width,
          length: node.y + node.length - (placed.y + placed.length)
        });
      }
      return newNodes;
    };

    const rectContains = (a, b) => a.x <= b.x && a.y <= b.y && (a.x + a.width) >= (b.x + b.width) && (a.y + a.length) >= (b.y + b.length);

    const pruneFreeList = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = nodes.length - 1; j >= 0; j--) {
          if (i !== j && rectContains(nodes[i], nodes[j])) {
            nodes.splice(j, 1);
          }
        }
      }
    };


    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;

      let bestIndex = -1;
      let bestShort = Infinity;
      let bestLong = Infinity;
      let chosenNode = null;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];

        // KHÔNG CÓ LOGIC XOAY: Chỉ kiểm tra với kích thước hiện tại
        if (fitsIn(rect, node)) {
          const s = scoreFor(rect, node);
          if (s.shortFit < bestShort || (s.shortFit === bestShort && s.longFit < bestLong)) {
            bestShort = s.shortFit;
            bestLong = s.longFit;
            bestIndex = i;
            chosenNode = node;
          }
        }
      }

      if (bestIndex !== -1 && chosenNode) {
        const placed = {
            ...rect,
            x: chosenNode.x,
            y: chosenNode.y
        };
        placedRectangles.push(placed);
        usedRectIds.add(rect.id);

        const usedNode = freeNodes.splice(bestIndex, 1)[0];
        const splits = splitFreeNode(usedNode, placed);
        freeNodes.push(...splits);
        pruneFreeList(freeNodes);
      }
    }

    const remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));
    return { placed: placedRectangles, remaining: remainingRectangles };
  }

  _bottomLeftFill(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeSpaces = [{
      x: 0,
      y: 0,
      width: this.container.width,
      length: this.container.length
    }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      
      let bestSpaceIndex = -1;
      let bestWaste = Infinity;

      // KHÔNG CÓ LOGIC XOAY: Chỉ kiểm tra 1 lần với kích thước hiện tại
      for (let i = 0; i < freeSpaces.length; i++) {
          const space = freeSpaces[i];
          if (this.canFitInSpace(rect, space)) { // Dùng kích thước đã cố định
              const waste = this.calculateWaste(rect, space);
              if (waste < bestWaste) {
                  bestWaste = waste;
                  bestSpaceIndex = i;
              }
          }
      }
      
      if (bestSpaceIndex !== -1) {
        const bestSpace = freeSpaces[bestSpaceIndex];
        
        const placedRect = {
            ...rect,
            x: bestSpace.x,
            y: bestSpace.y,
            layer: 0,
            // width, length, và rotated đã được quyết định TRƯỚC
        };
        
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        this.updateFreeSpaces(freeSpaces, placedRect, bestSpace, bestSpaceIndex);
      }
    }

    const remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));
    return { placed: placedRectangles, remaining: remainingRectangles };
  }
  
  _bestFitDecreasing(rectanglesToPack) {
    // Vẫn gọi BLF, nơi logic xoay đã bị loại bỏ
    return this._bottomLeftFill(rectanglesToPack); 
  }

  _nextFitDecreasing(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    let remainingRectangles = [];
    
    let currentX = 0;
    let currentY = 0;
    let currentLength = 0;

    for (const rect of rectanglesToPack) {
        if (usedRectIds.has(rect.id)) continue;
        
        let width = rect.width;
        let length = rect.length;

        const checkFit = (x, y, w, h) => {
            return (x + w <= this.container.width && y + h <= this.container.length)
        };

        let fit = checkFit(currentX, currentY, width, length);

        if (!fit) {
            currentX = 0;
            currentY += currentLength;
            currentLength = 0;
            
            fit = checkFit(currentX, currentY, width, length);
            
            if (!fit) {
                remainingRectangles.push(rect);
                continue;
            }
        }
        
        const placedRect = {
            ...rect,
            width: width,
            length: length,
            x: currentX,
            y: currentY,
            layer: 0
            // rotated đã được quyết định TRƯỚC
        };
        
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        
        currentX += width;
        currentLength = Math.max(currentLength, length);

        if (currentX >= this.container.width) {
            currentX = 0;
            currentY += currentLength;
            currentLength = 0;
        }
    }

    remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));

    return { placed: placedRectangles, remaining: remainingRectangles };
  }
  
  canFitInSpace(rect, space) {
    return rect.width <= space.width && rect.length <= space.length;
  }

  placeRectangle(rect, space) {
    return {
      ...rect,
      x: space.x,
      y: space.y,
      layer: 0 
    };
  }
  
  updateFreeSpaces(freeSpaces, placedRect, usedSpace, index) {
    freeSpaces.splice(index, 1);

    // Không gian mới bên phải
    if (placedRect.x + placedRect.width < usedSpace.x + usedSpace.width) {
      freeSpaces.push({
        x: placedRect.x + placedRect.width,
        y: usedSpace.y,
        width: usedSpace.x + usedSpace.width - (placedRect.x + placedRect.width),
        length: placedRect.length
      });
    }

    // Không gian mới phía trên
    if (placedRect.y + placedRect.length < usedSpace.y + usedSpace.length) {
      freeSpaces.push({
        x: usedSpace.x,
        y: placedRect.y + placedRect.length,
        width: usedSpace.width,
        length: usedSpace.y + usedSpace.length - (placedRect.y + placedRect.length)
      });
    }

    freeSpaces.sort((a, b) => a.y - b.y || a.x - b.x); 
  }

  calculateWaste(rect, space) {
    return (space.width * space.length) - (rect.width * rect.length);
  }

  // --- Base Greedy Layering Heuristic (Sử dụng kích thước cố định) ---
  _runGreedyLayeringPass(container, initialRectangles, maxLayers) {
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
    let allPlacedRectangles = [];
    let layersUsed = 0;
    let placedInLayer; 

    // Hàm kiểm tra khả năng vừa
    const canFit = (r) => (r.width <= container.width && r.length <= container.length);

    // Helper to sanitize placements (Giữ nguyên)
    const sanitizeLayer = (placed, remaining) => {
        const accepted = [];
        const stillRemaining = [...remaining];
        const isWithinBounds = (r) => r.x >= 0 && r.y >= 0 && (r.x + r.width) <= container.width && (r.y + r.length) <= container.length;
        const overlaps = (a, b) => (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.length && a.y + a.length > b.y);
        
        for (const rect of placed) {
            if (!isWithinBounds(rect)) {
              stillRemaining.push(rect); 
              continue;
            }
            let conflict = false;
            for (const acc of accepted) {
              if (overlaps(rect, acc)) { conflict = true; break; }
            }
            if (conflict) {
              stillRemaining.push(rect);
            } else {
              accepted.push(rect);
            }
        }
        return { accepted, stillRemaining };
    };
    
    // Luôn chạy cho lớp đầu tiên (layer 0)
    const layer = 0;
      
    const sortedForLayer = this.sortRectanglesByArea(unpackedRectangles);
    
    // Chạy thuật toán 2D tốt nhất trên danh sách đã sắp xếp (ĐÃ CÓ KÍCH THƯỚC CỐ ĐỊNH)
    const { placed: placedRaw, remaining: remainingRaw } = this._runSingleLayerPacking(sortedForLayer);
    
    const sanitizeResult = sanitizeLayer(placedRaw, remainingRaw);
    placedInLayer = sanitizeResult.accepted;
    unpackedRectangles = sanitizeResult.stillRemaining;
      
    // Đánh dấu lớp hiện tại cho các hình đã xếp
    placedInLayer.forEach(rect => {
      rect.layer = layer;
      allPlacedRectangles.push(rect);
    });
      
    if (placedInLayer.length > 0) {
      layersUsed++;
    }

    // Tính toán các chỉ số cuối cùng
    const containerAreaPerLayer = container.width * container.length;
    const finalUsedArea = allPlacedRectangles.reduce((sum, rect) => 
      sum + (rect.width * rect.length), 0
    );
    const maxTotalArea = containerAreaPerLayer * maxLayers;

    return {
      rectangles: allPlacedRectangles,
      remainingRectangles: unpackedRectangles,
      remainingFeasibleCount: unpackedRectangles.filter(canFit).length,
      remainingUnfitCount: unpackedRectangles.length - unpackedRectangles.filter(canFit).length,
      efficiency: maxTotalArea > 0 ? (finalUsedArea / maxTotalArea) * 100 : 0, 
      usedArea: finalUsedArea,
      totalArea: maxTotalArea, 
      wasteArea: maxTotalArea - finalUsedArea,
      layersUsed: layersUsed
    };
  }

  // --- Hàm Optimize chính đã sửa đổi ---
  async optimize(container, initialRectangles, maxLayers) {
    this.container = container;
    
    // BƯỚC 1: Xác định trạng thái xoay cố định tối ưu cho từng loại
    const optimalRotations = this.determineOptimalRotations(container, initialRectangles.map(r => ({...r})));
    
    // BƯỚC 2: Áp dụng trạng thái xoay đã chọn cho TẤT CẢ bản sao
    const transformedRectangles = initialRectangles.map(rect => {
        const shouldRotate = optimalRotations.get(rect.typeId);
        
        let width = rect.width;
        let length = rect.length;

        if (shouldRotate) {
            [width, length] = [length, width];
        }
        
        // Tạo bản sao mới với kích thước và cờ xoay cố định
        return {
            ...rect,
            width: width,
            length: length,
            rotated: shouldRotate 
        };
    });
    
    const sortedRectangles = this.sortRectanglesByArea(transformedRectangles);

    const bestResult = this._runGreedyLayeringPass(container, sortedRectangles, 1);

    return bestResult;
  }
}

export default PackingAlgorithm;