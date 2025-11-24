// server/algorithms/strategies/BaseStrategy.js

class BaseStrategy {
  constructor(container) {
    this.container = container;
  }

  // --- 1. CÁC HÀM SẮP XẾP (SORTING) ---

  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.length;
      const areaB = b.width * b.length;
      if (areaA !== areaB) return areaB - areaA;
      return Math.max(b.width, b.length) - Math.max(a.width, a.length);
    });
  }

  // [Đã bổ sung] Hàm này bị thiếu ở lần trước
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

  sortRectanglesByHeight(rectangles) {
     return rectangles.slice().sort((a, b) => {
        if (Math.abs(b.length - a.length) > 0.1) return b.length - a.length;
        if (Math.abs(b.width - a.width) > 0.1) return b.width - a.width;
        return 0;
    });
  }

  sortRectanglesByWidth(rectangles) {
    return rectangles.slice().sort((a, b) => {
        if (Math.abs(b.width - a.width) > 0.1) return b.width - a.width;
        if (Math.abs(b.length - a.length) > 0.1) return b.length - a.length;
        return 0;
    });
  }

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

  // --- TÍNH ĐIỂM ---
  _calculateAlignmentScore(placedRectangles) {
    let score = 0;
    const rects = placedRectangles;
    for (let i = 0; i < rects.length; i++) {
        // Vẫn trừ điểm nếu xoay (tuỳ chọn, có thể bỏ nếu bạn không quan trọng xoay)
        if (rects[i].rotated) score -= 2; 

        for (let j = i + 1; j < rects.length; j++) {
            const touchingX = Math.abs((rects[i].x + rects[i].width) - rects[j].x) < 0.1; // Cạnh phải r[i] chạm cạnh trái r[j]
            const touchingY = Math.abs((rects[i].y + rects[i].length) - rects[j].y) < 0.1; // Cạnh dưới r[i] chạm cạnh trên r[j]
            
            const sameWidth = Math.abs(rects[i].width - rects[j].width) < 0.1;
            const sameLength = Math.abs(rects[i].length - rects[j].length) < 0.1;
            // logic mới: THƯỞNG LỚN nếu 2 tấm GIỐNG HỆT KÍCH THƯỚC nằm cạnh nhau -> Tạo thành size nguyên
            
            // Trường hợp 1: Chạm nhau theo chiều ngang (X)
            if (touchingX && Math.abs(rects[i].y - rects[j].y) < 0.1) {
                score += 50; // Điểm cơ bản
                if (sameLength) { 
                    score += 200; // BONUS LỚN: Cùng chiều cao + chạm nhau = Dễ cắt 1 đường
                }
                if (sameLength && sameWidth) {
                    score += 500; // SUPER BONUS: Hai tấm y hệt nhau nằm cạnh nhau -> Size nguyên
                }
            }

            // Trường hợp 2: Chạm nhau theo chiều dọc (Y)
            if (touchingY && Math.abs(rects[i].x - rects[j].x) < 0.1) {
                score += 50; // Điểm cơ bản
                if (sameWidth) {
                    score += 200; // BONUS LỚN: Cùng chiều rộng + chồng lên nhau
                }
                if (sameWidth && sameLength) {
                     score += 500; // SUPER BONUS: Hai tấm y hệt nhau chồng lên nhau
                }
            }
        }
    }
    return score;
  }

  // --- CÁC HÀM HELPER (GIỮ NGUYÊN 100% TỪ FILE GỐC) ---
  canFitInSpace(rect, space) {
    return rect.width <= space.width && rect.length <= space.length;
  }

  placeRectangle(rect, space) {
    return { ...rect, x: space.x, y: space.y, layer: 0 };
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

  _maxRectsCommonHelpers() {
    const fitsIn = (w, h, node) => w <= node.width && h <= node.length;
    const splitFreeNode = (node, placed) => {
      const remainingNodes = [];
      if (node.length > placed.length) {
        remainingNodes.push({ x: node.x, y: node.y + placed.length, width: node.width, length: node.length - placed.length });
      }
      if (node.width > placed.width) {
        remainingNodes.push({ x: node.x + placed.width, y: node.y, width: node.width - placed.width, length: placed.length });
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

  // --- 3. CÁC THUẬT TOÁN PACKING (GIỮ NGUYÊN 100%) ---

  _shelfNextFitSmart(rectanglesToPack, forceSort = true) {
    let rects = forceSort ? this.sortRectanglesByHeight(rectanglesToPack) : [...rectanglesToPack];
    const placedRectangles = [];
    const usedRectIds = new Set();
    let currentX = 0;
    let currentY = 0;
    let currentShelfHeight = 0;
    
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (usedRectIds.has(rect.id)) continue;
      let placedWidth = rect.width;
      let placedLength = rect.length;
      let placedRotated = rect.rotated || false;

      if (currentX + placedWidth > this.container.width) {
        currentX = 0;
        currentY += currentShelfHeight;
        currentShelfHeight = 0; 
      }
      if (currentY + placedLength > this.container.length) continue;

      const placed = { ...rect, x: currentX, y: currentY, width: placedWidth, length: placedLength, rotated: placedRotated, layer: 0 };
      placedRectangles.push(placed);
      usedRectIds.add(rect.id);

      let currentStackHeight = placedLength;
      if (currentStackHeight > currentShelfHeight) currentShelfHeight = currentStackHeight;

      let currentStackY = currentY + placedLength;
      while (true) {
        let bestStackIndex = -1;
        for (let j = i + 1; j < rects.length; j++) {
          const candidate = rects[j];
          if (usedRectIds.has(candidate.id)) continue;
          if (Math.abs(candidate.width - placedWidth) > 0.1) continue;
          if (currentStackY + candidate.length > this.container.length) continue;
          bestStackIndex = j;
          break; 
        }
        if (bestStackIndex !== -1) {
          const stackedRect = rects[bestStackIndex];
          const stackedPlaced = { ...stackedRect, x: currentX, y: currentStackY, width: stackedRect.width, length: stackedRect.length, rotated: stackedRect.rotated || false, layer: 0 };
          placedRectangles.push(stackedPlaced);
          usedRectIds.add(stackedRect.id);
          currentStackY += stackedRect.length;
          currentStackHeight += stackedRect.length;
          if (currentStackHeight > currentShelfHeight) currentShelfHeight = currentStackHeight;
        } else {
          break;
        }
      }
      currentX += placedWidth;
    }
    const remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));
    return { placed: placedRectangles, remaining: remainingRectangles };
  }

  _maxRectsBSSF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1, bestShort = Infinity, bestLong = Infinity, chosenNode = null, bestWasRotated = false;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const rotationPenalty = forceGridPreference ? 10000 : 0; 
        if (fitsIn(rect.width, rect.length, node)) {
          const dw = node.width - rect.width;
          const dh = node.length - rect.length;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          let score = shortFit;
          if (forceGridPreference && (dw === 0 || dh === 0)) score -= 500;
          if (score < bestShort || (score === bestShort && longFit < bestLong)) {
            bestShort = score; bestLong = longFit; bestIndex = i; chosenNode = node; bestWasRotated = false;
          }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const dw = node.width - rect.length;
          const dh = node.length - rect.width;
          const shortFit = Math.min(dw, dh);
          const longFit = Math.max(dw, dh);
          let score = shortFit + rotationPenalty;
          if (forceGridPreference && (dw === 0 || dh === 0)) score -= 500;
          if (score < bestShort || (score === bestShort && longFit < bestLong)) {
            bestShort = score; bestLong = longFit; bestIndex = i; chosenNode = node; bestWasRotated = true;
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

  _maxRectsBAF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];
    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1, bestScore = Infinity, chosenNode = null, bestWasRotated = false;
      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const nodeArea = node.width * node.length;
        const rotationPenalty = forceGridPreference ? (nodeArea * 5) : 0;
        if (fitsIn(rect.width, rect.length, node)) {
          const waste = nodeArea - (rect.width * rect.length);
          if (waste < bestScore) { bestScore = waste; bestIndex = i; chosenNode = node; bestWasRotated = false; }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const waste = nodeArea - (rect.length * rect.width);
          if ((waste + rotationPenalty) < bestScore) { bestScore = waste + rotationPenalty; bestIndex = i; chosenNode = node; bestWasRotated = true; }
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

  _maxRectsBLSF(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];
    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1, bestLong = Infinity, bestShort = Infinity, chosenNode = null, bestWasRotated = false;
      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        if (fitsIn(rect.width, rect.length, node)) {
          const dw = node.width - rect.width; const dh = node.length - rect.length;
          const shortFit = Math.min(dw, dh); const longFit = Math.max(dw, dh);
          if (longFit < bestLong || (longFit === bestLong && shortFit < bestShort)) {
            bestShort = shortFit; bestLong = longFit; bestIndex = i; chosenNode = node; bestWasRotated = false;
          }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const dw = node.width - rect.length; const dh = node.length - rect.width;
          const shortFit = Math.min(dw, dh); const longFit = Math.max(dw, dh);
          if (longFit < bestLong || (longFit === bestLong && shortFit < bestShort)) {
            bestShort = shortFit; bestLong = longFit; bestIndex = i; chosenNode = node; bestWasRotated = true;
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

  _maxRectsBL(rectanglesToPack, forceGridPreference = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];
    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestIndex = -1, bestScore = Infinity, chosenNode = null, bestWasRotated = false;
      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];
        const rotationPenalty = forceGridPreference ? (this.container.width * this.container.length * 10) : 0;
        if (fitsIn(rect.width, rect.length, node)) {
          const score = node.y * this.container.width + node.x;
          if (score < bestScore) { bestScore = score; bestIndex = i; chosenNode = node; bestWasRotated = false; }
        }
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const score = (node.y * this.container.width + node.x) + rotationPenalty;
           if (score < bestScore) { bestScore = score; bestIndex = i; chosenNode = node; bestWasRotated = true; }
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

  _bottomLeftFill(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    let freeSpaces = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }]; 
    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      let bestSpaceIndex = -1;
      let bestWaste = Infinity;
      for (let i = 0; i < freeSpaces.length; i++) {
          const space = freeSpaces[i];
          if (this.canFitInSpace(rect, space)) {
              const waste = space.y * this.container.width + space.x; 
              if (waste < bestWaste) { bestWaste = waste; bestSpaceIndex = i; }
          }
      }
      if (bestSpaceIndex !== -1) {
        const usedSpace = freeSpaces[bestSpaceIndex];
        const placedRect = { ...rect, x: usedSpace.x, y: usedSpace.y, layer: 0 };
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        const newFreeSpaces = [];
        if (usedSpace.length > placedRect.length) {
          newFreeSpaces.push({ x: usedSpace.x, y: usedSpace.y + placedRect.length, width: usedSpace.width, length: usedSpace.length - placedRect.length });
        }
        if (usedSpace.width > placedRect.width) {
          newFreeSpaces.push({ x: usedSpace.x + placedRect.width, y: usedSpace.y, width: usedSpace.width - placedRect.width, length: placedRect.length });
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
    let currentX = 0, currentY = 0, currentLength = 0;
    for (const rect of rectanglesToPack) {
        if (usedRectIds.has(rect.id)) continue;
        let width = rect.width, length = rect.length;
        const checkFit = (x, y, w, h) => (x + w <= this.container.width && y + h <= this.container.length);
        let fit = checkFit(currentX, currentY, width, length);
        if (!fit) {
          currentX = 0; currentY += currentLength; currentLength = 0;
          fit = checkFit(currentX, currentY, width, length);
          if (!fit && !rect.noRotate) { 
            [width, length] = [length, width];
            fit = checkFit(currentX, currentY, width, length);
            if (fit) { rect.rotated = !rect.rotated; }
          }
          if (!fit) { remainingRectangles.push(rect); continue; }
        }
        const placedRect = { ...rect, width: width, length: length, x: currentX, y: currentY, layer: 0, rotated: rect.rotated };
        placedRectangles.push(placedRect);
        usedRectIds.add(rect.id);
        currentX += width;
        currentLength = Math.max(currentLength, length);
        if (currentX >= this.container.width) { currentX = 0; currentY += currentLength; currentLength = 0; }
    }
    remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));
    return { placed: placedRectangles, remaining: remainingRectangles };
  }
  
  execute(rectanglesToPack) {
    throw new Error("Method 'execute' must be implemented by subclasses");
  }
}

export default BaseStrategy;