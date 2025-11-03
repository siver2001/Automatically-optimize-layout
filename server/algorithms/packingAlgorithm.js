// server/algorithms/packingAlgorithm.js

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
  
  // --- HÀM MỚI: Chỉ chạy 1 chiến lược nhanh để kiểm tra xoay ---
  _runQuickSingleLayerPacking(rectanglesToPack) {
    // Chỉ chạy chiến lược đầu tiên (MaxRectsBSSF) để ước tính
    // Sắp xếp trước khi chạy
    const sortedRects = this.sortRectanglesByArea(rectanglesToPack);
    const { placed: currentPlaced, remaining: currentRemaining } = this._maxRectsBSSF(sortedRects.map(r => ({...r})));
    const currentUsedArea = currentPlaced.reduce((sum, rect) => sum + (rect.width * rect.length), 0);

    return {
      placed: currentPlaced.map(r => ({...r, layer: 0})),
      remaining: currentRemaining.map(r => ({...r})),
      usedArea: currentUsedArea
    };
  }
  
  // ---  Chạy thuật toán 2D đóng gói đơn lớp (KHÔNG XOAY TẠI CHỖ) ---
  _runSingleLayerPacking(rectanglesToPack) {
    // Sắp xếp các hình chữ nhật NGAY TẠI ĐÂY
    const sortedRectangles = this.sortRectanglesByArea(rectanglesToPack); 

    const strategies = [
      () => this._maxRectsBSSF(sortedRectangles.map(r => ({...r}))),
      () => this._nextFitDecreasing(sortedRectangles.map(r => ({...r})))
    ];

    let bestResult = { placed: [], remaining: sortedRectangles };
    let bestUsedArea = 0;

    for (const strategy of strategies) {
        // strategy() đã tự tạo bản sao
        const { placed: currentPlaced, remaining: currentRemaining } = strategy(); 
        const currentUsedArea = currentPlaced.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        
        if (currentUsedArea > bestUsedArea) {
            bestUsedArea = currentUsedArea;
            bestResult = { 
              placed: currentPlaced.map(r => ({...r, layer: 0})), 
              remaining: currentRemaining.map(r => ({...r})) 
          };
        }
    }

    return bestResult;
  }
  
  // --- : Xác định hướng xoay tối ưu (0 độ hoặc 90 độ) cho mỗi loại ---
  determineOptimalRotations(_container, allRectangles) {
      const optimalRotations = new Map(); 
      
      const originalTypeDetails = allRectangles.reduce((acc, rect) => {
          acc[rect.typeId] = acc[rect.typeId] || { rect: rect, count: 0 };
          acc[rect.typeId].count++;
          return acc;
      }, {});

      for (const typeId in originalTypeDetails) {
          const originalRect = originalTypeDetails[typeId].rect;
          const rectsOfType = allRectangles.filter(r => r.typeId === Number(typeId));

          // 1. Kiểm tra trường hợp KHÔNG xoay
          const rectsNoRotate = rectsOfType.map(r => ({ ...r, width: originalRect.width, length: originalRect.length, rotated: false }));
          const resultNoRotate = this._runQuickSingleLayerPacking(rectsNoRotate);
          const areaNoRotate = resultNoRotate.usedArea; 

          // 2. Kiểm tra trường hợp XOAY 90 độ
          const rectsRotated = rectsOfType.map(r => ({ ...r, width: originalRect.length, length: originalRect.width, rotated: true }));
          const resultRotated = this._runQuickSingleLayerPacking(rectsRotated);
          const areaRotated = resultRotated.usedArea; 

          // Chọn hướng nào tối đa hóa DIỆN TÍCH
          if (areaRotated > areaNoRotate) {
              optimalRotations.set(Number(typeId), true);
          } else {
              optimalRotations.set(Number(typeId), false);
          }
      }
      return optimalRotations;
  }

  // --- Core 2D Packing Logic (Đã được đơn giản hóa) ---
  run2DPacking(rectanglesToPack) {
    return this._runSingleLayerPacking(rectanglesToPack);
  }

  // --- Implementations of 2D Packing Algorithms (KHÔNG XOAY TẠI CHỖ) ---

  _maxRectsBSSF(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    const fitsIn = (rect, node) => rect.width <= node.width && rect.length <= node.length;

    const scoreFor = (rect, node) => {
      const dw = node.width - rect.width;
      const dh = node.length - rect.length;
      const shortFit = Math.min(dw, dh);
      const longFit = Math.max(dw, dh);
      return { shortFit, longFit };
    };
    
    // Đây là logic Guillotine Split chuẩn
    const splitFreeNode = (node, placed) => {
        const remainingNodes = [];
        
        // Mảnh 1: Cắt theo chiều ngang (Không gian phía trên)
        if (node.length > placed.length) {
          remainingNodes.push({
            x: node.x,
            y: node.y + placed.length,
            width: node.width,
            length: node.length - placed.length
          });
        }
        
        // Mảnh 2: Cắt theo chiều dọc (Không gian bên phải)
        if (node.width > placed.width) {
          remainingNodes.push({
            x: node.x + placed.width,
            y: node.y,
            width: node.width - placed.width,
            length: placed.length // CHỈ CAO BẰNG HÌNH ĐÃ ĐẶT
          });
        }

        return remainingNodes; // Trả về các mảnh còn lại
    };

    const rectContains = (a, b) => a.x <= b.x && a.y <= b.y && (a.x + a.width) >= (b.x + b.width) && (a.y + a.length) >= (b.y + b.length);

    const pruneFreeList = (nodes) => {
        // Lặp ngược để tránh lỗi index khi splice
        for (let i = nodes.length - 1; i >= 0; i--) {
            // Nếu i không còn tồn tại (do đã bị xóa bởi vòng lặp j), bỏ qua
            if (!nodes[i]) continue;
            
            for (let j = nodes.length - 1; j >= 0; j--) {
                if (i === j || !nodes[j]) continue;
                
                // Nếu node[i] nằm hoàn toàn trong node[j]
                if (rectContains(nodes[j], nodes[i])) {
                    nodes.splice(i, 1);
                    break; // Dừng vòng lặp j và tiếp tục vòng lặp i (đã lùi 1)
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
        
        // Dùng logic split mới
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
    let freeSpaces = [{
      x: 0,
      y: 0,
       width: this.container.width,
       length: this.container.length
     }]; 
     
    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      
      let bestSpaceIndex = -1;
      let bestWaste = Infinity;
      
      // 1. Tìm vị trí (khoảng trống) tốt nhất
      for (let i = 0; i < freeSpaces.length; i++) {
          const space = freeSpaces[i];
          if (this.canFitInSpace(rect, space)) {
              // Ưu tiên vị trí thấp nhất (y nhỏ nhất), sau đó là x nhỏ nhất
              const waste = space.y * this.container.width + space.x; 
              if (waste < bestWaste) {
                  bestWaste = waste;
                  bestSpaceIndex = i;
              }
          }
      }

      // (Đã xóa 2 vòng lặp thừa)

      if (bestSpaceIndex !== -1) {
        const usedSpace = freeSpaces[bestSpaceIndex];
        const placedRect = {
            ...rect,
            x: usedSpace.x,
            y: usedSpace.y,
            layer: 0,
        };

        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);

        // 2. Cắt và thêm các khoảng trống mới
        const newFreeSpaces = [];

        // Mảnh 1: Cắt theo chiều ngang (Không gian phía trên)
        if (usedSpace.length > placedRect.length) {
          newFreeSpaces.push({
            x: usedSpace.x,
            y: usedSpace.y + placedRect.length,
            width: usedSpace.width,
            length: usedSpace.length - placedRect.length
          });
        }
        
        // Mảnh 2: Cắt theo chiều dọc (Không gian bên phải)
        if (usedSpace.width > placedRect.width) {
          newFreeSpaces.push({
            x: usedSpace.x + placedRect.width,
            y: usedSpace.y,
            width: usedSpace.width - placedRect.width,
            length: placedRect.length // Chỉ cao bằng hình đã đặt
          });
        }
        
        
        freeSpaces.splice(bestSpaceIndex, 1);
        freeSpaces.push(...newFreeSpaces);
        
        freeSpaces.sort((a, b) => a.y - b.y || a.x - b.x);
       }
     }
      const remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));

    return { placed: placedRectangles, remaining: remainingRectangles };
  }

  _bestFitDecreasing(rectanglesToPack) {
    return this._maxRectsBSSF(rectanglesToPack); 
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

    //  Gán lại remainingRectangles
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
  splitFreeSpace(existingSpace, placedRect) {
    const newSpaces = [];

    const rightX = placedRect.x + placedRect.width;
    if (existingSpace.x < rightX && rightX < existingSpace.x + existingSpace.width) {
      newSpaces.push({
        x: rightX,
        y: existingSpace.y,
        width: existingSpace.x + existingSpace.width - rightX,
        length: existingSpace.length
      });
    }

    const topY = placedRect.y + placedRect.length;
    if (existingSpace.y < topY && topY < existingSpace.y + existingSpace.length) {
      newSpaces.push({
        x: existingSpace.x,
        y: topY,
        width: existingSpace.width,
        length: existingSpace.y + existingSpace.length - topY
      });
    }
    
    if (rightX > existingSpace.x && rightX < existingSpace.x + existingSpace.width) {
        newSpaces.push({
            x: rightX,
            y: existingSpace.y,
            width: existingSpace.x + existingSpace.width - rightX,
            length: placedRect.y + placedRect.length - existingSpace.y 
        });
    }

    if (topY > existingSpace.y && topY < existingSpace.y + existingSpace.length) {
        newSpaces.push({
            x: existingSpace.x,
            y: topY,
            width: existingSpace.width,
            length: existingSpace.y + existingSpace.length - topY
        });
    }

    return newSpaces;
  }
  
  // --- Base Greedy Layering Heuristic
  _runGreedyLayeringPass(container, initialRectangles, maxLayers) {
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
    let allPlacedRectangles = [];
    let layersUsed = 0;
    let placedInLayer; 

      const canFit = (r) => (r.width <= container.width && r.length <= container.length);

      // Helper to sanitize placements
      const sanitizeLayer = (placed, remaining) => {
          const accepted = [];
          const stillRemaining = [...remaining];
          const isWithinBounds = (r) => r.x >= 0 && r.y >= 0 && (r.x + r.width) <= container.width && (r.y + r.length) <= container.length;
          const overlaps = (a, b) => (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.length && a.y + a.length > b.y);
          
          for (const rect of placed) {
              if (!isWithinBounds(rect)) {
                  console.error("[Optimize] Algorithm placed rectangle out of bounds:", rect);
                  stillRemaining.push(rect); 
                  continue;
              }
              let conflict = false;
              for (const acc of accepted) {
                  if (overlaps(rect, acc)) { 
                      conflict = true; 
                      console.error(`[Optimize] Conflict detected: ${rect.id} overlaps with ${acc.id}`);
                      break; 
                  }
              }
              if (conflict) {
                  stillRemaining.push(rect);
              } else {
                  accepted.push(rect);
              }
          }
          return { accepted, stillRemaining };
      };
      
      const layer = 0;
        
      
      // Chạy thuật toán 2D tốt nhất
      const { placed: placedRaw, remaining: remainingRaw } = this._runSingleLayerPacking(unpackedRectangles);
      
      // Chỉ sanitize những hình đã đặt
      const sanitizeResult = sanitizeLayer(placedRaw, []); 
      placedInLayer = sanitizeResult.accepted;

      unpackedRectangles = [...sanitizeResult.stillRemaining, ...remainingRaw]; 

      placedInLayer.forEach(rect => {
        rect.layer = layer;
        allPlacedRectangles.push(rect);
      });
        
      if (placedInLayer.length > 0) {
        layersUsed++;
      }

      const containerAreaPerLayer = container.width * container.length;
      const finalUsedArea = allPlacedRectangles.reduce((sum, rect) => 
        sum + (rect.width * rect.length), 0
      );
      const totalUsedArea = containerAreaPerLayer * layersUsed; // Chỉ tính diện tích của các lớp đã dùng

      return {
        rectangles: allPlacedRectangles,
        remainingRectangles: unpackedRectangles,
        remainingFeasibleCount: unpackedRectangles.filter(canFit).length,
        remainingUnfitCount: unpackedRectangles.length - unpackedRectangles.filter(canFit).length,
        // Hiệu suất là (diện tích hình đã xếp) / (diện tích các lớp đã dùng)
        efficiency: totalUsedArea > 0 ? (finalUsedArea / totalUsedArea) * 100 : 0, 
        usedArea: finalUsedArea,
        totalArea: totalUsedArea, 
        wasteArea: totalUsedArea - finalUsedArea,
        layersUsed: layersUsed
      };
    }

  async optimize(container, initialRectangles, maxLayers) {
    this.container = container;
    
    // BƯỚC 1: Xác định trạng thái xoay cố định tối ưu cho từng loại
    // (SỬ DỤNG HÀM NHANH)
    const optimalRotations = this.determineOptimalRotations(container, initialRectangles.map(r => ({...r})));
    
    // BƯỚC 2: Áp dụng trạng thái xoay đã chọn cho TẤT CẢ bản sao
    const transformedRectangles = initialRectangles.map(rect => {
        let shouldRotate = optimalRotations.get(rect.typeId) || false; 
        
        let width = rect.width;
        let length = rect.length;

        if (shouldRotate) {
            [width, length] = [length, width];
        }
        
        return {
            ...rect,
            width: width,
            length: length,
            rotated: shouldRotate 
        };
    });
    
    // BƯỚC 3: Chạy thuật toán xếp lớp 
    const bestResult = this._runGreedyLayeringPass(container, transformedRectangles, 1);

    return bestResult;
  }
}

export default PackingAlgorithm;