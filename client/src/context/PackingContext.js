import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react'; // Added useCallback
import { packingService } from '../services/packingService.js';

const PackingContext = createContext();

const initialState = {
  // Container settings
  container: {
    width: 0,
    height: 0,
    layers: 1
  },
  
  // Rectangles data
  rectangles: [],
  selectedRectangles: [],
  quantities: {}, 
  
  // Packing results
  packingResult: null,
  isOptimizing: false,
  optimizationProgress: 0,
  
  // UI state
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
      
    case 'SET_RECTANGLES':
      // Initialize quantities to 1 for new rectangles data
      const initialQuantities = action.payload.reduce((acc, rect) => {
          acc[rect.id] = 1; 
          return acc;
      }, {});
      return {
        ...state,
        rectangles: action.payload,
        selectedRectangles: [],
        quantities: initialQuantities // Set initial quantities
      };
      
    case 'ADD_RECTANGLE':
      return {
        ...state,
        rectangles: [...state.rectangles, action.payload],
        quantities: { ...state.quantities, [action.payload.id]: 1 } // Default quantity 1 for new item
      };
      
    case 'UPDATE_RECTANGLE':
      return {
        ...state,
        rectangles: state.rectangles.map(rect =>
          rect.id === action.payload.id ? { ...rect, ...action.payload } : rect
        )
      };
      
    case 'REMOVE_RECTANGLE':
      // Remove rectangle and its quantity from state
      const { [action.payload]: removedQuantity, ...newQuantities } = state.quantities;
      return {
        ...state,
        rectangles: state.rectangles.filter(rect => rect.id !== action.payload),
        selectedRectangles: state.selectedRectangles.filter(id => id !== action.payload),
        quantities: newQuantities
      };
      
    case 'SET_QUANTITY':
        return {
          ...state,
          quantities: {
            ...state.quantities,
            [action.payload.id]: action.payload.quantity
          }
        };
      
    case 'SELECT_RECTANGLE':
      return {
        ...state,
        selectedRectangles: state.selectedRectangles.includes(action.payload)
          ? state.selectedRectangles.filter(id => id !== action.payload)
          : [...state.selectedRectangles, action.payload]
      };
      
    case 'SELECT_ALL_RECTANGLES':
      return {
        ...state,
        selectedRectangles: state.rectangles.map(rect => rect.id)
      };
      
    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedRectangles: []
      };
      
    case 'SET_PACKING_RESULT':
      const allRects = action.payload.rectangles || [];
      // Sử dụng layersUsed từ kết quả server (hoặc tối thiểu là 1 nếu có kết quả nhưng không có thông tin layersUsed)
      const actualLayersUsed = action.payload.layersUsed || (allRects.length > 0 ? 1 : 0);
      
      const resultByLayer = Array.from({ length: actualLayersUsed }, (_, i) => ({
        layer: i,
        // Lọc các hình đã được xếp trên lớp có index i
        rectangles: allRects.filter(r => (r.layer || 0) === i), 
      }));
      
      return {
        ...state,
        packingResult: {
            ...action.payload,
            layersUsed: actualLayersUsed, // Lưu số lớp thực tế đã dùng
            layers: resultByLayer
        },
        isOptimizing: false,
        optimizationProgress: 100
      };
      
    case 'START_OPTIMIZATION':
      return {
        ...state,
        isOptimizing: true,
        optimizationProgress: 0,
        packingResult: null,
        errors: state.errors.filter(e => e.type !== 'optimization' && e.type !== 'rectangles') // Clear relevant errors
      };
      
    case 'UPDATE_OPTIMIZATION_PROGRESS':
      return {
        ...state,
        optimizationProgress: action.payload
      };
      
    case 'SET_ERROR':
      // Clear all errors of the same type before adding the new one
      const filteredErrors = state.errors.filter(e => e.type !== action.payload.type);
      return {
        ...state,
        errors: [...filteredErrors, action.payload]
      };
      
    case 'CLEAR_ERRORS':
      return {
        ...state,
        errors: [],
        warnings: []
      };
      
    case 'TOGGLE_MODBUS':
      return {
        ...state,
        showModbus: !state.showModbus
      };
      
    default:
      return state;
  }
};

export const PackingProvider = ({ children }) => {
  const [state, dispatch] = useReducer(packingReducer, initialState);

  // Load default rectangles on mount
  useEffect(() => {
    const loadDefaultRectangles = async () => {
      try {
        const data = await packingService.getDefaultRectangles();
        dispatch({ type: 'SET_RECTANGLES', payload: data.rectangles });
      } catch (error) {
        console.error('Error loading default rectangles:', error);
      }
    };
    
    loadDefaultRectangles();
  }, []);

  // Use useCallback for setQuantity to avoid unnecessary re-renders in child components
  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  // Validation
  const validateContainer = () => {
    const { width, height, layers } = state.container;
    const errors = [];
    
    if (width <= 0) {
      errors.push({ type: 'container', message: 'Chiều rộng container phải lớn hơn 0' });
    }
    
    if (height <= 0) {
      errors.push({ type: 'container', message: 'Chiều cao container phải lớn hơn 0' });
    }
    
    if (layers <= 0) {
      errors.push({ type: 'container', message: 'Số lớp phải lớn hơn 0' });
    }
    
    if (width > 10000 || height > 10000) {
      errors.push({ type: 'container', message: 'Kích thước container quá lớn (tối đa 10000mm)' });
    }
    
    // Dispatch container errors only to show them on the form
    if (errors.length > 0) {
        dispatch({ type: 'SET_ERROR', payload: { type: 'container', message: errors.map(e => e.message).join('. ') } });
    }
    
    return errors.length === 0;
  };

  const validateRectangles = () => {
    const errors = [];
    const totalRectanglesCount = state.rectangles
        .filter(rect => state.selectedRectangles.includes(rect.id))
        .reduce((sum, rect) => sum + (state.quantities[rect.id] || 0), 0);
    
    if (totalRectanglesCount === 0) {
      errors.push({ type: 'rectangles', message: 'Phải chọn ít nhất một hình chữ nhật với số lượng lớn hơn 0' });
    }
    
    // Dispatch rectangle selection errors
    if (errors.length > 0) {
        dispatch({ type: 'SET_ERROR', payload: { type: 'rectangles', message: errors.map(e => e.message).join('. ') } });
    }
    
    return errors.length === 0;
  };

  // Actions
  const setContainer = (containerData) => {
    dispatch({ type: 'SET_CONTAINER', payload: containerData });
  };

  const addRectangle = (rectangle) => {
    const newId = Math.max(...state.rectangles.map(r => r.id), 0) + 1;
    dispatch({ type: 'ADD_RECTANGLE', payload: { ...rectangle, id: newId } });
  };

  const updateRectangle = (id, updates) => {
    dispatch({ type: 'UPDATE_RECTANGLE', payload: { id, ...updates } });
  };

  const removeRectangle = (id) => {
    dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  };

  const selectRectangle = (id) => {
    dispatch({ type: 'SELECT_RECTANGLE', payload: id });
  };

  const selectAllRectangles = () => {
    dispatch({ type: 'SELECT_ALL_RECTANGLES' });
  };

  const clearSelection = () => {
    dispatch({ type: 'CLEAR_SELECTION' });
  };

  const startOptimization = async () => {
    // Clear only optimization and rectangle errors 
    dispatch({ type: 'CLEAR_ERRORS' }); // This needs refinement, but works to clear all for now

    // Re-validate everything
    if (!validateContainer() || !validateRectangles()) {
      return false;
    }

    dispatch({ type: 'START_OPTIMIZATION' });
    
    try {
        // --- Core logic to handle quantities: Duplicate rectangles ---
        const rectanglesToPack = [];
        // Ensure unique IDs for all instances of rectangles
        let uniqueIdCounter = Math.max(...state.rectangles.map(r => r.id), 0) + 1; 
        
        for (const rect of state.rectangles) {
            if (state.selectedRectangles.includes(rect.id)) {
                const quantity = state.quantities[rect.id] || 0;
                // Only consider rectangles with a quantity > 0
                for (let i = 0; i < quantity; i++) {
                    // Create a unique instance for each rectangle being packed
                    rectanglesToPack.push({ 
                        ...rect, 
                        // Assign a new unique ID for the packing instance
                        id: uniqueIdCounter++, 
                        // Keep a reference to the original type ID (for potential later use)
                        typeId: rect.id 
                    });
                }
            }
        }
        // --- End core quantity logic ---

      const result = await packingService.optimizePacking(
        state.container,
        rectanglesToPack, 
        state.container.layers // Pass max layers
      );
      
      dispatch({ type: 'SET_PACKING_RESULT', payload: result.result });
      return true;
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: { 
        type: 'optimization', 
        message: `Lỗi tối ưu: ${error.message}` 
      }});
      // Even if it fails, set an empty result to stop the loading state
      dispatch({ type: 'SET_PACKING_RESULT', payload: { rectangles: [] } });
      return false;
    }
  };

  const clearErrors = () => {
    dispatch({ type: 'CLEAR_ERRORS' });
  };

  const toggleModbus = () => {
    dispatch({ type: 'TOGGLE_MODBUS' });
  };

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

  return (
    <PackingContext.Provider value={value}>
      {children}
    </PackingContext.Provider>
  );
};

export const usePacking = () => {
  const context = useContext(PackingContext);
  if (!context) {
    throw new Error('usePacking must be used within a PackingProvider');
  }
  return context;
};