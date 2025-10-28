// server/algorithms/packingAlgorithm.js

import Rectangle from '../models/Rectangle.js';
import { performance } from 'perf_hooks';

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

  // Shuffle (Hoán vị ngẫu nhiên) for meta-heuristic
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // --- Core 2D Packing Logic (Chọn chiến lược tốt nhất cho 1 lớp) ---
  run2DPacking(rectanglesToPack) {
    const sortedRectangles = rectanglesToPack; 

    const strategies = [
      () => this._maxRectsBSSF(sortedRectangles),
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

  // MaxRects/Guillotine variant using Best Short Side Fit
  _maxRectsBSSF(rectanglesToPack) {
    const placedRectangles = [];
    const usedRectIds = new Set();
    const freeNodes = [{ x: 0, y: 0, width: this.container.width, height: this.container.height }];

    const fitsIn = (rect, node) => rect.width <= node.width && rect.height <= node.height;

    const scoreFor = (rect, node) => {
      const dw = node.width - rect.width;
      const dh = node.height - rect.height;
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
          height: node.height
        });
      }
      // Split above
      if (placed.y + placed.height < node.y + node.height) {
        newNodes.push({
          x: node.x,
          y: placed.y + placed.height,
          width: node.width,
          height: node.y + node.height - (placed.y + placed.height)
        });
      }
      return newNodes;
    };

    const rectContains = (a, b) => a.x <= b.x && a.y <= b.y && (a.x + a.width) >= (b.x + b.width) && (a.y + a.height) >= (b.y + b.height);

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
      let bestRotated = false;
      let bestShort = Infinity;
      let bestLong = Infinity;
      let chosenNode = null;
      let chosenSize = { width: rect.width, height: rect.height };

      for (let i = 0; i < freeNodes.length; i++) {
        const node = freeNodes[i];

        // Chỉ kiểm tra trường hợp normal (BỎ QUA XOAY)
        if (fitsIn(rect, node)) {
          const s = scoreFor(rect, node);
          if (s.shortFit < bestShort || (s.shortFit === bestShort && s.longFit < bestLong)) {
            bestShort = s.shortFit;
            bestLong = s.longFit;
            bestIndex = i;
            bestRotated = false; // Luôn là false
            chosenNode = node;
            chosenSize = { width: rect.width, height: rect.height };
          }
        }
      }

      if (bestIndex !== -1 && chosenNode) {
        const placed = {
          ...rect,
          width: chosenSize.width,
          height: chosenSize.height,
          x: chosenNode.x,
          y: chosenNode.y,
          layer: 0,
          rotated: bestRotated // Luôn là false
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
      height: this.container.height
    }];

    for (const rect of rectanglesToPack) {
      if (usedRectIds.has(rect.id)) continue;
      
      let bestSpaceIndex = -1;
      let bestWaste = Infinity;
      let isRotated = false;

      // Chỉ kiểm tra trường hợp normal (BỎ QUA XOAY)
      const attempts = [
          { rect: rect, rotated: false }
      ];

      for (const attempt of attempts) {
          for (let i = 0; i < freeSpaces.length; i++) {
              const space = freeSpaces[i];
              if (this.canFitInSpace(attempt.rect, space)) {
                  const waste = this.calculateWaste(attempt.rect, space);
                  if (waste < bestWaste) {
                      bestWaste = waste;
                      bestSpaceIndex = i;
                      isRotated = attempt.rotated; // Luôn là false
                  }
              }
          }
      }
      
      if (bestSpaceIndex !== -1) {
        const bestSpace = freeSpaces[bestSpaceIndex];
        
        const placedRect = {
            ...rect,
            width: rect.width, // Không xoay
            height: rect.height, // Không xoay
            x: bestSpace.x,
            y: bestSpace.y,
            layer: 0,
            rotated: false // Luôn là false
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
    let currentHeight = 0;

    for (const rect of rectanglesToPack) {
        if (usedRectIds.has(rect.id)) continue;
        
        let width = rect.width;
        let height = rect.height;

        const checkFitAndRotate = (x, y, w, h) => {
            const fitNormal = (x + w <= this.container.width && y + h <= this.container.height);
            // BỎ QUA KIỂM TRA XOAY
            
            if (fitNormal) return { w, h, rotated: false };
            return null;
        };

        let placement = checkFitAndRotate(currentX, currentY, width, height);

        if (!placement) {
            currentX = 0;
            currentY += currentHeight;
            currentHeight = 0;
            
            placement = checkFitAndRotate(currentX, currentY, width, height);
            
            if (!placement) {
                remainingRectangles.push(rect);
                continue;
            }
        }
        
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
        
        currentX += placement.w;
        currentHeight = Math.max(currentHeight, placement.h);

        if (currentX >= this.container.width) {
            currentX = 0;
            currentY += currentHeight;
            currentHeight = 0;
        }
    }

    remainingRectangles = rectanglesToPack.filter(rect => !usedRectIds.has(rect.id));

    return { placed: placedRectangles, remaining: remainingRectangles };
  }
  
  canFitInSpace(rect, space) {
    return rect.width <= space.width && rect.height <= space.height;
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

    freeSpaces.sort((a, b) => a.y - b.y || a.x - b.x); 
  }

  calculateWaste(rect, space) {
    return (space.width * space.height) - (rect.width * rect.height);
  }

  // --- Base Greedy Layering Heuristic (Chỉ chạy 1 lần) ---
  _runGreedyLayeringPass(container, initialRectangles, maxLayers) {
    let unpackedRectangles = initialRectangles.map(r => ({...r}));
    let allPlacedRectangles = [];
    let layersUsed = 0;

    const canFitEither = (r) => (
      // Chỉ cần kiểm tra kích thước gốc, không cần xoay
      (r.width <= container.width && r.height <= container.height)
    );

    // Helper to sanitize placements 
    const sanitizeLayer = (placed, remaining) => {
        // (Logic sanitize giữ nguyên)
        const accepted = [];
        const stillRemaining = [...remaining];
        const isWithinBounds = (r) => r.x >= 0 && r.y >= 0 && (r.x + r.width) <= container.width && (r.y + r.height) <= container.height;
        const overlaps = (a, b) => (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y);
        
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
      
      // Sắp xếp các hình còn lại theo diện tích giảm dần (chiến lược mặc định cho pass này)
      const sortedForLayer = this.sortRectanglesByArea(unpackedRectangles);
      
      // Chạy thuật toán 2D tốt nhất trên danh sách đã sắp xếp
      const { placed: placedRaw, remaining: remainingRaw } = this.run2DPacking(sortedForLayer);
      
      // Sanitize the placements
      const { accepted: placedInLayer, stillRemaining } = sanitizeLayer(placedRaw, remainingRaw);
      
      if (placedInLayer.length === 0 && unpackedRectangles.length > 0) {
        // Lỗi 1: Kiểm tra lại logic chuyển lớp
        // Nếu không đặt được hình nào trong lớp này, và vẫn còn hình CÓ THỂ VỪA (feasible)
        // thì thoát khỏi vòng lặp layering.
        const anyFeasible = unpackedRectangles.some(canFitEither);
        if (anyFeasible) {
            // Đây là điểm quan trọng để buộc thuật toán thử lớp tiếp theo
            // Nếu không đặt được, tiếp tục vòng lặp layer để tăng layersUsed
        } else {
             break; // Không còn hình nào có thể vừa, thoát
        }
      }
      
      // Đánh dấu lớp hiện tại cho các hình đã xếp
      placedInLayer.forEach(rect => {
        rect.layer = layer;
        allPlacedRectangles.push(rect);
      });
      
      unpackedRectangles = stillRemaining;
      
      // Chỉ tăng layersUsed nếu có hình được đặt trong lớp này
      if (placedInLayer.length > 0) {
        layersUsed++;
      } else if (unpackedRectangles.length > 0 && unpackedRectangles.every(r => !canFitEither(r))) {
         break; // Nếu không đặt được hình nào VÀ không còn hình nào có thể vừa, thoát
      }
    }

    // Tính toán các chỉ số cuối cùng
    const containerAreaPerLayer = container.width * container.height;
    const finalUsedArea = allPlacedRectangles.reduce((sum, rect) => 
      sum + (rect.width * rect.height), 0
    );
    const maxTotalArea = containerAreaPerLayer * maxLayers;

    return {
      rectangles: allPlacedRectangles,
      remainingRectangles: unpackedRectangles,
      remainingFeasibleCount: unpackedRectangles.filter(canFitEither).length,
      remainingUnfitCount: unpackedRectangles.length - unpackedRectangles.filter(canFitEither).length, // Cập nhật tính toán
      efficiency: maxTotalArea > 0 ? (finalUsedArea / maxTotalArea) * 100 : 0, 
      usedArea: finalUsedArea,
      totalArea: maxTotalArea, 
      wasteArea: maxTotalArea - finalUsedArea,
      layersUsed: layersUsed
    };
  }

  // --- Main Optimization using Meta-Heuristic (Iterated Greedy Search) ---
  async optimize(container, initialRectangles, maxLayers) {
    this.container = container;
    this.layers = maxLayers;
    
    const META_ITERATIONS = 10; 
    let bestResult = null;
    
    const originalRectangles = initialRectangles.map(r => ({...r}));
    
    // Lần 0: Chạy với sắp xếp diện tích giảm dần
    bestResult = this._runGreedyLayeringPass(container, this.sortRectanglesByArea(originalRectangles), maxLayers);
    
    // Lặp tìm kiếm Meta-Heuristic
    for (let i = 1; i < META_ITERATIONS; i++) {
        // 1. Tạo hoán vị ngẫu nhiên 
        let shuffledRectangles = originalRectangles.map(r => ({...r}));
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
}

export default PackingAlgorithm;