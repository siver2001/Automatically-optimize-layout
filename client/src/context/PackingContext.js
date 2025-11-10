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
      }
    }

    if (!bestResult || bestResult.length === 0) return null;


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

    try {
      dispatch({ type: 'START_OPTIMIZATION' });
      const layersPerPlate = state.container.layers;

      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      let finalPlates = [];
      let plateIndexCounter = 0;

      // ========== GIAI ĐOẠN 1: SPLIT - Tạo Pool (Chia đôi CHIỀU RỘNG) ==========

      let pool = [];
      let poolCounter = 0;

      for (const rectType of selectedTypes) {
        const quantity = state.quantities[rectType.id] || 0;
        if (quantity <= 0) continue;

        const halfWidth = rectType.width / 2;
        const canSplit = halfWidth >= MIN_SPLIT_WIDTH;

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

      // ========== GIAI ĐOẠN 2: PACK - Sắp xếp các pieces ==========

      const mixedPatterns = new Map();
      let mixedPlateCounter = 1;
      let iterationCount = 0;
      let currentLayerInPlate = 0;

      while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
        iterationCount++;

        const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
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
          if (currentLayerInPlate === layersPerPlate) {
            currentLayerInPlate = 0; // Reset để bắt đầu tấm mới
          }

        } else {
          // Pattern mới → Tạo plate mới
          
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
            currentLayerInPlate = 0;
          }

          mixedPlateCounter++;
        }
        
        pool = pool.filter(r => !placedIds.has(r.id));
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
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp, còn ${pool.length} pieces chưa xếp được.`
          }
        });
      }

      // ========== GIAI ĐOẠN 3: MERGE - Ghép các pieces liền kề ==========

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
      

      for (const [pairId, pieces] of groupedByPair.entries()) {
        if (pieces.length === 1) {
          mergedRects.push(pieces[0]);
        } else if (pieces.length === 2) {
          const p1 = pieces[0];
          const p2 = pieces[1];
          
          let isAdjacent = false;
          let mergedRect = null;
          
          if (p1.plateIndex === p2.plateIndex && p1.layer === p2.layer) {
            const tolerance = 1.0;

            // Nếu chia theo chiều rộng → ghép theo trục X
            if (p1.splitDirection === 'width') {
              const sameRow = Math.abs(p1.y - p2.y) <= tolerance;
              const touching = Math.abs((p1.x + p1.width) - p2.x) <= tolerance ||
                              Math.abs((p2.x + p2.width) - p1.x) <= tolerance;

              if (sameRow && touching) {
                isAdjacent = true;
                mergedRect = {
                  id: `merged_${pairId}`,
                  plateIndex: p1.plateIndex,
                  layer: p1.layer,
                  x: Math.min(p1.x, p2.x),
                  y: Math.min(p1.y, p2.y),
                  width: p1.width + p2.width,
                  length: p1.length,
                  color: p1.color,
                  rotated: false,
                  typeId: p1.originalTypeId,
                  mergedFrom: [p1.id, p2.id]
                };
              }
            }

            // Nếu chia theo chiều dài → ghép theo trục Y
            if (p1.splitDirection === 'length') {
              const sameColumn = Math.abs(p1.x - p2.x) <= tolerance;
              const touching = Math.abs((p1.y + p1.length) - p2.y) <= tolerance ||
                              Math.abs((p2.y + p2.length) - p1.y) <= tolerance;

              if (sameColumn && touching) {
                isAdjacent = true;
                mergedRect = {
                  id: `merged_${pairId}`,
                  plateIndex: p1.plateIndex,
                  layer: p1.layer,
                  x: Math.min(p1.x, p2.x),
                  y: Math.min(p1.y, p2.y),
                  width: p1.width,
                  length: p1.length + p2.length,
                  color: p1.color,
                  rotated: false,
                  typeId: p1.originalTypeId,
                  mergedFrom: [p1.id, p2.id]
                };
              }
            }
          }

          if (isAdjacent && mergedRect) {
            mergedRects.push(mergedRect);
          } else {
            mergedRects.push(p1, p2);
          }
          
        } else {
          mergedRects.push(...pieces);
        }
      }

      // ========== GIAI ĐOẠN 4: REBUILD - Xây dựng lại plates ==========

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

      // ========== GIAI ĐOẠN 5: SUMMARY - Tổng kết ==========

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


      // Tính efficiency
      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce((sum, plate) => sum + plate.layers.length * containerArea, 0);
      const placedArea = mergedRects.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;


      // Breakdown theo loại
      
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


      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
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