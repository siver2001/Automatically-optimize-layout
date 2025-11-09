/* eslint-disable no-loop-func */
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { packingService } from '../services/packingService.js';

const PackingContext = createContext();

const initialState = {
  container: { width: 0, length: 0, layers: 1 },
  rectangles: [],
  selectedRectangles: [],
  quantities: {},
  packingResult: null,
  isOptimizing: false,
  optimizationProgress: 0,
  showModbus: false,
  errors: [],
  warnings: []
};

const packingReducer = (state, action) => {
  switch (action.type) {
    case 'SET_CONTAINER':
      return {
        ...state,
        container: { ...state.container, ...action.payload },
        errors: state.errors.filter(e => e.type !== 'container')
      };

    case 'SET_RECTANGLES': {
      let counter = 1;
      
      const processedRectangles = action.payload.map(rect => {
        const id = rect.id ?? counter++;
        
        return {
          ...rect,
          id: id,
          typeId: rect.typeId ?? id
        };
      });

      const initialQuantities = processedRectangles.reduce((acc, rect) => {
        acc[rect.id] = 1;
        return acc;
      }, {});

      return {
        ...state,
        rectangles: processedRectangles,
        selectedRectangles: [],
        quantities: initialQuantities
      };
    }

    case 'ADD_RECTANGLE':
      return {
        ...state,
        rectangles: [...state.rectangles, action.payload],
        quantities: { ...state.quantities, [action.payload.id]: 1 },
        selectedRectangles: [...state.selectedRectangles, action.payload.id]
      };

    case 'REMOVE_RECTANGLE': {
      const idToRemove = action.payload;
      const { [idToRemove]: _removed, ...newQuantities } = state.quantities;
      
      return {
        ...state,
        rectangles: state.rectangles.filter(r => r.id !== idToRemove),
        selectedRectangles: state.selectedRectangles.filter(id => id !== idToRemove),
        quantities: newQuantities,
        packingResult: state.packingResult ? {
          ...state.packingResult,
          plates: state.packingResult.plates?.map(plate => ({
            ...plate,
            layers: plate.layers?.map(layer => ({
              ...layer,
              rectangles: layer.rectangles?.filter(r => r.typeId !== idToRemove) || []
            })) || []
          })) || []
        } : null
      };
    }

    case 'SET_QUANTITY':
      return {
        ...state,
        quantities: { ...state.quantities, [action.payload.id]: action.payload.quantity }
      };

    case 'SELECT_RECTANGLE':
      return {
        ...state,
        selectedRectangles: state.selectedRectangles.includes(action.payload)
          ? state.selectedRectangles.filter(id => id !== action.payload)
          : [...state.selectedRectangles, action.payload]
      };

    case 'SELECT_ALL_RECTANGLES':
      return { ...state, selectedRectangles: state.rectangles.map(r => r.id) };

    case 'CLEAR_SELECTION':
      return { ...state, selectedRectangles: [] };

    case 'START_OPTIMIZATION':
      return {
        ...state,
        isOptimizing: true,
        optimizationProgress: 0,
        packingResult: null,
        errors: state.errors.filter(e => e.type !== 'optimization' && e.type !== 'rectangles'),
        warnings: []
      };

    case 'UPDATE_OPTIMIZATION_PROGRESS':
      return { ...state, optimizationProgress: action.payload };

    case 'SET_PACKING_RESULT':
      return {
        ...state,
        packingResult: action.payload,
        isOptimizing: false,
        optimizationProgress: 100
      };

    case 'SET_WARNING': {
      if (state.warnings.find(w => w.message === action.payload.message)) return state;
      return { ...state, warnings: [...state.warnings, action.payload] };
    }

    case 'SET_ERROR': {
      const filtered = state.errors.filter(e => e.type !== action.payload.type);
      return { ...state, errors: [...filtered, action.payload], isOptimizing: false };
    }

    case 'CLEAR_ERRORS':
      return { ...state, errors: [], warnings: [] };

    case 'TOGGLE_MODBUS':
      return { ...state, showModbus: !state.showModbus };

    default:
      return state;
  }
};

export const PackingProvider = ({ children }) => {
  const [state, dispatch] = useReducer(packingReducer, initialState);

  useEffect(() => {
    const loadDefaultRectangles = async () => {
      try {
        const data = await packingService.getDefaultRectangles();
        dispatch({ type: 'SET_RECTANGLES', payload: data.rectangles });
      } catch (err) {
        console.error('Error loading default rectangles:', err);
      }
    };
    loadDefaultRectangles();
  }, []);

  const nextIdRef = React.useRef(Math.max(0, ...initialState.rectangles.map(r => r?.id || 0)) + 1);
  
  const getNewRectId = useCallback(() => {
    const currentMaxId = Math.max(0, ...state.rectangles.map(r => r.id));
    if (currentMaxId >= nextIdRef.current) {
      nextIdRef.current = currentMaxId + 1;
    }
    const newId = nextIdRef.current;
    nextIdRef.current += 1;
    return newId;
  }, [state.rectangles]);

  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  const validateContainer = useCallback(() => {
    const { width, length, layers } = state.container;
    const errs = [];
    if (width <= 0) errs.push('Chiều rộng tấm liệu phải lớn hơn 0');
    if (length <= 0) errs.push('Chiều dài tấm liệu phải lớn hơn 0');
    if (layers <= 0) errs.push('Số lớp phải lớn hơn 0');
    if (width > 10000 || length > 10000) errs.push('Kích thước tấm liệu quá lớn (tối đa 10000mm)');
    if (errs.length) {
      dispatch({ type: 'SET_ERROR', payload: { type: 'container', message: errs.join('. ') } });
      return false;
    }
    return true;
  }, [state.container]);

  const validateRectangles = useCallback(() => {
    const total = state.rectangles
      .filter(r => state.selectedRectangles.includes(r.id))
      .reduce((sum, r) => sum + (state.quantities[r.id] || 0), 0);

    if (total === 0) {
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'rectangles', message: 'Phải chọn ít nhất một size với số lượng lớn hơn 0' }
      });
      return false;
    }
    return true;
  }, [state.rectangles, state.selectedRectangles, state.quantities]);

  // ============================================================
  // CONSTANTS
  // ============================================================
  const MIN_SPLIT_WIDTH = 10; // Chiều rộng tối thiểu để chia đôi (mm)
  const MAX_ITERATIONS = 100; // Số lần lặp tối đa cho mixed plates

  // ============================================================
  // HELPER: Tạo chữ ký pattern để phát hiện tấm trùng lặp
  // ============================================================
  const createPatternSignature = (placed) => {
    const layer0Rects = placed.filter(r => r.layer === 0);
    
    const sorted = [...layer0Rects].sort((a, b) => {
      if (a.typeId !== b.typeId) return a.typeId - b.typeId;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    return sorted.map(r => 
      `${r.typeId}:${r.x}:${r.y}:${r.width}:${r.length}:${r.rotated ? 1 : 0}`
    ).join('|');
  };

  // ============================================================
  // HELPER: Tạo mixed plate với multi-strategy
  // ============================================================
  const createMixedPlateMultiStrategy = async (pool, layersPerPlate) => {
    if (pool.length === 0) return null;

          const strategies = [
      {
        name: 'Area Descending',
        sort: (a, b) => (b.width * b.length) - (a.width * a.length)
      },
      {
        name: 'Max Dimension',
        sort: (a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length)
      },
      {
        name: 'Perimeter',
        sort: (a, b) => (2 * (b.width + b.length)) - (2 * (a.width + a.length))
      },
      {
        name: 'Aspect Ratio',
        sort: (a, b) => {
          const ratioA = Math.max(a.width, a.length) / Math.min(a.width, a.length);
          const ratioB = Math.max(b.width, b.length) / Math.min(b.width, b.length);
          return ratioA - ratioB;
        }
      }
    ];

    let bestResult = null;
    let bestArea = 0;
    let bestStrategyName = '';

    for (const strategy of strategies) {
      const sortedPool = [...pool].sort(strategy.sort);

      // CHỈ CHẠY CHO 1 LỚP - Logic xếp nhiều lớp sẽ được xử lý ở bên ngoài
      const result = await packingService.optimizePacking(
        { ...state.container, layers: 1 },
        sortedPool,
        1
      );

      const placed = (result?.result?.rectangles || [])
        .filter(r => r && r.x !== undefined)
        .map(r => ({
          ...r,
          typeId: r.typeId,
          originalTypeId: r.originalTypeId,
          pairId: r.pairId,
          pieceIndex: r.pieceIndex,
          splitDirection: r.splitDirection,
          originalWidth: r.originalWidth,
          originalLength: r.originalLength,
          x: r.x,
          y: r.y,
          width: r.width,
          length: r.length,
          layer: r.layer || 0,
          rotated: r.rotated || false,
          color: r.color,
          name: r.name
        }));

      const totalArea = placed.reduce((sum, r) => sum + (r.width * r.length), 0);

      if (totalArea > bestArea) {
        bestArea = totalArea;
        bestResult = placed;
        bestStrategyName = strategy.name;
      }
    }

    if (!bestResult || bestResult.length === 0) return null;

    console.log(`   ✔ Best strategy: ${bestStrategyName}, placed: ${bestResult.length} pieces, area: ${bestArea.toFixed(0)}mm²`);

    const usedTypeIds = new Set(bestResult.map(r => r.typeId));
    const placedIds = new Set(bestResult.map(r => r.id));

    const typeCount = {};
    bestResult.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });

    return { placed: bestResult, placedIds, usedTypeIds, typeCount };
  };

  // ============================================================
  // MAIN OPTIMIZATION LOGIC
  // ============================================================
  const startOptimization = async () => {
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) return false;
    
    console.log('\n🚀 ========== BẮT ĐẦU TỐI ƯU (V4.0 - SPLIT-PACK-MERGE) ==========\n');

    try {
      dispatch({ type: 'START_OPTIMIZATION' });
      const layersPerPlate = state.container.layers;

      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      let finalPlates = [];
      let plateIndexCounter = 0;

      // ========== GIAI ĐOẠN 1: SPLIT - Tạo Pool (Chia đôi CHIỀU RỘNG) ==========
      console.log('📋 GIAI ĐOẠN 1: SPLIT - Tạo Pool (Chia đôi theo CHIỀU RỘNG)\n');

      let pool = [];
      let poolCounter = 0;

      for (const rectType of selectedTypes) {
        const quantity = state.quantities[rectType.id] || 0;
        if (quantity <= 0) continue;

        const halfWidth = rectType.width / 2;
        const canSplit = halfWidth >= MIN_SPLIT_WIDTH;

        console.log(`   📦 Processing ${quantity}× ${rectType.name} (${rectType.width}×${rectType.length}mm)`);

        for (let i = 0; i < quantity; i++) {
          const pairId = `pair_${rectType.id}_${i}`;
          
          if (canSplit) {
            // CHIA ĐÔI theo chiều rộng: 1 rectangle → 2 pieces
            const piece1 = { 
              ...rectType,
              id: `half_${poolCounter++}`,
              typeId: rectType.id,
              originalTypeId: rectType.id,
              pairId: pairId,
              pieceIndex: 1,
              splitDirection: 'width',
              width: halfWidth,
              length: rectType.length,
              originalWidth: rectType.width,
              originalLength: rectType.length,
              name: `1/2 ${rectType.name}`,
              color: rectType.color
            };
            
            const piece2 = { 
              ...rectType,
              id: `half_${poolCounter++}`,
              typeId: rectType.id,
              originalTypeId: rectType.id,
              pairId: pairId,
              pieceIndex: 2,
              splitDirection: 'width',
              width: halfWidth,
              length: rectType.length,
              originalWidth: rectType.width,
              originalLength: rectType.length,
              name: `1/2 ${rectType.name}`,
              color: rectType.color
            };
            
            pool.push(piece1, piece2);
            console.log(`      → Split: ${halfWidth}×${rectType.length}mm (×2 pieces)`);
          } else {
            // KHÔNG CHIA: Giữ nguyên 1 piece
            const fullPiece = { 
              ...rectType,
              id: `full_${poolCounter++}`,
              typeId: rectType.id,
              originalTypeId: rectType.id,
              pairId: null,
              pieceIndex: 0,
              splitDirection: 'none',
              originalWidth: rectType.width,
              originalLength: rectType.length,
              name: rectType.name,
              color: rectType.color
            };
            
            pool.push(fullPiece);
            console.log(`      → Keep full (too narrow to split)`);

            dispatch({
              type: 'SET_WARNING',
              payload: {
                type: 'optimization',
                message: `Size ${rectType.name} quá hẹp để chia (cần ≥${MIN_SPLIT_WIDTH}mm), giữ nguyên.`
              }
            });
          }
        }
      }

      console.log(`\n✓ Pool created: ${pool.length} pieces from ${selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0)} rectangles\n`);

      // ========== GIAI ĐOẠN 2: PACK - Sắp xếp các pieces ==========
      console.log('📋 GIAI ĐOẠN 2: PACK - Sắp xếp các pieces vào tấm\n');

      const mixedPatterns = new Map();
      let mixedPlateCounter = 1;
      let iterationCount = 0;
      let currentLayerInPlate = 0;

      while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        console.log(`🔄 Iteration ${iterationCount}: pool size = ${pool.length}, current layer = ${currentLayerInPlate}`);

        const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
          console.log(`   ✗ Cannot pack remaining ${pool.length} pieces`);
          break;
        }

        const { placed, placedIds, typeCount } = mixedResult;

        // Gán layer index cho các pieces
        const placedWithLayer = placed.map(r => ({
          ...r,
          layer: currentLayerInPlate
        }));

        // Chuẩn hóa về layer 0 để tạo signature
        const normalizedPlaced = placed.map(r => ({ ...r, layer: 0 }));
        const signature = createPatternSignature(normalizedPlaced);

        if (mixedPatterns.has(signature)) {
          // Pattern đã tồn tại → Thêm lớp vào plate hiện có
          const existingData = mixedPatterns.get(signature);
          console.log(`   🔁 Pattern match! Adding to plate #${existingData.plate.plateIndex}`);
          
          existingData.layers.push({
            layerIndexInPlate: currentLayerInPlate,
            rectangles: placedWithLayer.map(r => ({
              ...r,
              plateIndex: existingData.plate.plateIndex
            }))
          });

          existingData.repetitions++;
          currentLayerInPlate++;

          // Kiểm tra đã đủ số lớp cho plate này chưa
          if (currentLayerInPlate >= layersPerPlate) {
            console.log(`   ✓ Plate #${existingData.plate.plateIndex} completed with ${layersPerPlate} layers`);
            currentLayerInPlate = 0; // Reset để tạo plate mới
          }

        } else {
          // Pattern mới → Tạo plate mới
          console.log(`   ✨ New pattern, creating plate #${mixedPlateCounter}`);
          
          const typeDesc = Object.entries(typeCount)
            .map(([id, cnt]) => {
              const t = selectedTypes.find(x => x.id === Number(id));
              return `${cnt}×${t ? t.name : `#${id}`}`;
            }).join(', ');

          const plate = {
            plateIndex: plateIndexCounter++,
            type: 'mixed',
            description: `Tấm Hỗn Hợp #${mixedPlateCounter}`,
            patternDescription: typeDesc,
            layers: []
          };

          const initialLayer = {
            layerIndexInPlate: currentLayerInPlate,
            rectangles: placedWithLayer.map(r => ({
              ...r,
              plateIndex: plate.plateIndex
            }))
          };

          plate.layers = [initialLayer];

          mixedPatterns.set(signature, {
            plate: plate,
            layers: [initialLayer],
            repetitions: 1
          });

          currentLayerInPlate++;

          // Kiểm tra đã đủ số lớp chưa
          if (currentLayerInPlate >= layersPerPlate) {
            console.log(`   ✓ Plate #${plate.plateIndex} completed with ${layersPerPlate} layers`);
            currentLayerInPlate = 0;
          }

          mixedPlateCounter++;
        }
        
        pool = pool.filter(r => !placedIds.has(r.id));
        console.log(`   ✓ Removed ${placedIds.size} pieces from pool\n`);
      }

      // Đưa plates vào finalPlates
      for (const [, data] of mixedPatterns.entries()) {
        const { plate, layers, repetitions } = data;
        
        plate.description = `Tấm Hỗn Hợp #${plate.plateIndex + 1} (${layers.length} lớp | ${plate.patternDescription})`;
        if (repetitions > 1) {
          plate.description += ` [×${repetitions}]`;
        }
        
        plate.layers = layers;
        finalPlates.push(plate);
      }

      if (pool.length > 0 && iterationCount >= MAX_ITERATIONS) {
        console.error(`\n✗ Reached max iterations! ${pool.length} pieces still in pool`);
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp, còn ${pool.length} pieces chưa xếp được.`
          }
        });
      }

      console.log(`✓ Packed into ${finalPlates.length} raw plates\n`);

      // ========== GIAI ĐOẠN 3: MERGE - Ghép các pieces liền kề ==========
      console.log('📋 GIAI ĐOẠN 3: MERGE - Ghép các pieces liền kề thành rectangles\n');

      const allPlacedPieces = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const mergedRects = [];
      
      const halfPieces = allPlacedPieces.filter(r => r.pairId != null);
      const fullPieces = allPlacedPieces.filter(r => r.pairId == null);
      
      mergedRects.push(...fullPieces);
      
      const groupedByPair = new Map();
      for (const piece of halfPieces) {
        if (!groupedByPair.has(piece.pairId)) {
          groupedByPair.set(piece.pairId, []);
        }
        groupedByPair.get(piece.pairId).push(piece);
      }
      
      console.log(`   🔍 Found ${fullPieces.length} full pieces and ${groupedByPair.size} pairs to check`);

      let mergedCount = 0;
      let unmergedCount = 0;

      for (const [pairId, pieces] of groupedByPair.entries()) {
        if (pieces.length === 1) {
          mergedRects.push(pieces[0]);
          unmergedCount++;
        } else if (pieces.length === 2) {
          const p1 = pieces[0];
          const p2 = pieces[1];
          
          let isAdjacent = false;
          let mergedRect = null;
          
          if (p1.plateIndex === p2.plateIndex && p1.layer === p2.layer) {
            const tolerance = 1.0;
            
            // =====================================================
            // KIỂM TRA MERGE CHO CẢ 2 TRƯỜNG HỢP: XOAY VÀ KHÔNG XOAY
            // =====================================================
            
            if (p1.splitDirection === 'width') {
              // TH1: CẢ 2 KHÔNG XOAY (180×245 + 180×245 → 360×245)
              if (!p1.rotated && !p2.rotated) {
                // Case 1a: p1 bên trái p2
                if (Math.abs((p1.x + p1.width) - p2.x) <= tolerance && 
                    Math.abs(p1.y - p2.y) <= tolerance && 
                    Math.abs(p1.length - p2.length) <= tolerance) {
                  isAdjacent = true;
                  mergedRect = { 
                    ...p1,
                    x: p1.x,
                    width: p1.originalWidth,
                    length: p1.originalLength,
                    name: p1.name.replace('1/2 ', ''),
                    id: `merged_${pairId}`,
                    pieceIndex: null,
                    pairId: null,
                    splitDirection: 'none',
                    rotated: false
                  };
                }
                // Case 1b: p2 bên trái p1
                else if (Math.abs((p2.x + p2.width) - p1.x) <= tolerance && 
                         Math.abs(p1.y - p2.y) <= tolerance && 
                         Math.abs(p1.length - p2.length) <= tolerance) {
                  isAdjacent = true;
                  mergedRect = { 
                    ...p2,
                    x: p2.x,
                    width: p2.originalWidth,
                    length: p2.originalLength,
                    name: p2.name.replace('1/2 ', ''),
                    id: `merged_${pairId}`,
                    pieceIndex: null,
                    pairId: null,
                    splitDirection: 'none',
                    rotated: false
                  };
                }
              }
              
              // TH2: CẢ 2 BỊ XOAY (245×180 + 245×180 → 245×360 SAU ĐÓ XOAY LẠI → 360×245)
              else if (p1.rotated && p2.rotated) {
                // Khi đã xoay: width <-> length
                // 180×245 xoay → 245×180
                // Kiểm tra ghép theo chiều DÀI (vì đã xoay)
                
                // Case 2a: p1 phía dưới p2 (ghép theo chiều dài)
                if (Math.abs((p1.y + p1.length) - p2.y) <= tolerance && 
                    Math.abs(p1.x - p2.x) <= tolerance && 
                    Math.abs(p1.width - p2.width) <= tolerance) {
                  isAdjacent = true;
                  mergedRect = { 
                    ...p1,
                    x: p1.x,
                    y: p1.y,
                    width: p1.originalLength, // Sau khi merge và xoay lại
                    length: p1.originalWidth,
                    name: p1.name.replace('1/2 ', ''),
                    id: `merged_${pairId}`,
                    pieceIndex: null,
                    pairId: null,
                    splitDirection: 'none',
                    rotated: true // Giữ trạng thái xoay
                  };
                }
                // Case 2b: p2 phía dưới p1
                else if (Math.abs((p2.y + p2.length) - p1.y) <= tolerance && 
                         Math.abs(p1.x - p2.x) <= tolerance && 
                         Math.abs(p1.width - p2.width) <= tolerance) {
                  isAdjacent = true;
                  mergedRect = { 
                    ...p2,
                    x: p2.x,
                    y: p2.y,
                    width: p2.originalLength,
                    length: p2.originalWidth,
                    name: p2.name.replace('1/2 ', ''),
                    id: `merged_${pairId}`,
                    pieceIndex: null,
                    pairId: null,
                    splitDirection: 'none',
                    rotated: true
                  };
                }
              }
            }
          }
          
          if (isAdjacent && mergedRect) {
            mergedRects.push(mergedRect);
            mergedCount++;
            console.log(`   ✓ Merged pair ${pairId}: ${mergedRect.width}×${mergedRect.length} ${mergedRect.rotated ? '(rotated)' : ''}`);
          } else {
            mergedRects.push(p1, p2);
            unmergedCount += 2;
            console.log(`   ⚠️  Pair ${pairId} NOT merged: p1(${p1.width}×${p1.length},rot=${p1.rotated},x=${p1.x},y=${p1.y}) p2(${p2.width}×${p2.length},rot=${p2.rotated},x=${p2.x},y=${p2.y})`);
          }
          
        } else {
          mergedRects.push(...pieces);
          unmergedCount += pieces.length;
        }
      }
      
      console.log(`   ✓ Merged ${mergedCount} pairs successfully`);
      console.log(`   ⚠️  ${unmergedCount} pieces remain unmerged`);
      console.log(`   ✓ Total display rectangles: ${mergedRects.length}\n`);

      // ========== GIAI ĐOẠN 4: REBUILD - Xây dựng lại plates ==========
      console.log('📋 GIAI ĐOẠN 4: REBUILD - Xây dựng lại plates với merged rectangles\n');

      const newFinalPlates = [];
      const plateMap = new Map();
      let displayIdCounter = 1;

      mergedRects.sort((a, b) => a.plateIndex - b.plateIndex || a.layer - b.layer);

      for (const rect of mergedRects) {
        // Gán ID hiển thị
        if (rect.id.startsWith('merged_') || rect.id.startsWith('full_')) {
          rect.id = `rect_${displayIdCounter++}`;
        } else if (rect.pairId) {
          rect.id = `rect_half_${displayIdCounter++}`;
        }

        if (!plateMap.has(rect.plateIndex)) {
          const originalPlate = finalPlates.find(p => p.plateIndex === rect.plateIndex) || {
            plateIndex: rect.plateIndex,
            description: `Tấm ${rect.plateIndex + 1}`,
            layers: []
          };
          plateMap.set(rect.plateIndex, { ...originalPlate, layers: new Map() });
        }
        
        const plateData = plateMap.get(rect.plateIndex);
        
        if (!plateData.layers.has(rect.layer)) {
          plateData.layers.set(rect.layer, {
            layerIndexInPlate: rect.layer,
            rectangles: []
          });
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
      
      finalPlates = newFinalPlates.sort((a, b) => a.plateIndex - b.plateIndex);

      console.log(`   ✓ Rebuilt ${finalPlates.length} final plates\n`);

      // ========== GIAI ĐOẠN 5: SUMMARY - Tổng kết ==========
      console.log('📋 GIAI ĐOẠN 5: SUMMARY - Tổng kết kết quả\n');

      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);
      
      // Đếm số lượng rectangles GỐC đã được place
      let placedOriginalsCount = 0;
      const processedPairs = new Set();
      
      for (const rect of mergedRects) {
        if (rect.pairId != null) {
          if (!processedPairs.has(rect.pairId)) {
            processedPairs.add(rect.pairId);
            const otherPiece = mergedRects.find(r => r.pairId === rect.pairId && r.id !== rect.id);
            if (otherPiece) {
              placedOriginalsCount += 1;
            } else {
              placedOriginalsCount += 0.5;
            }
          }
        } else {
          placedOriginalsCount += 1;
        }
      }
      
      const placedCount = Math.round(placedOriginalsCount);

      console.log(`✓ Total plates: ${finalPlates.length}`);
      console.log(`✓ Rectangles placed: ${placedCount}/${totalRequested} (${((placedCount/totalRequested)*100).toFixed(1)}%)`);
      console.log(`✓ Pieces in pool: ${pool.length}`);

      // Tính efficiency
      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce((sum, plate) => sum + plate.layers.length * containerArea, 0);
      const placedArea = mergedRects.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;

      console.log(`✓ Total area: ${totalPlateArea.toFixed(0)}mm²`);
      console.log(`✓ Used area: ${placedArea.toFixed(0)}mm²`);
      console.log(`✓ Efficiency: ${efficiency.toFixed(2)}%`);

      // Breakdown theo loại
      console.log(`\n📋 Per-type breakdown:`);
      
      const placedByType = {};
      for (const rect of mergedRects) {
        const typeId = rect.originalTypeId || rect.typeId;
        if (rect.pairId != null) {
          placedByType[typeId] = (placedByType[typeId] || 0) + 0.5;
        } else {
          placedByType[typeId] = (placedByType[typeId] || 0) + 1;
        }
      }

      selectedTypes.forEach(type => {
        const requested = state.quantities[type.id] || 0;
        const placed = Math.round(placedByType[type.id] || 0);
        const percentage = requested > 0 ? (placed / requested) * 100 : 0;
        const status = placed === requested ? '✓' : placed > 0 ? '⚠️' : '✗';
        console.log(`   ${status} ${type.name}: ${placed}/${requested} (${percentage.toFixed(1)}%)`);
      });

      // Cảnh báo nếu còn pieces trong pool
      if (pool.length > 0 || placedCount < totalRequested) {
        const actualMissing = totalRequested - placedCount;
        console.log(`\n⚠️  Warning: ${actualMissing} rectangles could not be fully placed`);
        
        const poolByType = {};
        for (const item of pool) {
          const typeId = item.originalTypeId || item.typeId;
          poolByType[typeId] = (poolByType[typeId] || 0) + 0.5;
        }
        
        const poolDetails = Object.entries(poolByType)
          .filter(([_, cnt]) => cnt > 0)
          .map(([id, cnt]) => {
            const t = selectedTypes.find(x => x.id === Number(id));
            const rectCount = Math.round(cnt * 10) / 10;
            return `${t ? t.name : `#${id}`}: ${rectCount}`;
          }).join(', ');
            
        if (poolDetails) {
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Chỉ sắp được ${placedCount}/${totalRequested} hình (${((placedCount/totalRequested)*100).toFixed(1)}%). Còn lại: ${poolDetails}`
            }
          });
        }
      }

      const result = {
        layersUsed: finalPlates.reduce((sum, p) => sum + p.layers.length, 0),
        platesNeeded: finalPlates.length,
        layersPerPlate: layersPerPlate,
        totalRectanglesCount: totalRequested,
        placedRectanglesCount: placedCount,
        rectangles: mergedRects,
        plates: finalPlates,
        efficiency,
        pureCount: 0,
        hybridCount: 0,
        mixedCount: finalPlates.length
      };

      console.log('\n🎉 ========== TỐI ƯU HOÀN THÀNH (V4.0) ==========\n');

      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('\n✗ ========== LỖI TỐI ƯU ==========');
      console.error('Error:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'optimization', message: `Lỗi trong quá trình tối ưu: ${error.message}` }
      });
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } });
      return false;
    }
  };

  const clearErrors = useCallback(() => dispatch({ type: 'CLEAR_ERRORS' }), []);
  const toggleModbus = useCallback(() => dispatch({ type: 'TOGGLE_MODBUS' }), []);

  const addRectangle = useCallback((rectangle) => {
    const newId = getNewRectId();
    const defaultColor = '#3498db';
    
    console.log(`➕ Adding new rectangle with ID: ${newId}`, rectangle);
    
    dispatch({
      type: 'ADD_RECTANGLE',
      payload: { 
        ...rectangle, 
        id: newId, 
        color: rectangle.color || defaultColor, 
        typeId: newId 
      }
    });
  }, [getNewRectId]);

  const updateRectangle = useCallback((_id, _updates) => {}, []);
  
  const removeRectangle = useCallback((id) => {
    console.log(`🗑️ Removing rectangle with ID: ${id}`);
    dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  }, []);
  
  const selectRectangle = useCallback((id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id }), []);
  const selectAllRectangles = useCallback(() => dispatch({ type: 'SELECT_ALL_RECTANGLES' }), []);
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []);
  const setContainer = useCallback((data) => dispatch({ type: 'SET_CONTAINER', payload: data }), []);

  const value = {
    ...state,
    setContainer,
    setQuantity,
    addRectangle,
    updateRectangle,
    removeRectangle,
    selectRectangle,
    selectAllRectangles,
    clearSelection,
    startOptimization,
    clearErrors,
    toggleModbus,
    validateContainer,
    validateRectangles
  };

  return <PackingContext.Provider value={value}>{children}</PackingContext.Provider>;
};

export const usePacking = () => {
  const ctx = useContext(PackingContext);
  if (!ctx) throw new Error('usePacking must be used within a PackingProvider');
  return ctx;
};