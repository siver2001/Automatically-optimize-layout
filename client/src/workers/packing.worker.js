/* eslint-disable no-restricted-globals */
// client/src/workers/packing.worker.js

// ==========================================
// 1. CÁC HÀM HELPER
// ==========================================

const runMergePhase = (allPlacedPieces) => {
    const mergedRects = [];
    const tolerance = 1.0;
  
    // Tách các mảnh full
    const fullPieces = allPlacedPieces.filter(r => r.pairId == null || r.splitDirection === 'none');
    mergedRects.push(...fullPieces);
  
    // Lấy các mảnh 1/2
    let halfPieces = allPlacedPieces.filter(r => r.pairId != null && r.splitDirection !== 'none');
    const processedPieces = new Set();
  
    halfPieces.sort((a, b) => 
      a.plateIndex - b.plateIndex || 
      a.layer - b.layer || 
      a.y - b.y || 
      a.x - b.x
    );
  
    for (let i = 0; i < halfPieces.length; i++) {
      const p1 = halfPieces[i];
      if (processedPieces.has(p1.id)) continue;
  
      let foundPair = false;
      const originalW = p1.originalWidth;
      const originalL = p1.originalLength;
      
      for (let j = i + 1; j < halfPieces.length; j++) {
        const p2 = halfPieces[j];
        if (processedPieces.has(p2.id)) continue;
        if (p1.plateIndex !== p2.plateIndex || p1.layer !== p2.layer) continue;
        if (p1.originalTypeId !== p2.originalTypeId) continue;
  
        let adjacent = false;
        let boundingW = 0;
        let boundingL = 0;
        let minX = 0;
        let minY = 0;
  
        if (Math.abs(p1.y - p2.y) < tolerance && 
            Math.abs((p1.x + p1.width) - p2.x) < tolerance &&
            Math.abs(p1.length - p2.length) < tolerance) { 
          adjacent = true; minX = p1.x; minY = p1.y; boundingW = p1.width + p2.width; boundingL = p1.length;
        }
        else if (Math.abs(p1.y - p2.y) < tolerance && 
                 Math.abs((p2.x + p2.width) - p1.x) < tolerance &&
                 Math.abs(p1.length - p2.length) < tolerance) { 
          adjacent = true; minX = p2.x; minY = p1.y; boundingW = p1.width + p2.width; boundingL = p1.length;
        }
        else if (Math.abs(p1.x - p2.x) < tolerance &&
                 Math.abs((p1.y + p1.length) - p2.y) < tolerance &&
                 Math.abs(p1.width - p2.width) < tolerance) { 
          adjacent = true; minX = p1.x; minY = p1.y; boundingW = p1.width; boundingL = p1.length + p2.length;
        }
        else if (Math.abs(p1.x - p2.x) < tolerance &&
                 Math.abs((p2.y + p2.length) - p1.y) < tolerance &&
                 Math.abs(p1.width - p2.width) < tolerance) { 
          adjacent = true; minX = p2.x; minY = p2.y; boundingW = p1.width; boundingL = p1.length + p2.length;
        }
  
        if (!adjacent) continue;
  
        let mergedRect = null;
        if (Math.abs(boundingW - originalW) < tolerance && Math.abs(boundingL - originalL) < tolerance) {
          mergedRect = { width: originalW, length: originalL, rotated: false };
        }
        else if (Math.abs(boundingW - originalL) < tolerance && Math.abs(boundingL - originalW) < tolerance) {
          mergedRect = { width: originalL, length: originalW, rotated: true };
        }
  
        if (mergedRect) {
          mergedRects.push({
            ...mergedRect,
            id: `merged_${p1.id}_${p2.id}`,
            plateIndex: p1.plateIndex, layer: p1.layer, x: minX, y: minY,
            color: p1.color, typeId: p1.originalTypeId, originalTypeId: p1.originalTypeId,
            pairId: null, mergedFrom: [p1.id, p2.id]
          });
          processedPieces.add(p1.id);
          processedPieces.add(p2.id);
          foundPair = true;
          break;
        }
      }
  
      if (!foundPair && !processedPieces.has(p1.id)) {
        mergedRects.push(p1);
        processedPieces.add(p1.id);
      }
    } 
    return mergedRects;
  };
  
  const runRebuildPhase = (mergedRects, originalPlates, displayIdStart) => {
    const newFinalPlates = [];
    const plateMap = new Map();
    let displayIdCounter = displayIdStart;
  
    const originalPlateMeta = new Map();
    originalPlates.forEach(p => {
      originalPlateMeta.set(p.plateIndex, {
        description: p.description, type: p.type, patternDescription: p.patternDescription
      });
    });
  
    mergedRects.sort((a, b) => a.plateIndex - b.plateIndex || a.layer - b.layer);
  
    for (const rect of mergedRects) {
      if (rect.id.toString().startsWith('merged_') || rect.id.toString().startsWith('full_')) {
        rect.id = `rect_${displayIdCounter++}`;
      } else if (rect.pairId && !rect.id.toString().startsWith('rect_half_')) {
        rect.id = `rect_half_${displayIdCounter++}`;
      }
  
      if (!plateMap.has(rect.plateIndex)) {
        const originalMeta = originalPlateMeta.get(rect.plateIndex) || {
          description: `Tấm ${rect.plateIndex + 1}`, layers: []
        };
        plateMap.set(rect.plateIndex, { ...originalMeta, plateIndex: rect.plateIndex, layers: new Map() });
      }
      
      const plateData = plateMap.get(rect.plateIndex);
      if (!plateData.layers.has(rect.layer)) {
        plateData.layers.set(rect.layer, { layerIndexInPlate: rect.layer, rectangles: [] });
      }
      plateData.layers.get(rect.layer).rectangles.push(rect);
    }
  
    for (const [, plateData] of plateMap.entries()) {
      const newPlate = { 
        ...plateData,
        layers: Array.from(plateData.layers.values()).sort((a, b) => a.layerIndexInPlate - b.layerIndexInPlate)
      };
      newFinalPlates.push(newPlate);
    }
    
    return newFinalPlates.sort((a, b) => a.plateIndex - b.plateIndex);
  };
  
  const createPatternSignature = (placed) => {
    const layer0Rects = placed.filter(r => r.layer === 0);
    const sorted = [...layer0Rects].sort((a, b) => {
      if (a.typeId !== b.typeId) return a.typeId - b.typeId;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });
    return sorted.map(r => `${r.typeId}:${r.x}:${r.y}:${r.width}:${r.length}:${r.rotated ? 1 : 0}`).join('|');
  };
  
  const callPackingApi = async (url, data) => {
      const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
      });
      if (!response.ok) {
          const err = await response.text();
          throw new Error(err);
      }
      return await response.json();
  };

  const createMixedPlateMultiStrategy = async (pool, layersPerPlate, container, apiBaseUrl, packingStrategy) => {
    if (pool.length === 0) return null;
  
    try {
        //Truyền strategyName lên Server để Server biết mà dùng FullSizeStrategy
        const result = await callPackingApi(`${apiBaseUrl}/packing/optimize`, {
          container: { ...container, layers: 1 },
          rectangles: pool,
          layers: 1,
          strategyName: packingStrategy 
        });
  
        const placed = (result?.result?.rectangles || [])
          .filter(r => r && r.x !== undefined)
          .map(r => ({
            ...r,
            originalTypeId: r.originalTypeId, pairId: r.pairId, pieceIndex: r.pieceIndex,
            splitDirection: r.splitDirection, originalWidth: r.originalWidth, originalLength: r.originalLength,
            layer: r.layer || 0, rotated: r.rotated || false
          }));
        
        if (placed.length === 0) return null;

        const usedTypeIds = new Set(placed.map(r => r.typeId));
        const placedIds = new Set(placed.map(r => r.id));
        const typeCount = {};
        placed.forEach(r => { typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1; });
  
        return { placed, placedIds, usedTypeIds, typeCount };

    } catch (e) {
        console.error("Worker fetch error", e);
        return null;
    }
  };
  
  // ==========================================
  // 2. MAIN WORKER LOGIC
  // ==========================================
  
  self.onmessage = async (e) => {
      const { 
          container, 
          rectangles,
          quantities, 
          selectedRectangles, 
          packingStrategy, 
          apiBaseUrl 
      } = e.data;
      
      const collectedWarnings = [];
      const reportWarning = (msg) => collectedWarnings.push({ message: msg, type: 'optimization' });
  
      try {
          console.log('[Worker] Bắt đầu tối ưu hóa. Strategy:', packingStrategy);
          
          const layersPerPlate = container.layers;
          const selectedTypes = rectangles.filter(
            r => selectedRectangles.includes(r.id) && (quantities[r.id] || 0) > 0
          );
    
          let finalPlates = [];
          let plateIndexCounter = 0;
          let pool = [];
          let poolCounter = 0;
          const MIN_SPLIT_WIDTH = 10;
          const MAX_ITERATIONS = 10000;
  
          // ========== GIAI ĐOẠN 1: TẠO POOL ==========
          // Kiểm tra đúng giá trị 'FULL_SIZE'
          if (packingStrategy === 'FULL_SIZE') {
            console.log('[Worker] Chế độ Size Nguyên: KHÔNG CẮT HÌNH');
            for (const rectType of selectedTypes) {
              const quantity = quantities[rectType.id] || 0;
              for (let i = 0; i < quantity; i++) {
                pool.push({
                  ...rectType,
                  id: `full_size_${poolCounter++}`,
                  typeId: rectType.id, originalTypeId: rectType.id,
                  // QUAN TRỌNG: Đánh dấu là không cắt
                  pairId: null, pieceIndex: 0, splitDirection: 'none',
                  originalWidth: rectType.width, originalLength: rectType.length,
                  transform: { originalWidth: rectType.width, originalLength: rectType.length, splitAxis: 'none' },
                });
              }
            }
          } else {
              // Logic chia đôi (Chỉ chạy khi là AREA_OPTIMIZED)
              for (const rectType of selectedTypes) {
                  const quantity = quantities[rectType.id] || 0;
                  const halfWidth = rectType.width / 2;
                  const canSplit = halfWidth >= MIN_SPLIT_WIDTH;
                  
                  for (let i = 0; i < quantity; i++) {
                      const pairId = `pair_${rectType.id}_${i}`;
                      if (canSplit) {
                          const transformMetadata = {
                              originalWidth: rectType.width, originalLength: rectType.length,
                              splitAxis: 'width', pieceWidth: halfWidth, pieceLength: rectType.length,
                              expectedOrientation: 'horizontal'
                          };
                          pool.push({
                              ...rectType, id: `half_${poolCounter++}`, typeId: rectType.id, originalTypeId: rectType.id,
                              pairId: pairId, pieceIndex: 1, splitDirection: 'width',
                              width: halfWidth, length: rectType.length,
                              originalWidth: rectType.width, originalLength: rectType.length,
                              transform: transformMetadata, name: `1/2 ${rectType.name}`
                          });
                          pool.push({
                              ...rectType, id: `half_${poolCounter++}`, typeId: rectType.id, originalTypeId: rectType.id,
                              pairId: pairId, pieceIndex: 2, splitDirection: 'width',
                              width: halfWidth, length: rectType.length,
                              originalWidth: rectType.width, originalLength: rectType.length,
                              transform: transformMetadata, name: `1/2 ${rectType.name}`
                          });
                      } else {
                          pool.push({
                              ...rectType, id: `full_${poolCounter++}`, typeId: rectType.id, originalTypeId: rectType.id,
                              pairId: null, pieceIndex: 0, splitDirection: 'none',
                              originalWidth: rectType.width, originalLength: rectType.length,
                              transform: { originalWidth: rectType.width, originalLength: rectType.length, splitAxis: 'none' }
                          });
                          reportWarning(`Size ${rectType.name} quá hẹp để chia, giữ nguyên.`);
                      }
                  }
              }
          }
  
          // ========== GIAI ĐOẠN 2: PACKING LOOP ==========
          const mixedPatterns = new Map();
          let mixedPlateCounter = 1;
          let iterationCount = 0;
  
          while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
              iterationCount++;
              // Truyền packingStrategy vào hàm này
              const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate, container, apiBaseUrl, packingStrategy);
  
              if (!mixedResult || mixedResult.placed.length === 0) break;
  
              const { placed, placedIds, typeCount } = mixedResult;
              const normalizedPlaced = placed.map(r => ({ ...r, layer: 0 }));
              const signature = createPatternSignature(normalizedPlaced);
  
              if (mixedPatterns.has(signature)) {
                  const existingData = mixedPatterns.get(signature);
                  if (existingData.layers.length >= layersPerPlate) {
                      finalPlates.push({ ...existingData.plate, layers: existingData.layers });
                      existingData.plate = {
                          plateIndex: plateIndexCounter++, type: 'mixed',
                          description: `Tấm Hỗn Hợp #${existingData.plate.plateIndex + 1}`,
                          patternDescription: existingData.plate.patternDescription, layers: []
                      };
                      existingData.layers = [];
                  }
                  const layerIndexInPlate = existingData.layers.length;
                  existingData.layers.push({
                      layerIndexInPlate,
                      rectangles: placed.map(r => ({ ...r, layer: layerIndexInPlate, plateIndex: existingData.plate.plateIndex }))
                  });
                  existingData.repetitions++;
              } else {
                  const typeDesc = Object.entries(typeCount).map(([id, cnt]) => {
                      const t = selectedTypes.find(x => x.id === Number(id));
                      return `${cnt}×${t ? t.name : `#${id}`}`;
                  }).join(', ');
  
                  const plate = {
                      plateIndex: plateIndexCounter++, type: 'mixed',
                      description: `Tấm Hỗn Hợp #${mixedPlateCounter}`, patternDescription: typeDesc, layers: []
                  };
                  const firstLayer = {
                      layerIndexInPlate: 0,
                      rectangles: placed.map(r => ({ ...r, layer: 0, plateIndex: plate.plateIndex }))
                  };
                  plate.layers = [firstLayer];
                  mixedPatterns.set(signature, { plate, layers: [firstLayer], repetitions: 1 });
                  mixedPlateCounter++;
              }
              pool = pool.filter(r => !placedIds.has(r.id));
          }
  
          for (const [, data] of mixedPatterns.entries()) {
              const { plate, layers } = data;
              plate.description = `Tấm Hỗn Hợp #${plate.plateIndex + 1} (${layers.length} lớp)`;
              plate.layers = layers;
              finalPlates.push(plate);
          }
  
          if (pool.length > 0 && iterationCount >= MAX_ITERATIONS) {
              reportWarning(`Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp, còn ${pool.length} pieces chưa xếp được.`);
          }
  
          // ========== GIAI ĐOẠN 3 & 4: MERGE & REBUILD ==========
          let allPlacedPieces = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
          let mergedRects;
          
          if (packingStrategy === 'FULL_SIZE') mergedRects = allPlacedPieces;
          else mergedRects = runMergePhase(allPlacedPieces);
  
          finalPlates = runRebuildPhase(mergedRects, finalPlates, 1);
  
          // ========== GIAI ĐOẠN 5: CONSOLIDATION (Smart FFD) ==========
          const singleLayerPlates = finalPlates.filter(p => p.layers.length === 1);
          const platesToRemove = new Set(singleLayerPlates.map(p => p.plateIndex));
  
          if (singleLayerPlates.length > 1) {
              const checkOverlap = (rect, existingRects) => {
                  for (const existing of existingRects) {
                    if (!(rect.x + rect.width <= existing.x + 0.1 || rect.x >= existing.x + existing.width - 0.1 ||
                          rect.y + rect.length <= existing.y + 0.1 || rect.y >= existing.y + existing.length - 0.1)) return true;
                  }
                  return false;
              };
              const findBestPositionSmart = (rect, existingRects, cW, cL) => {
                  let bestPos = null;
                  let bestScore = Infinity;
                  const orientations = [
                      { w: rect.width, l: rect.length, r: rect.rotated || false },
                      { w: rect.length, l: rect.width, r: !(rect.rotated || false) }
                  ];
                  const candidates = [{x:0, y:0}];
                  existingRects.forEach(e => {
                      candidates.push({ x: e.x + e.width, y: e.y });
                      candidates.push({ x: e.x, y: e.y + e.length });
                  });
                  for (const ori of orientations) {
                      const { w, l, r } = ori;
                      if (w > cW || l > cL) continue;
                      for (const p of candidates) {
                          if (p.x + w > cW || p.y + l > cL) continue;
                          if (checkOverlap({ x: p.x, y: p.y, width: w, length: l }, existingRects)) continue;
                          let score = p.y * cW + p.x; 
                          existingRects.forEach(e => {
                              if (Math.abs(e.x+e.width-p.x)<0.1 && Math.abs(e.length-l)<0.1) score -= 500000;
                              if (Math.abs(e.y+e.length-p.y)<0.1 && Math.abs(e.width-w)<0.1) score -= 500000;
                          });
                          if (!r && (rect.rotated)) score += 1000; 
                          if (score < bestScore) { bestScore = score; bestPos = { x: p.x, y: p.y, width: w, length: l, rotated: r }; }
                      }
                  }
                  return bestPos;
              };
  
              let allItems = singleLayerPlates.flatMap(p => p.layers[0].rectangles.map(r => ({ ...r })));
              allItems.sort((a, b) => {
                  const hA = Math.min(a.width, a.length), hB = Math.min(b.width, b.length);
                  if (Math.abs(hB - hA) > 1) return hB - hA;
                  return Math.max(b.width, b.length) - Math.max(a.width, a.length);
              });
  
              const multiLayerPlates = finalPlates.filter(p => !platesToRemove.has(p.plateIndex));
              const newConsolidatedPlates = [];
              let newPlateCounter = multiLayerPlates.length;
  
              for (const item of allItems) {
                  let placed = false;
                  for (const bin of newConsolidatedPlates) {
                      const targetRects = bin.layers[0].rectangles;
                      const bestPos = findBestPositionSmart(item, targetRects, container.width, container.length);
                      if (bestPos) {
                          targetRects.push({ ...item, ...bestPos, layer: 0, plateIndex: bin.plateIndex });
                          placed = true; break;
                      }
                  }
                  if (!placed) {
                      const newIdx = newPlateCounter++;
                      const bestPos = findBestPositionSmart(item, [], container.width, container.length);
                      const newBin = {
                          plateIndex: newIdx, type: 'mixed', description: `Tấm Gộp #${newIdx + 1}`,
                          layers: [{ layerIndexInPlate: 0, rectangles: [{ ...item, ...bestPos, layer: 0, plateIndex: newIdx }] }]
                      };
                      newConsolidatedPlates.push(newBin);
                  }
              }
              finalPlates = [...multiLayerPlates, ...newConsolidatedPlates];
              reportWarning(`Đã gộp ${singleLayerPlates.length} tấm 1-lớp thành ${newConsolidatedPlates.length} tấm mới.`);
              
              const piecesToReMerge = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
              mergedRects = runMergePhase(piecesToReMerge);
              finalPlates = runRebuildPhase(mergedRects, finalPlates, 1);
          }
  
          const totalRequested = selectedTypes.reduce((s, t) => s + (quantities[t.id] || 0), 0);
          let placedCount = 0;
          const processedPairs = new Set();
          for (const rect of mergedRects) {
              if (rect.pairId != null) {
                  if (!processedPairs.has(rect.pairId)) {
                      processedPairs.add(rect.pairId);
                      const other = mergedRects.find(r => r.pairId === rect.pairId && r.id !== rect.id);
                      placedCount += other ? 1 : 0.5;
                  }
              } else placedCount += 1;
          }
          placedCount = Math.round(placedCount);
  
          const containerArea = container.width * container.length;
          const totalPlateArea = finalPlates.reduce((sum, plate) => sum + plate.layers.length * containerArea, 0);
          const placedArea = mergedRects.reduce((sum, r) => sum + r.width * r.length, 0);
          const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;
  
          if (pool.length > 0 || placedCount < totalRequested) {
             reportWarning(`Chỉ sắp được ${placedCount}/${totalRequested} hình.`);
          }
  
          self.postMessage({
              success: true,
              result: {
                  layersUsed: finalPlates.reduce((sum, p) => sum + p.layers.length, 0),
                  platesNeeded: finalPlates.length,
                  layersPerPlate: layersPerPlate,
                  totalRectanglesCount: totalRequested,
                  placedRectanglesCount: placedCount,
                  rectangles: mergedRects,
                  plates: finalPlates,
                  efficiency,
                  mixedCount: finalPlates.length
              },
              warnings: collectedWarnings
          });
  
      } catch (error) {
          console.error('[Worker Error]', error);
          self.postMessage({ success: false, error: error.message });
      }
  };