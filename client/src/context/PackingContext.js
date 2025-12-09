/* eslint-disable no-loop-func */
import React from 'react';
import { packingService } from '../services/packingService.js';

// ============================================================
// ✅ HELPER 1: Tách Giai đoạn 3 - MERGE
// (Hàm này nhận vào 1 danh sách pieces, trả về danh sách đã merge)
// ============================================================
// Helpers removed (moved to backend)

const PackingContext = React.createContext();

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
  warnings: [],
  packingStrategy: 'AREA_OPTIMIZED',
  unsplitableRectIds: [],
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

    case 'ADD_RECTANGLES_BATCH':
      return {
        ...state,
        // Thay thế hoàn toàn bằng danh sách mới
        rectangles: action.payload.newRectangles,

        // Thay thế hoàn toàn số lượng
        quantities: action.payload.newQuantities,

        // Thay thế hoàn toàn danh sách chọn
        selectedRectangles: action.payload.newSelected,

        // Xóa kết quả và lỗi cũ
        packingResult: null,
        errors: [],
        warnings: []
      };
    case 'SET_PACKING_STRATEGY':
      return { ...state, packingStrategy: action.payload };
    case 'SET_UNSPLITABLE_IDS':
      return { ...state, unsplitableRectIds: action.payload };
    default:
      return state;
  }
};

export const PackingProvider = ({ children }) => {

  const [state, dispatch] = React.useReducer(packingReducer, initialState);

  React.useEffect(() => {
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

  const getNewRectId = React.useCallback(() => {
    const currentMaxId = Math.max(0, ...state.rectangles.map(r => r.id));
    if (currentMaxId >= nextIdRef.current) {
      nextIdRef.current = currentMaxId + 1;
    }
    const newId = nextIdRef.current;
    nextIdRef.current += 1;
    return newId;
  }, [state.rectangles]);

  const addRectanglesFromExcel = React.useCallback((parsedData) => {
    const newRectangles = [];
    const newQuantities = {};
    const newSelected = [];
    for (const item of parsedData) {
      const newId = getNewRectId();
      const newRect = {
        ...item.rect,// { name, length, width, color }
        id: newId,
        typeId: newId // Gán ID và typeId
      };
      newRectangles.push(newRect);
      newQuantities[newId] = item.quantity; // Gán số lượng
      newSelected.push(newId); // Tự động chọn
    }
    dispatch({
      type: 'ADD_RECTANGLES_BATCH',
      payload: { newRectangles, newQuantities, newSelected }
    });
  }, [getNewRectId]);
  const setQuantity = React.useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  const setUnsplitableRectIds = React.useCallback((ids) => {
    dispatch({ type: 'SET_UNSPLITABLE_IDS', payload: ids });
  }, []);

  const validateContainer = React.useCallback(() => {
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

  const validateRectangles = React.useCallback(() => {
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
  const MAX_ITERATIONS = 10000; // Số lần lặp tối đa cho mixed plates

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
          return (ratioA - ratioB) || (a.pairId || '').localeCompare(b.pairId || '');
        }
      }
    ];

    let bestResult = null;
    let bestArea = 0;

    for (const strategy of strategies) {
      // Clone và sort pool theo chiến thuật mới
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
      dispatch({ type: 'START_OPTIMIZATION' });
      // Reset progress
      dispatch({ type: 'UPDATE_OPTIMIZATION_PROGRESS', payload: 0 });

      const layersPerPlate = state.container.layers;

      // START STREAMING
      const stream = packingService.optimizeBatch(
        state.container,
        state.rectangles,
        state.quantities,
        state.packingStrategy,
        state.unsplitableRectIds,
        layersPerPlate
      );

      for await (const update of stream) {
        if (update.type === 'progress') {
          dispatch({ type: 'UPDATE_OPTIMIZATION_PROGRESS', payload: update.value });
        } else if (update.type === 'result') {
          if (update.data && update.data.success) {
            dispatch({ type: 'SET_PACKING_RESULT', payload: update.data.packingResult });
            // Ensure 100% on success
            dispatch({ type: 'UPDATE_OPTIMIZATION_PROGRESS', payload: 100 });
          } else {
            throw new Error(update.data?.error || 'Tối ưu thất bại');
          }
        } else if (update.type === 'error') {
          throw new Error(update.message);
        }
      }


    } catch (error) {
      console.error("Optimization failed:", error);
      dispatch({ type: 'SET_ERROR', payload: { type: 'optimization', message: `Lỗi tối ưu: ${error.message}` } });
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } });
    }
  };


  const clearErrors = React.useCallback(() => dispatch({ type: 'CLEAR_ERRORS' }), []);
  const toggleModbus = React.useCallback(() => dispatch({ type: 'TOGGLE_MODBUS' }), []);

  const addRectangle = React.useCallback((rectangle) => {
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

  const updateRectangle = React.useCallback((_id, _updates) => { }, []);

  const removeRectangle = React.useCallback((id) => {
    dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  }, []);

  const selectRectangle = React.useCallback((id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id }), []);
  const selectAllRectangles = React.useCallback(() => dispatch({ type: 'SELECT_ALL_RECTANGLES' }), []);
  const clearSelection = React.useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []);
  const setContainer = React.useCallback((data) => dispatch({ type: 'SET_CONTAINER', payload: data }), []);
  const setPackingStrategy = React.useCallback((strategy) => {
    dispatch({ type: 'SET_PACKING_STRATEGY', payload: strategy });
  }, []);
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
    validateRectangles,
    addRectanglesFromExcel,
    setPackingStrategy,
    setUnsplitableRectIds,
  };

  return <PackingContext.Provider value={value}>{children}</PackingContext.Provider>;
};

export const usePacking = () => {
  const ctx = React.useContext(PackingContext);
  if (!ctx) throw new Error('usePacking must be used within a PackingProvider');
  return ctx;
};