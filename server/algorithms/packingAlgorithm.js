import DxfWriter from 'dxf-writer';
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
    
    // ... (splitFreeNode và pruneFreeList không đổi)
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
          // width, length, và rotated đã được quyết định TRƯỚC
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
  
  // ... (updateFreeSpaces và calculateWaste không đổi)
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
    let placedInLayer; // Khai báo biến này

    // Hàm kiểm tra khả năng vừa (chỉ cần kích thước cố định vừa với container)
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

    for (let layer = 0; layer < maxLayers && unpackedRectangles.length > 0; layer++) {
      
      const sortedForLayer = this.sortRectanglesByArea(unpackedRectangles);
      
      // Chạy thuật toán 2D tốt nhất trên danh sách đã sắp xếp (ĐÃ CÓ KÍCH THƯỚC CỐ ĐỊNH)
      const { placed: placedRaw, remaining: remainingRaw } = this._runSingleLayerPacking(sortedForLayer);
      
      const sanitizeResult = sanitizeLayer(placedRaw, remainingRaw);
      placedInLayer = sanitizeResult.accepted;
      unpackedRectangles = sanitizeResult.stillRemaining;
      
      if (placedInLayer.length === 0 && unpackedRectangles.length > 0) {
        
        const anyFeasible = unpackedRectangles.some(canFit);
        if (anyFeasible) {
            // Lần thử thứ hai với Next Fit Decreasing để lấp đầy các khoảng trống nếu có
            const { placed: placedNFD, remaining: remainingNFD } = this._nextFitDecreasing(sortedForLayer);
            
            const { accepted: acceptedNFD, stillRemaining: stillRemainingNFD } = sanitizeLayer(placedNFD, remainingNFD);
            
            if (acceptedNFD.length > 0) {
                placedInLayer = acceptedNFD;
                unpackedRectangles = stillRemainingNFD;
            } else {
                 // Không thể đặt thêm, và không có tiến triển
                if (unpackedRectangles.every(r => !canFit(r)) || unpackedRectangles.length === sortedForLayer.length) {
                    break;
                }
            }
        } else {
            break; // Không còn hình nào có thể vừa (dù đã xoay hay chưa), thoát
        }
      }
      
      // Đánh dấu lớp hiện tại cho các hình đã xếp
      placedInLayer.forEach(rect => {
        rect.layer = layer;
        allPlacedRectangles.push(rect);
      });
      
      // Chỉ tăng layersUsed nếu có hình được đặt trong lớp này
      if (placedInLayer.length > 0) {
        layersUsed++;
      }
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
    this.layers = maxLayers;

    // BƯỚC 1: Xác định trạng thái xoay cố định cho TỪNG LOẠI
    // Chú ý: Truyền bản sao của initialRectangles để tránh thay đổi bản gốc
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
    
    const META_ITERATIONS = 50; 
    let bestResult = null;
    
    const optimizedRectangles = transformedRectangles.map(r => ({...r}));
    
    // Lần 0: Chạy với sắp xếp diện tích giảm dần (đã áp dụng rotation)
    bestResult = this._runGreedyLayeringPass(container, this.sortRectanglesByArea(optimizedRectangles), maxLayers);
    
    // Vòng lặp tìm kiếm Meta-Heuristic (chỉ thay đổi thứ tự, KHÔNG thay đổi kích thước)
    for (let i = 1; i < META_ITERATIONS; i++) {
        // 1. Tạo hoán vị ngẫu nhiên trên danh sách optimizedRectangles đã xác định xoay
        let shuffledRectangles = optimizedRectangles.map(r => ({...r}));
        this.shuffleArray(shuffledRectangles);
        
        // 2. Chạy thuật toán tham lam 
        const currentResult = this._runGreedyLayeringPass(container, shuffledRectangles, maxLayers);
        
        // 3. So sánh và Cập nhật (Acceptance Criterion)
        if (currentResult.layersUsed < bestResult.layersUsed || 
            (currentResult.layersUsed === bestResult.layersUsed && currentResult.efficiency > bestResult.efficiency)) {
            
            bestResult = currentResult;
        }
    }

    return bestResult;
  }
  static exportToDXF(container, allRectangles) {
        const maker = new DxfWriter();
        const containerWidth = container.width;
        const containerLength = container.length;
        const layerLength = 10; // Giả định khoảng cách giữa các layer để xếp cạnh nhau

        // Hàm trợ giúp để vẽ hình chữ nhật bằng 4 đoạn thẳng
        const drawRectangle = (x, y, width, length, layerName) => {
            const x0 = x;
            const y0 = y;
            const x1 = x + width;
            const y1 = y + length;
            
            maker.drawLine(x0, y0, x1, y0, { layer: layerName }); // Bottom line
            maker.drawLine(x1, y0, x1, y1, { layer: layerName }); // Right line
            maker.drawLine(x1, y1, x0, y1, { layer: layerName }); // Top line
            maker.drawLine(x0, y1, x0, y0, { layer: layerName }); // Left line
        };

        // Vẽ container tổng thể (khung bao ngoài)
        maker.addLayer('ContainerBorder', 0xF00, 'CONTINUOUS');
        drawRectangle(0, 0, containerWidth, containerLength * container.layers, 'ContainerBorder');

        // Tọa độ Y dịch chuyển cho mỗi lớp
        let currentYOffset = 0; 
        
        // Gom nhóm các hình chữ nhật theo layer
        const layersMap = new Map();
        for (const rect of (allRectangles || [])) {
            // Kiểm tra an toàn cho từng đối tượng hình chữ nhật
            if (!rect || typeof rect.width !== 'number' || typeof rect.length !== 'number') {
                continue;
            }

            const layerIndex = rect.layer || 0;
            if (!layersMap.has(layerIndex)) {
                layersMap.set(layerIndex, []);
            }
            layersMap.get(layerIndex).push(rect);
        }

        const sortedLayers = Array.from(layersMap.keys()).sort((a, b) => a - b);
        
        // Xếp các layer cạnh nhau trên cùng một mặt phẳng
        for (const layerIndex of sortedLayers) {
            const rectanglesInLayer = layersMap.get(layerIndex);

            // Thêm layer cho các hình cắt
            const layerName = `Layer_${layerIndex + 1}`;
            maker.addLayer(layerName, layerIndex % 7 + 1, 'CONTINUOUS'); // Màu sắc khác nhau cho mỗi layer

            // Vẽ các hình chữ nhật đã xếp
            rectanglesInLayer.forEach(rect => {
                const x0 = rect.x;
                const y0 = rect.y + currentYOffset;
                
                drawRectangle(rect.x, rect.y + currentYOffset, rect.width, rect.length, layerName);

                // Thêm Text (tên/kích thước) vào trung tâm hình
                const textX = rect.x + rect.width / 2;
                const textY = rect.y + rect.length / 2 + currentYOffset;
                const textLength = 10; // Kích thước chữ cố định
                const textContent = `${rect.name} (${rect.width}x${rect.length})`;
                
                maker.drawText(textX, textY, textLength, textContent, {
                    layer: layerName, 
                    style: 'STANDARD', 
                    halign: 'CENTER',
                    valign: 'MIDDLE'
                });
            });
            
            // Vẽ đường viền container cho layer hiện tại (để dễ hình dung)
            maker.addLayer(`Container_${layerIndex + 1}`, layerIndex % 7 + 10, 'DASHED');
            drawRectangle(0, currentYOffset, containerWidth, containerLength, `Container_${layerIndex + 1}`);

            // Cập nhật offset cho layer tiếp theo (đặt layer mới dưới layer cũ)
            currentYOffset += containerLength + layerLength; 
        }

        return maker.toDxfString();
    }
}

export default PackingAlgorithm;