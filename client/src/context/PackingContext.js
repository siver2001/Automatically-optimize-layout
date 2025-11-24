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
  warnings: [],
  packingStrategy: 'AREA_OPTIMIZED',
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

  const addRectanglesFromExcel = useCallback((parsedData) => {
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
  // MAIN OPTIMIZATION LOGIC
  // ============================================================
  const startOptimization = async () => {
    // 1. Reset lỗi và validate đầu vào
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) return false;

    try {
      dispatch({ type: 'START_OPTIMIZATION' });

      // 2. Chuẩn bị dữ liệu để gửi cho Worker
      // (Worker cần dữ liệu thô để tự tính toán logic Splitting/Pool)
      const payload = {
        container: state.container,
        rectangles: state.rectangles,         // Danh sách loại
        quantities: state.quantities,         // Số lượng
        selectedRectangles: state.selectedRectangles, // Những ID được chọn
        packingStrategy: state.packingStrategy // 'AREA_OPTIMIZED'
      };

      // 3. Gọi Service (Service sẽ khởi tạo Worker)
      // Lưu ý: Đảm bảo bạn đã cập nhật file packingService.js như hướng dẫn trước
      const { result, warnings } = await packingService.optimizeLayoutWithWorker(payload);

      // 4. Xử lý các cảnh báo từ Worker (nếu có)
      if (warnings && warnings.length > 0) {
        warnings.forEach(w => dispatch({ type: 'SET_WARNING', payload: w }));
      }

      // 5. Lưu kết quả trả về từ Worker vào State
      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('Error:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'optimization', message: `Lỗi trong quá trình tối ưu: ${error.message}` }
      });
      // Reset kết quả nếu lỗi
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
  const setPackingStrategy = useCallback((strategy) => {
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
  };

  return <PackingContext.Provider value={value}>{children}</PackingContext.Provider>;
};

export const usePacking = () => {
  const ctx = useContext(PackingContext);
  if (!ctx) throw new Error('usePacking must be used within a PackingProvider');
  return ctx;
};