// server/algorithms/packingAlgorithm.js

class PackingAlgorithm {
  constructor() {
    this.container = null;
    this.layers = 1;
    this.startTime = null; 
  }

  checkTimeout(maxSeconds = 240) {
    if (this.startTime && (Date.now() - this.startTime) / 1000 > maxSeconds) {
      throw new Error(`Thuật toán vượt quá ${maxSeconds} giây`);
    }
  }

  // --- 1. CÁC HÀM SẮP XẾP (SORTING) ---

  // [CŨ] Sắp xếp theo diện tích
  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.length;
      const areaB = b.width * b.length;
      if (areaA !== areaB) return areaB - areaA;
      return Math.max(b.width, b.length) - Math.max(a.width, a.length);
    });
  }

  // [CŨ] Sắp xếp theo cạnh dài nhất
  sortRectanglesBySide(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const maxA = Math.max(a.width, a.length);
      const maxB = Math.max(b.width, b.length);
      if (Math.abs(maxA - maxB) > 0.1) return maxB - maxA;
      const minA = Math.min(a.width, a.length);
      const minB = Math.min(b.width, b.length);
      return minB - minA;
    });
  }

  // [MỚI - QUAN TRỌNG CHO HÌNH 2] Sắp xếp theo Chiều Cao (Height)
  sortRectanglesByHeight(rectangles) {
     return rectangles.slice().sort((a, b) => {
        // Ưu tiên chiều cao lớn nhất xếp trước
        if (Math.abs(b.length - a.length) > 0.1) return b.length - a.length;
        // Nếu chiều cao bằng nhau, ưu tiên chiều rộng lớn nhất
        if (Math.abs(b.width - a.width) > 0.1) return b.width - a.width;
        return 0;
    });
  }

  // [MỚI] Sắp xếp theo Chiều Rộng (Width)
  sortRectanglesByWidth(rectangles) {
    return rectangles.slice().sort((a, b) => {
        if (Math.abs(b.width - a.width) > 0.1) return b.width - a.width;
        if (Math.abs(b.length - a.length) > 0.1) return b.length - a.length;
        return 0;
    });
  }

  // Hàm đồng bộ chiều xoay (Pre-align)
  preAlignRectangles(rectangles, mode = 'horizontal') {
    return rectangles.map(r => {
      if (r.noRotate) return { ...r };

      const isVertical = r.width < r.length;
      if (mode === 'horizontal' && isVertical) {
         return { ...r, width: r.length, length: r.width, rotated: !r.rotated };
      }
      if (mode === 'vertical' && !isVertical) {
         return { ...r, width: r.length, length: r.width, rotated: !r.rotated };
      }
      return { ...r };
    });
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Tính điểm thẩm mỹ (Ưu tiên tạo khối/Grid)
  _calculateAlignmentScore(placedRectangles) {
    let score = 0;
    const rects = placedRectangles;
    for (let i = 0; i < rects.length; i++) {
        if (rects[i].rotated) score -= 2; // Phạt xoay lẻ tẻ

        for (let j = i + 1; j < rects.length; j++) {
            const touchingX = Math.abs((rects[i].x + rects[i].width) - rects[j].x) < 0.1;
            const touchingY = Math.abs((rects[i].y + rects[i].length) - rects[j].y) < 0.1;
            const sameWidth = Math.abs(rects[i].width - rects[j].width) < 0.1;
            const sameHeight = Math.abs(rects[i].length - rects[j].length) < 0.1;

            // [NÂNG CẤP] Tăng điểm từ 15 lên 50 để ép thuật toán chọn phương án xếp thẳng hàng
            if (touchingX && sameHeight && Math.abs(rects[i].y - rects[j].y) < 0.1) score += 50;
            if (touchingY && sameWidth && Math.abs(rects[i].x - rects[j].x) < 0.1) score += 50;
        }
    }
    return score;
  }
  
  // ============================================================
  // ✅ [NÂNG CẤP MỚI] SHELF NEXT FIT SMART (CÓ XẾP CHỒNG DỌC)
  // Hàm này sẽ giải quyết vấn đề ở Hình 1 -> biến thành Hình 2
  // ============================================================
  _shelfNextFitSmart(rectanglesToPack, forceSort = true) {
    // 1. Sắp xếp giảm dần theo chiều cao
    let rects = forceSort ? this.sortRectanglesByHeight(rectanglesToPack) : [...rectanglesToPack];
    
    const placedRectangles = [];
    const usedRectIds = new Set();
    
    let currentX = 0;
    let currentY = 0;
    let currentShelfHeight = 0;
    
    // Duyệt qua từng hình làm "Base Item" (Hình gốc đặt dưới cùng)
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (usedRectIds.has(rect.id)) continue;

      let placedWidth = rect.width;
      let placedLength = rect.length;
      let placedRotated = rect.rotated || false;

      // --- Logic tạo hàng mới (Shelf) ---
      if (currentX + placedWidth > this.container.width) {
        currentX = 0;
        currentY += currentShelfHeight;
        currentShelfHeight = 0; 
      }

      // Kiểm tra tràn container theo chiều dọc
      if (currentY + placedLength > this.container.length) {
        continue; // Không vừa, để lại cho tấm sau
      }

      // Đặt hình gốc
      const placed = {
        ...rect,
        x: currentX,
        y: currentY,
        width: placedWidth,
        length: placedLength,
        rotated: placedRotated,
        layer: 0
      };

      placedRectangles.push(placed);
      usedRectIds.add(rect.id);

      // Chiều cao hiện tại của cột này
      let currentStackHeight = placedLength;
      if (currentStackHeight > currentShelfHeight) currentShelfHeight = currentStackHeight;

      // === [LOGIC MỚI] TÌM HÌNH ĐỂ CHỒNG LÊN TRÊN (VERTICAL STACKING) ===
      let currentStackY = currentY + placedLength;
      
      while (true) {
        let bestStackIndex = -1;
        
        // Quét các hình còn lại để tìm hình phù hợp nhất chồng lên
        for (let j = i + 1; j < rects.length; j++) {
          const candidate = rects[j];
          if (usedRectIds.has(candidate.id)) continue;

          // Điều kiện 1: Phải cùng chiều rộng (quan trọng nhất để thẳng cột)
          if (Math.abs(candidate.width - placedWidth) > 0.1) continue;

          // Điều kiện 2: Phải vừa chiều cao còn lại của container
          if (currentStackY + candidate.length > this.container.length) continue;

          // Nếu thỏa mãn, chọn ngay (Greedy - vì danh sách đã sắp xếp theo chiều cao rồi)
          bestStackIndex = j;
          break; 
        }

        if (bestStackIndex !== -1) {
          // Đặt hình chồng lên
          const stackedRect = rects[bestStackIndex];
          const stackedPlaced = {
            ...stackedRect,
            x: currentX, // Cùng X
            y: currentStackY, // Y tăng lên
            width: stackedRect.width,
            length: stackedRect.length,
            rotated: stackedRect.rotated || false,
            layer: 0
          };

          placedRectangles.push(stackedPlaced);
          usedRectIds.add(stackedRect.id);

          // Cập nhật Y cho lần lặp kế tiếp
          currentStackY += stackedRect.length;
          currentStackHeight += stackedRect.length;

          // Cập nhật chiều cao Shelf nếu cột này cao hơn
          if (currentStackHeight > currentShelfHeight) currentShelfHeight = currentStackHeight;
        } else {
          // Không tìm thấy hình nào vừa để chồng nữa -> Thoát vòng lặp
          break;
        }
      }
      // =================================================================

      // Di chuyển sang phải để đặt cột tiếp theo
      currentX += placedWidth;
    }

    const remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));
    return { placed: placedRectangles, remaining: remainingRectangles };
  }

  // --- CHIẾN THUẬT TỔNG HỢP (HYBRID) ---
  _runSingleLayerPacking(rectanglesToPack) {
    
    const rawRects = rectanglesToPack.map(r => ({...r}));

    // 1. Chuẩn bị dữ liệu: Xoay ngang hết
    const stripHorizontalData = this.preAlignRectangles(rawRects, 'horizontal');
    const sortedByHeight = this.sortRectanglesByHeight(stripHorizontalData);

    // 2. Chuẩn bị dữ liệu: Xoay dọc hết
    const stripVerticalData = this.preAlignRectangles(rawRects, 'vertical');
    const sortedByWidth = this.sortRectanglesByHeight(stripVerticalData);

    // 3. Dữ liệu gốc
    const areaData = this.sortRectanglesByArea(rawRects);

    const strategies = [
      // ✅ 1. Ưu tiên hàng đầu: SMART SHELF (Có xếp chồng)
      {
        name: 'Shelf_Smart_Horizontal',
        fn: () => this._shelfNextFitSmart(sortedByHeight.map(r => ({...r})), false) 
      },
      
      // --- Các chiến thuật cũ ---
      { 
          name: 'Strip_Horizontal_BL', 
          fn: () => this._maxRectsBL(sortedByHeight.map(r => ({...r})), true) 
      },
      { 
          name: 'Strip_Vertical_BL', 
          fn: () => this._maxRectsBL(sortedByWidth.map(r => ({...r})), true)
      },
      { 
          name: 'Area_BSSF', 
          fn: () => this._maxRectsBSSF(areaData.map(r => ({...r})), false) 
      },
      { 
          name: 'Area_BAF', 
          fn: () => this._maxRectsBAF(areaData.map(r => ({...r})), false) 
      }
    ];

    let bestResult = null;

    for (const strategy of strategies) {
        const { placed, remaining } = strategy.fn(); 
        
        const count = placed.length;
        const usedArea = placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        const alignmentScore = this._calculateAlignmentScore(placed); 
        const rotatedCount = placed.filter(r => r.rotated).length;
        
        // Tính độ "vuông vức" (Compactness) - Để ưu tiên các khối liền mạch
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        placed.forEach(r => {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.width);
            maxY = Math.max(maxY, r.y + r.length);
        });
        const boundingArea = (placed.length > 0) ? (maxX - minX) * (maxY - minY) : 0;
        const compactness = (boundingArea > 0) ? (usedArea / boundingArea) : 0; 

        const currentResult = { 
            placed: placed.map(r => ({...r, layer: 0})), 
            remaining: remaining.map(r => ({...r})),
            count, usedArea, alignmentScore, rotatedCount, compactness,
            strategyName: strategy.name
        };

        if (!bestResult) {
            bestResult = currentResult;
            continue;
        }

        // === LOGIC CHẤM ĐIỂM ===
        // 1. Số lượng là vua
        if (currentResult.count > bestResult.count) {
            bestResult = currentResult;
        } 
        // 2. Nếu số lượng bằng nhau -> Chọn cái nào ĐẸP HƠN (Grid/Strip)
        else if (currentResult.count === bestResult.count) {
            if (currentResult.alignmentScore > bestResult.alignmentScore) {
                 bestResult = currentResult;
            }
            // 3. Nếu độ đẹp ngang nhau -> Chọn cái nào gọn hơn (compactness)
            else if (currentResult.alignmentScore === bestResult.alignmentScore) {
                 if (currentResult.compactness > bestResult.compactness) {
                    bestResult = currentResult;
                 }
            }
        }
    }

    return bestResult; 
  }
  
  run2DPacking(rectanglesToPack) {
    return this._runSingleLayerPacking(rectanglesToPack);
  }

  // --- CÁC HÀM HELPER (GIỮ NGUYÊN KHÔNG ĐỔI) ---
  _maxRectsCommonHelpers() {
    const fitsIn = (w, h, node) => w <= node.width && h <= node.length;
    
    const splitFreeNode = (node, placed) => {
      const remainingNodes = [];
      if (node.length > placed.length) {
        remainingNodes.push({
          x: node.x,
          y: node.y + placed.length,
          width: node.width,
          length: node.length - placed.length
        });
      }
      if (node.width > placed.width) {
        remainingNodes.push({
          x: node.x + placed.width,
          y: node.y,
          width: node.width - placed.width,
          length: placed.length
        });
      }
      return remainingNodes;
    };

    const rectContains = (a, b) => a.x <= b.x && a.y <= b.y && (a.x + a.width) >= (b.x + b.width) && (a.y + a.length) >= (b.y + b.length);

    const pruneFreeList = (nodes) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (!nodes[i]) continue;
        for (let j = nodes.length - 1; j >= 0; j--) {
          if (i === j || !nodes[j]) continue;
          if (rectContains(nodes[j], nodes[i])) {
            nodes.splice(i, 1);
            break;
          }
        }
      }
    };
    return { fitsIn, splitFreeNode, pruneFreeList };
  }
  
  // === CHIẾN LƯỢC: BSSF (GIỮ NGUYÊN) ===
  _maxRectsBSSF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;

      let bestIndex = -1;
      let bestShort = Infinity;
      let bestLong = Infinity;
      let chosenNode = null;
      let bestWasRotated = false;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const rotationPenalty = forceGridPreference ? 10000 : 0; 

        // Thử không xoay
        if (fitsIn(rect.width, rect.length, node)) {
          const dw = node.width - rect.width;
          const dh = node.length - rect.length;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          let score = shortFit;
          if (forceGridPreference && (dw === 0 || dh === 0)) score -= 500;

          if (score < bestShort || (score === bestShort && longFit < bestLong)) {
            bestShort = score;
            bestLong = longFit;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = false;
          }
        }

        // Thử xoay
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const dw = node.width - rect.length;
          const dh = node.length - rect.width;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          let score = shortFit + rotationPenalty;
          if (forceGridPreference && (dw === 0 || dh === 0)) score -= 500;

          if (score < bestShort || (score === bestShort && longFit < bestLong)) {
            bestShort = score;
            bestLong = longFit;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = true;
          }
        }
      }

      if (bestIndex !== -1 && chosenNode) {
        const placedWidth = bestWasRotated ? rect.length : rect.width;
        const placedLength = bestWasRotated ? rect.width : rect.length;
        const placed = { ...rect, x: chosenNode.x, y: chosenNode.y, width: placedWidth, length: placedLength, rotated: bestWasRotated, originalWidth: rect.originalWidth, originalLength: rect.originalLength, transform: rect.transform, pairId: rect.pairId, pieceIndex: rect.pieceIndex, splitDirection: rect.splitDirection };
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

  // === CHIẾN LƯỢC: BAF (GIỮ NGUYÊN) ===
  _maxRectsBAF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1;
      let bestScore = Infinity; 
      let chosenNode = null;
      let bestWasRotated = false;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const nodeArea = node.width * node.length;
        const rotationPenalty = forceGridPreference ? (nodeArea * 5) : 0;

        if (fitsIn(rect.width, rect.length, node)) {
          const waste = nodeArea - (rect.width * rect.length);
          if (waste < bestScore) {
            bestScore = waste;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = false;
          }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const waste = nodeArea - (rect.length * rect.width);
          if ((waste + rotationPenalty) < bestScore) {
            bestScore = waste + rotationPenalty;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = true;
          }
        }
      }
      if (bestIndex !== -1 && chosenNode) {
         const placedWidth = bestWasRotated ? rect.length : rect.width;
         const placedLength = bestWasRotated ? rect.width : rect.length;
         const placed = { ...rect, x: chosenNode.x, y: chosenNode.y, width: placedWidth, length: placedLength, rotated: bestWasRotated, originalWidth: rect.originalWidth, originalLength: rect.originalLength, transform: rect.transform, pairId: rect.pairId, pieceIndex: rect.pieceIndex, splitDirection: rect.splitDirection };
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

  // === CHIẾN LƯỢC: BLSF (GIỮ NGUYÊN) ===
  _maxRectsBLSF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1;
      let bestLong = Infinity;
      let bestShort = Infinity;
      let chosenNode = null;
      let bestWasRotated = false;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        if (fitsIn(rect.width, rect.length, node)) {
          const dw = node.width - rect.width;
          const dh = node.length - rect.length;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          if (longFit < bestLong || (longFit === bestLong && shortFit < bestShort)) {
            bestShort = shortFit;
            bestLong = longFit;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = false;
          }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const dw = node.width - rect.length;
          const dh = node.length - rect.width;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          if (longFit < bestLong || (longFit === bestLong && shortFit < bestShort)) {
            bestShort = shortFit;
            bestLong = longFit;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = true;
          }
        }
      }
      if (bestIndex !== -1 && chosenNode) {
        const placedWidth = bestWasRotated ? rect.length : rect.width;
        const placedLength = bestWasRotated ? rect.width : rect.length;
        const placed = { ...rect, x: chosenNode.x, y: chosenNode.y, width: placedWidth, length: placedLength, rotated: bestWasRotated, originalWidth: rect.originalWidth, originalLength: rect.originalLength, transform: rect.transform, pairId: rect.pairId, pieceIndex: rect.pieceIndex, splitDirection: rect.splitDirection };
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

  // === CHIẾN LƯỢC: BL (GIỮ NGUYÊN) ===
  _maxRectsBL(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;

      let bestIndex = -1;
      let bestScore = Infinity; // Y * Width + X
      let chosenNode = null;
      let bestWasRotated = false;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const rotationPenalty = forceGridPreference ? (this.container.width * this.container.length * 10) : 0;

        // Thử không xoay
        if (fitsIn(rect.width, rect.length, node)) {
          const score = node.y * this.container.width + node.x;
          if (score < bestScore) {
            bestScore = score;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = false;
          }
        }

        // Thử xoay
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const score = (node.y * this.container.width + node.x) + rotationPenalty;
           if (score < bestScore) {
            bestScore = score;
            bestIndex = i;
            chosenNode = node;
            bestWasRotated = true;
          }
        }
      }

      if (bestIndex !== -1 && chosenNode) {
        const placedWidth = bestWasRotated ? rect.length : rect.width;
        const placedLength = bestWasRotated ? rect.width : rect.length;
        const placed = { ...rect, x: chosenNode.x, y: chosenNode.y, width: placedWidth, length: placedLength, rotated: bestWasRotated, originalWidth: rect.originalWidth, originalLength: rect.originalLength, transform: rect.transform, pairId: rect.pairId, pieceIndex: rect.pieceIndex, splitDirection: rect.splitDirection };
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

  // === CÁC HÀM CŨ (GIỮ NGUYÊN HOÀN TOÀN) ===
  
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
      
      for (let i = 0; i < freeSpaces.length; i++) {
          const space = freeSpaces[i];
          if (this.canFitInSpace(rect, space)) {
              const waste = space.y * this.container.width + space.x; 
              if (waste < bestWaste) {
                  bestWaste = waste;
                  bestSpaceIndex = i;
              }
          }
      }

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

        const newFreeSpaces = [];
        if (usedSpace.length > placedRect.length) {
          newFreeSpaces.push({
            x: usedSpace.x,
            y: usedSpace.y + placedRect.length,
            width: usedSpace.width,
            length: usedSpace.length - placedRect.length
          });
        }
        if (usedSpace.width > placedRect.width) {
          newFreeSpaces.push({
            x: usedSpace.x + placedRect.width,
            y: usedSpace.y,
            width: usedSpace.width - placedRect.width,
            length: placedRect.length 
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
          
          if (!fit && !rect.noRotate) { 
            [width, length] = [length, width];
            fit = checkFit(currentX, currentY, width, length);
            if (fit) {
              rect.rotated = !rect.rotated; 
            }
          }
          
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
            layer: 0,
            rotated: rect.rotated 
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
    if (placedRect.x + placedRect.width < usedSpace.x + usedSpace.width) {
      freeSpaces.push({
        x: placedRect.x + placedRect.width,
        y: usedSpace.y,
        width: usedSpace.x + usedSpace.width - (placedRect.x + placedRect.width),
        length: placedRect.length
      });
    }
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
  
  _runGreedyLayeringPass(container, initialRectangles, maxLayers) {
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
    let allPlacedRectangles = [];
    let layersUsed = 0;

      const canFit = (r) => (r.width <= container.width && r.length <= container.length) || (r.length <= container.width && r.width <= container.length);

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
      
      for (let layer = 0; layer < maxLayers; layer++) {
    
        if (unpackedRectangles.length === 0) {
          break;
        }

        const { placed: placedRaw, remaining: remainingRaw } = this._runSingleLayerPacking(unpackedRectangles);
        
        const sanitizeResult = sanitizeLayer(placedRaw, []); 
        let placedInLayer = sanitizeResult.accepted; 

        unpackedRectangles = [...sanitizeResult.stillRemaining, ...remainingRaw]; 

        placedInLayer.forEach(rect => {
          rect.layer = layer; 
          allPlacedRectangles.push(rect); 
        });
          
        if (placedInLayer.length > 0) {
          layersUsed++;
        } else {
          break;
        }

      }

      const containerAreaPerLayer = container.width * container.length;
      const finalUsedArea = allPlacedRectangles.reduce((sum, rect) => 
        sum + (rect.width * rect.length), 0
      );
      const totalUsedArea = containerAreaPerLayer * layersUsed; 

      return {
        rectangles: allPlacedRectangles,
        remainingRectangles: unpackedRectangles,
        remainingFeasibleCount: unpackedRectangles.filter(canFit).length,
        remainingUnfitCount: unpackedRectangles.length - unpackedRectangles.filter(canFit).length,
        efficiency: totalUsedArea > 0 ? (finalUsedArea / totalUsedArea) * 100 : 0, 
        usedArea: finalUsedArea,
        totalArea: totalUsedArea, 
        wasteArea: totalUsedArea - finalUsedArea,
        layersUsed: layersUsed
      };
    }

  async optimize(container, initialRectangles, maxLayers) {
    this.startTime = Date.now(); 
    this.container = container;
    try {
      this.checkTimeout(30);
      const bestResult = this._runGreedyLayeringPass(
        container, 
        initialRectangles, 
        maxLayers
      );
      return bestResult;
    } catch (error) {
      console.error(`[Algorithm] ✗ Lỗi:`, error);
      throw error;
    }
  }
}

export default PackingAlgorithm;