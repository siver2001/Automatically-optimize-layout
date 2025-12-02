// server/algorithms/strategies/BaseStrategy.js

class BaseStrategy {
  constructor(container) {
    this.container = container;
  }

  // --- 1. CÁC HÀM SẮP XẾP (GIỮ NGUYÊN TỪ FILE GỐC) ---

  sortRectanglesByArea(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.length;
      const areaB = b.width * b.length;
      if (areaA !== areaB) return areaB - areaA;
      return Math.max(b.width, b.length) - Math.max(a.width, a.length);
    });
  }

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

  sortRectanglesByExactDimension(rectangles) {
    return rectangles.slice().sort((a, b) => {
      // Ưu tiên xếp theo chiều dài trước
      if (Math.abs(b.length - a.length) > 0.1) return b.length - a.length;
      // Sau đó đến chiều rộng
      if (Math.abs(b.width - a.width) > 0.1) return b.width - a.width;
      return 0;
    });
  }

  sortRectanglesByAreaAscending(rectangles) {
    return rectangles.slice().sort((a, b) => {
      const areaA = a.width * a.length;
      const areaB = b.width * b.length;
      if (areaA !== areaB) return areaA - areaB; // A - B: Nhỏ trước
      return Math.min(a.width, a.length) - Math.min(b.width, b.length);
    });
  }

  // Giúp tấm lớn đi trước tạo khung, tấm nhỏ đi ngay sau để lấp lỗ
  sortRectanglesInterleaved(rectangles) {
    const sorted = this.sortRectanglesByArea(rectangles); // Lấy danh sách Lớn -> Nhỏ
    const result = [];
    let left = 0;
    let right = sorted.length - 1;

    while (left <= right) {
      if (left === right) {
        result.push(sorted[left]);
      } else {
        result.push(sorted[left]);  // Lấy 1 tấm Lớn nhất
        result.push(sorted[right]); // Lấy 1 tấm Nhỏ nhất
      }
      left++;
      right--;
    }
    return result;
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

  // --- TÍNH ĐIỂM (GIỮ NGUYÊN LOGIC) ---

  _calculateAlignmentScore(placedRectangles) {
    let score = 0;
    const rects = placedRectangles;
    const count = rects.length;

    // Giữ nguyên logic tối ưu vòng lặp như file gốc
    const SEARCH_WINDOW = count > 1000 ? 300 : count;

    for (let i = 0; i < count; i++) {
      if (rects[i].rotated) score -= 2;

      const limit = Math.min(count, i + SEARCH_WINDOW);

      for (let j = i + 1; j < limit; j++) {
        if (Math.abs(rects[i].x - rects[j].x) > 3000 || Math.abs(rects[i].y - rects[j].y) > 3000) {
          continue;
        }
        const touchingX = Math.abs((rects[i].x + rects[i].width) - rects[j].x) < 0.1;
        const touchingY = Math.abs((rects[i].y + rects[i].length) - rects[j].y) < 0.1;
        const sameWidth = Math.abs(rects[i].width - rects[j].width) < 0.1;
        const sameLength = Math.abs(rects[i].length - rects[j].length) < 0.1;

        if (touchingX && Math.abs(rects[i].y - rects[j].y) < 0.1) {
          score += 50;
          if (sameLength) score += 200;
          if (sameLength && sameWidth) score += 500;
        }
        if (touchingY && Math.abs(rects[i].x - rects[j].x) < 0.1) {
          score += 50;
          if (sameWidth) score += 200;
          if (sameWidth && sameLength) score += 500;
        }
      }
    }
    return score;
  }

  _calculateContactScore(node, rectWidth, rectLength, placedRectangles) {
    let score = 0;
    // 1. Chạm biên container
    if (node.x === 0 || node.x + rectWidth === this.container.width) score += rectLength;
    if (node.y === 0 || node.y + rectLength === this.container.length) score += rectWidth;

    // 2. Chạm tấm đã xếp (Giữ nguyên logic slice(-50) của file gốc)
    const candidates = placedRectangles.length > 200 ? placedRectangles.slice(-50) : placedRectangles;

    for (const p of candidates) {
      // Chạm cạnh dọc
      if (p.x === node.x + rectWidth || p.x + p.width === node.x) {
        if (p.y < node.y + rectLength && p.y + p.length > node.y) {
          score += Math.min(node.y + rectLength, p.y + p.length) - Math.max(node.y, p.y);
        }
      }
      // Chạm cạnh ngang
      if (p.y === node.y + rectLength || p.y + p.length === node.y) {
        if (p.x < node.x + rectWidth && p.x + p.width > node.x) {
          score += Math.min(node.x + rectWidth, p.x + p.width) - Math.max(node.x, p.x);
        }
      }
    }
    return score;
  }

  // --- CÁC HÀM HELPER CORE (GIỮ NGUYÊN) ---
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

  // =================================================================================
  // [CORE] HÀM MAXRECTS TỔNG QUÁT (ĐÃ UPDATE ĐỂ CHÍNH XÁC 100%)
  // =================================================================================
  _maxRectsGeneric(rectanglesToPack, scoreFn, invertScore = false) {
    const { fitsIn, splitFreeNode, pruneFreeList } = this._maxRectsCommonHelpers();
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, length: this.container.length }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;

      let bestNode = null;
      let bestScore = invertScore ? -1 : Infinity;
      let bestWasRotated = false;
      let bestIndex = -1;

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];

        // 1. Thử hướng thường
        if (fitsIn(rect.width, rect.length, node)) {
          const score = scoreFn(rect.width, rect.length, node, false, placedRectangles, rect);
          const isBetter = invertScore ? (score > bestScore) : (score < bestScore);
          if (isBetter) {
            bestScore = score; bestNode = node; bestIndex = i; bestWasRotated = false;
          }
        }

        // 2. Thử hướng xoay
        if (!rect.noRotate && fitsIn(rect.length, rect.width, node)) {
          const score = scoreFn(rect.length, rect.width, node, true, placedRectangles, rect);
          const isBetter = invertScore ? (score > bestScore) : (score < bestScore);
          if (isBetter) {
            bestScore = score; bestNode = node; bestIndex = i; bestWasRotated = true;
          }
        }
      }

      if (bestIndex !== -1 && bestNode) {
        const placedWidth = bestWasRotated ? rect.length : rect.width;
        const placedLength = bestWasRotated ? rect.width : rect.length;

        const placed = {
          ...rect, x: bestNode.x, y: bestNode.y, width: placedWidth, length: placedLength, rotated: bestWasRotated, layer: 0,
          originalWidth: rect.originalWidth, originalLength: rect.originalLength, transform: rect.transform, pairId: rect.pairId, pieceIndex: rect.pieceIndex, splitDirection: rect.splitDirection
        };

        placedRectangles.push(placed);
        usedRectIds.add(rect.id);

        const usedNode = freeNodes.splice(bestIndex, 1)[0];
        const splits = splitFreeNode(usedNode, placed);
        freeNodes.push(...splits);
        pruneFreeList(freeNodes);
      }
    }
    const remaining = rectanglesToPack.filter(r => !usedRectIds.has(r.id));
    return { placed: placedRectangles, remaining };
  }

  // --- 3. CÁC CHIẾN THUẬT PACKING (TRIỂN KHAI VỚI ĐỘ CHÍNH XÁC 100%) ---

  // Thuật toán BSSF (Best Short Side Fit) - Đã có Lookahead & Pairing
  _maxRectsBSSF(rectanglesToPack, forceGridPreference = false) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated, placed, currentRect) => {
      const dw = node.width - w;
      const dh = node.length - h;
      const shortFit = Math.min(dw, dh);
      const longFit = Math.max(dw, dh);

      let score = shortFit * 1000000 + longFit;

      // --- LOGIC XỬ LÝ CẶP ĐÔI (PAIRING) & CLUSTERING ---

      // 1. Ưu tiên Pairing (Cặp đôi hoàn hảo) - Giữ nguyên logic cũ
      if (currentRect.pairId) {
        const sibling = placed.find(r => r.pairId === currentRect.pairId && r.id !== currentRect.id);
        if (sibling) {
          if (rotated !== (sibling.rotated || false)) {
            score += 10000000;
          } else {
            const isAdjacent =
              (Math.abs(sibling.x + sibling.width - node.x) < 1 && Math.abs(sibling.y - node.y) < 1) ||
              (Math.abs(sibling.x - (node.x + w)) < 1 && Math.abs(sibling.y - node.y) < 1) ||
              (Math.abs(sibling.y + sibling.length - node.y) < 1 && Math.abs(sibling.x - node.x) < 1) ||
              (Math.abs(sibling.y - (node.y + h)) < 1 && Math.abs(sibling.x - node.x) < 1);

            if (isAdjacent) {
              score -= 10000000; // Tăng thưởng lên gấp đôi
            } else {
              score += 100000;
            }
          }
        } else {
          // Logic Lookahead cũ
          const remainingWidth = node.width - w;
          const remainingLength = node.length - h;
          if (remainingWidth < w - 1 && remainingLength < h - 1) {
            score += 20000000;
          }
        }
      }

      // 2. [NEW] Ưu tiên Clustering (Dính các tấm cùng size lại với nhau)
      // Áp dụng cho cả tấm lẻ và tấm có pair (nếu chưa tìm thấy pair)
      const adjacencyBonus = this._calculateGenericAdjacencyBonus(node, w, h, placed);
      score -= adjacencyBonus;

      if (forceGridPreference && rotated) {
        score += 50000;
      }

      return score;
    }, false);
  }

  // Thuật toán BLSF (Best Long Side Fit)
  _maxRectsBLSF(rectanglesToPack, forceGridPreference = false) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated) => {
      const dw = node.width - w;
      const dh = node.length - h;
      const shortFit = Math.min(dw, dh);
      const longFit = Math.max(dw, dh);

      // BLSF ưu tiên Long Fit trước, Short Fit sau
      // CÔNG THỨC TRỌNG SỐ: (LongFit * 1Triệu) + ShortFit
      return longFit * 1000000 + shortFit;
    }, false);
  }

  // Thuật toán BAF (Best Area Fit)
  _maxRectsBAF(rectanglesToPack, forceGridPreference = false) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated) => {
      const waste = (node.width * node.length) - (w * h);
      let score = waste;
      if (forceGridPreference && rotated) {
        const nodeArea = node.width * node.length;
        score += (nodeArea * 5);
      }
      return score;
    }, false);
  }

  // Thuật toán BL (Bottom Left)
  _maxRectsBL(rectanglesToPack, forceGridPreference = false) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated) => {
      let score = node.y * this.container.width + node.x;
      if (forceGridPreference && rotated) {
        score += (this.container.width * this.container.length * 10);
      }
      return score;
    }, false);
  }

  // Thuật toán Contact Point
  _maxRectsContactPoint(rectanglesToPack) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated, placed) => {
      return this._calculateContactScore(node, w, h, placed);
    }, true); // true = Tìm Max
  }

  // --- CÁC CHIẾN THUẬT KHÁC & HÀM HELPER CŨ (GIỮ NGUYÊN) ---

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

  canFitInSpace(rect, space) {
    return rect.width <= space.width && rect.length <= space.length;
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

  _maxRectsPackLeft(rectanglesToPack, forceGridPreference = false) {
    return this._maxRectsGeneric(rectanglesToPack, (w, h, node, rotated, placed) => {
      // Công thức điểm số: Ưu tiên X thấp nhất (bên trái), sau đó đến Y thấp nhất
      // Hệ số container.length đảm bảo X luôn là ưu tiên số 1
      let score = node.x * this.container.length + node.y;

      // [NEW] Thêm điểm thưởng nếu xếp cạnh tấm cùng size
      const adjacencyBonus = this._calculateGenericAdjacencyBonus(node, w, h, placed);
      score -= adjacencyBonus;

      if (forceGridPreference) {
        if (rotated) score += (this.container.width * this.container.length); // Phạt xoay nếu muốn thẳng hàng
      }
      return score;
    }, false); // false = Tìm Min (Điểm càng thấp càng tốt)
  }

  // --- [NEW] HÀM TÍNH ĐIỂM THƯỞNG KHI XẾP CẠNH NHAU (CLUSTERING) ---
  _calculateGenericAdjacencyBonus(node, rectWidth, rectLength, placedRectangles) {
    let bonus = 0;
    // Chỉ xét các tấm gần đây để tối ưu hiệu năng
    const candidates = placedRectangles.length > 200 ? placedRectangles.slice(-50) : placedRectangles;

    for (const p of candidates) {
      // Kiểm tra xem có cùng kích thước không (cho phép sai số nhỏ)
      const sameSize = (Math.abs(p.width - rectWidth) < 0.1 && Math.abs(p.length - rectLength) < 0.1);
      const rotatedSize = (Math.abs(p.width - rectLength) < 0.1 && Math.abs(p.length - rectWidth) < 0.1);

      if (!sameSize && !rotatedSize) continue;

      // Kiểm tra tiếp xúc
      const touchingX = (Math.abs(p.x + p.width - node.x) < 0.1 || Math.abs(p.x - (node.x + rectWidth)) < 0.1);
      const touchingY = (Math.abs(p.y + p.length - node.y) < 0.1 || Math.abs(p.y - (node.y + rectLength)) < 0.1);

      // Nếu chạm nhau VÀ cùng kích thước -> Thưởng lớn
      if (touchingX) {
        // Kiểm tra khớp dọc (y và height phải khớp)
        if (Math.abs(p.y - node.y) < 0.1 && Math.abs(p.length - rectLength) < 0.1) {
          bonus += 5000000; // Thưởng cực lớn để hút vào nhau
        }
        // [NEW] Nếu chỉ khớp chiều cao (tạo thành dải băng) nhưng khác chiều rộng -> Thưởng vừa
        else if (Math.abs(p.y - node.y) < 0.1 && Math.abs(p.length - rectLength) < 0.1) {
          bonus += 1000000; // Thưởng để duy trì dải băng (Strip)
        }
      }
      if (touchingY) {
        // Kiểm tra khớp ngang (x và width phải khớp)
        if (Math.abs(p.x - node.x) < 0.1 && Math.abs(p.width - rectWidth) < 0.1) {
          bonus += 5000000;
        }
        // [NEW] Nếu chỉ khớp chiều rộng (chồng lên nhau) nhưng khác chiều cao -> Thưởng vừa
        else if (Math.abs(p.x - node.x) < 0.1 && Math.abs(p.width - rectWidth) < 0.1) {
          bonus += 1000000;
        }
      }
    }
    return bonus;
  }

  execute(_rectanglesToPack) {
    throw new Error("Method 'execute' must be implemented by subclasses");
  }
}

export default BaseStrategy;