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
      const { [action.payload]: _removed, ...newQuantities } = state.quantities;
      return {
        ...state,
        rectangles: state.rectangles.filter(r => r.id !== action.payload),
        selectedRectangles: state.selectedRectangles.filter(id => id !== action.payload),
        quantities: newQuantities
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

  const getNewRectId = useCallback(
    () => Math.max(0, ...state.rectangles.map(r => r.id)) + 1,
    [state.rectangles]
  );

  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  const validateContainer = () => {
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
  };

  const validateRectangles = () => {
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
  };

  // ============================================================
  // GIAI ĐOẠN 1: TÌM PATTERN THUẦN TỐI ƯU CHO MỖI SIZE
  // ============================================================
  const findPurePattern = async (rectType, sampleSize = 200) => {
    
    // Tạo mẫu để test
    const testRects = Array.from({ length: sampleSize }, (_, i) => ({
      ...rectType,
      id: `temp_pure_${rectType.id}_${i}`,
      typeId: rectType.id
    }));

    // Chạy thuật toán 2D packing cho 1 lớp
    const result = await packingService.optimizePacking(
      { ...state.container, layers: 1 },
      testRects,
      1
    );

    const pattern = (result?.result?.rectangles || [])
      .filter(r => r && r.layer === 0 && r.x !== undefined)
      .map(r => ({ 
        ...r, 
        typeId: r.typeId,
        x: r.x,
        y: r.y,
        width: r.width,
        length: r.length,
        rotated: r.rotated || false,
        color: r.color // SỬA LỖI: Giữ lại màu sắc từ server
      }));

    const perLayer = pattern.length;

    return { pattern, perLayer };
  };

  // ============================================================
  // GIAI ĐOẠN 2: XỬ LÝ POOL HỖN HỢP
  // ============================================================
  const createMixedPlate = async (pool, layersPerPlate) => {
    if (pool.length === 0) return null;


    // Sắp xếp pool theo diện tích giảm dần
    const sortedPool = [...pool].sort((a, b) => 
      (b.width * b.length) - (a.width * a.length)
    );

    // Chạy thuật toán 2D packing
    const result = await packingService.optimizePacking(
      { ...state.container, layers: layersPerPlate },
      sortedPool,
      layersPerPlate
    );

    const placed = (result?.result?.rectangles || [])
      .filter(r => r && r.x !== undefined)
      .map(r => ({
        ...r,
        typeId: r.typeId,
        x: r.x,
        y: r.y,
        width: r.width,
        length: r.length,
        layer: r.layer || 0,
        rotated: r.rotated || false,
        color: r.color // SỬA LỖI: Giữ lại màu sắc từ server
      }));

    // Xác định size nào được sử dụng
    const usedTypeIds = new Set(placed.map(r => r.typeId));
    const placedIds = new Set(placed.map(r => r.id));

    // Tính số lượng từng loại
    const typeCount = {};
    placed.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });


    return { placed, placedIds, usedTypeIds, typeCount };
  };

  // ============================================================
  // THUẬT TOÁN CHÍNH - REFACTORED
  // ============================================================
  const startOptimization = async () => {
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) return false;
    dispatch({ type: 'START_OPTIMIZATION' });

    try {
      const layersPerPlate = state.container.layers;

      // Lấy các loại đã chọn + có quantity > 0
      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      const finalPlates = [];
      let plateIndexCounter = 0;
      let rectPresentationId = 1;

      // ========== GIAI ĐOẠN 1: TẤM THUẦN ==========

      const purePatterns = new Map(); // Lưu pattern cho mỗi size
      const stock = new Map(); // Tồn kho hiện tại

      // Khởi tạo tồn kho
      selectedTypes.forEach(t => stock.set(t.id, state.quantities[t.id] || 0));

      // Tìm pattern thuần cho mỗi size
      for (const rectType of selectedTypes) {
        const { pattern, perLayer } = await findPurePattern(rectType);
        purePatterns.set(rectType.id, { pattern, perLayer });

        if (perLayer === 0) {
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp size ${rectType.name} vào tấm liệu (quá lớn).`
            }
          });
          stock.set(rectType.id, 0); // Đánh dấu không thể xử lý
          continue;
        }

        // Tính số tấm thuần cần thiết
        const totalQuantity = stock.get(rectType.id) || 0;
        const perPlate = perLayer * layersPerPlate;
        const fullPlates = Math.floor(totalQuantity / perPlate);

        if (fullPlates > 0) {

          // Tạo các tấm thuần
          for (let p = 0; p < fullPlates; p++) {
            const plate = {
              plateIndex: plateIndexCounter++,
              type: 'pure',
              description: `Tấm Thuần Size ${rectType.name} (#${p + 1})`,
              layers: []
            };

            // Tạo các lớp
            for (let l = 0; l < layersPerPlate; l++) {
              const layerRects = pattern.map(r => ({
                ...r,
                id: rectPresentationId++,
                layer: l,
                plateIndex: plate.plateIndex,
                typeId: rectType.id,
                color: rectType.color // Giữ màu gốc của type
              }));
              plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
            }

            finalPlates.push(plate);
          }

          // Cập nhật tồn kho
          const used = fullPlates * perPlate;
          const remaining = totalQuantity - used;
          stock.set(rectType.id, remaining);
        } else {
          console.log(`\n📦 Size ${rectType.name}: Số lượng không đủ để tạo tấm thuần (${totalQuantity} < ${perPlate})`);
        }
      }


      // ========== GIAI ĐOẠN 2: TẤM HỖN HỢP ==========

      // Tạo pool từ tồn kho còn lại
      let pool = [];
      let poolCounter = 0;
      
      for (const [typeId, qty] of stock.entries()) {
        if (qty <= 0) continue;
        
        const rectType = selectedTypes.find(t => t.id === typeId);
        if (!rectType) continue;

        for (let i = 0; i < qty; i++) {
          pool.push({
            ...rectType,
            id: `pool_${typeId}_${poolCounter++}`,
            typeId: typeId
          });
        }
      }

      if (pool.length === 0) {
        console.log('✅ Không còn hình nào cần xếp trong pool!');
      }

      // Helper: Tạo signature cho pattern để so sánh (CHỈ DỰA TRÊN LAYER 0)
      const createPatternSignature = (placed) => {
        // Chỉ lấy các hình ở layer 0 để so sánh pattern
        const layer0Rects = placed.filter(r => r.layer === 0);
        
        // Sắp xếp theo typeId và vị trí để tạo signature ổn định
        const sorted = [...layer0Rects].sort((a, b) => {
          if (a.typeId !== b.typeId) return a.typeId - b.typeId;
          if (a.x !== b.x) return a.x - b.x;
          return a.y - b.y;
        });

        // Tạo signature dạng string (KHÔNG BAO GỒM layer index)
        return sorted.map(r => 
          `${r.typeId}:${r.x}:${r.y}:${r.width}:${r.length}:${r.rotated ? 1 : 0}`
        ).join('|');
      };

      let mixedPlateCounter = 1;
      const MAX_ITERATIONS = 100; // Giới hạn số lần lặp
      const mixedPatterns = new Map(); // Lưu các pattern đã gặp: signature -> { plate, layers }

      let iterationCount = 0;

      while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
        iterationCount++;

        const mixedResult = await createMixedPlate(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
          
          // Thông báo cho user về các hình không xếp được
          const remainingByType = {};
          pool.forEach(r => {
            remainingByType[r.typeId] = (remainingByType[r.typeId] || 0) + 1;
          });
          
          const msg = Object.entries(remainingByType)
            .map(([id, cnt]) => {
              const t = selectedTypes.find(x => x.id === Number(id));
              return `${t ? t.name : `#${id}`}: ${cnt}`;
            }).join(', ');

          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp ${pool.length} hình còn lại (${msg}) - Có thể do kích thước quá lớn hoặc không gian không đủ.`
            }
          });
          
          break;
        }

        const { placed, placedIds, typeCount } = mixedResult;

        // CHUẨN HÓA: Reset tất cả layer về 0 để so sánh pattern
        const normalizedPlaced = placed.map(r => ({
          ...r,
          layer: 0, // Đặt tất cả về layer 0 để so sánh
          typeId: r.typeId,
          x: r.x,
          y: r.y,
          width: r.width,
          length: r.length,
          rotated: r.rotated || false,
          color: r.color // SỬA LỖI: Đảm bảo giữ màu
        }));

        // Tạo signature cho pattern này (dựa trên layer 0)
        const signature = createPatternSignature(normalizedPlaced);

        // Tổ chức placed theo layer ban đầu (trước khi chuẩn hóa)
        const layerMap = new Map();
        placed.forEach(r => {
          if (!layerMap.has(r.layer)) {
            layerMap.set(r.layer, []);
          }
          layerMap.get(r.layer).push({
            ...r,
            typeId: r.typeId,
            x: r.x,
            y: r.y,
            width: r.width,
            length: r.length,
            rotated: r.rotated || false,
            color: r.color // SỬA LỖI: Đảm bảo giữ màu
          });
        });

        const newLayers = Array.from(layerMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, rects]) => rects);

        // Kiểm tra xem pattern này đã tồn tại chưa
        if (mixedPatterns.has(signature)) {
          // Pattern đã tồn tại -> Thêm layers vào plate hiện có
          const existingData = mixedPatterns.get(signature);
          
          // Gán ID và plateIndex cho các rect trong layers mới
          const layersToAdd = newLayers.map((rects, layerOffset) => {
            const currentLayerIndex = existingData.layers.length + layerOffset;
            return {
              layerIndexInPlate: currentLayerIndex,
              rectangles: rects.map(r => ({
                ...r,
                id: rectPresentationId++,
                layer: currentLayerIndex,
                plateIndex: existingData.plate.plateIndex
              }))
            };
          });

          existingData.layers.push(...layersToAdd);
          existingData.repetitions++;

        } else {
          // Pattern mới -> Tạo plate mới
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

          // Gán ID và plateIndex cho các rect
          const initialLayers = newLayers.map((rects, layerIdx) => ({
            layerIndexInPlate: layerIdx,
            rectangles: rects.map(r => ({
              ...r,
              id: rectPresentationId++,
              layer: layerIdx,
              plateIndex: plate.plateIndex
            }))
          }));

          plate.layers = initialLayers;

          mixedPatterns.set(signature, {
            plate: plate,
            layers: initialLayers,
            repetitions: 1
          });

          mixedPlateCounter++;

        }
        
        // ---------- [SỬA LỖI] KHỐI CODE BỊ LẶP ĐÃ BỊ XÓA TỪ ĐÂY ----------
        
        // Loại bỏ các hình đã xếp khỏi pool
        pool = pool.filter(r => !placedIds.has(r.id));

      }

      // Thêm tất cả các plate từ mixedPatterns vào finalPlates
      for (const [, data] of mixedPatterns.entries()) {
        const { plate, layers, repetitions } = data;
        
        // Cập nhật description với số lớp thực tế
        plate.description = `Tấm Hỗn Hợp #${plate.plateIndex - plateIndexCounter + mixedPlateCounter} (${layers.length} lớp | ${plate.patternDescription})`;
        if (repetitions > 1) {
          plate.description += ` [×${repetitions}]`;
        }
        
        plate.layers = layers;
        finalPlates.push(plate);
      }

      if (pool.length > 0 && iterationCount >= MAX_ITERATIONS) {
        console.error('❌ Đã đạt giới hạn số lần lặp!');
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp nhưng vẫn còn ${pool.length} hình chưa xếp được.`
          }
        });
      }

      // ========== TỔNG KẾT ==========

      const allPlaced = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);
      const placedCount = allPlaced.length;

      const pureCount = finalPlates.filter(p => p.type === 'pure').length;
      const mixedCount = finalPlates.filter(p => p.type === 'mixed').length;


      // Tính hiệu suất
      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce(
        (sum, plate) => sum + plate.layers.length * containerArea,
        0
      );
      const placedArea = allPlaced.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;

      const missing = totalRequested - placedCount;
      if (missing > 0) {
        dispatch({
          type: 'SET_WARNING',
          payload: {
            type: 'optimization',
            message: `Chỉ sắp được ${placedCount}/${totalRequested} hình. ${missing} hình không thể xếp vào tấm liệu.`
          }
        });
      }

      const result = {
        layersUsed: finalPlates.length,
        platesNeeded: finalPlates.length,
        layersPerPlate: layersPerPlate,
        totalRectanglesCount: totalRequested,
        placedRectanglesCount: placedCount,
        rectangles: allPlaced,
        plates: finalPlates,
        efficiency,
        pureCount,
        mixedCount
      };

      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('❌ Lỗi tối ưu:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'optimization', message: `Lỗi trong quá trình tối ưu: ${error.message}` }
      });
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } });
      return false;
    }
  };

  const clearErrors = () => dispatch({ type: 'CLEAR_ERRORS' });
  const toggleModbus = () => dispatch({ type: 'TOGGLE_MODBUS' });

  const addRectangle = (rectangle) => {
    const newId = getNewRectId();
    const defaultColor = '#3498db';
    dispatch({
      type: 'ADD_RECTANGLE',
      payload: { ...rectangle, id: newId, color: defaultColor, typeId: newId }
    });
  };

  const updateRectangle = (_id, _updates) => {};
  const removeRectangle = (id) => dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  const selectRectangle = (id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id });
  const selectAllRectangles = () => dispatch({ type: 'SELECT_ALL_RECTANGLES' });
  const clearSelection = () => dispatch({ type: 'CLEAR_SELECTION' });
  const setContainer = (data) => dispatch({ type: 'SET_CONTAINER', payload: data });

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