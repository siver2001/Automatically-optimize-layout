import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { packingService } from '../services/packingService';

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
      return {
        ...state,
        rectangles: action.payload,
        selectedRectangles: []
      };
      
    case 'ADD_RECTANGLE':
      return {
        ...state,
        rectangles: [...state.rectangles, action.payload]
      };
      
    case 'UPDATE_RECTANGLE':
      return {
        ...state,
        rectangles: state.rectangles.map(rect =>
          rect.id === action.payload.id ? { ...rect, ...action.payload } : rect
        )
      };
      
    case 'REMOVE_RECTANGLE':
      return {
        ...state,
        rectangles: state.rectangles.filter(rect => rect.id !== action.payload),
        selectedRectangles: state.selectedRectangles.filter(id => id !== action.payload)
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
      return {
        ...state,
        packingResult: action.payload,
        isOptimizing: false,
        optimizationProgress: 100
      };
      
    case 'START_OPTIMIZATION':
      return {
        ...state,
        isOptimizing: true,
        optimizationProgress: 0,
        packingResult: null
      };
      
    case 'UPDATE_OPTIMIZATION_PROGRESS':
      return {
        ...state,
        optimizationProgress: action.payload
      };
      
    case 'SET_ERROR':
      return {
        ...state,
        errors: [...state.errors.filter(e => e.type !== action.payload.type), action.payload]
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
    
    errors.forEach(error => {
      dispatch({ type: 'SET_ERROR', payload: error });
    });
    
    return errors.length === 0;
  };

  const validateRectangles = () => {
    const errors = [];
    
    if (state.rectangles.length === 0) {
      errors.push({ type: 'rectangles', message: 'Phải có ít nhất một hình chữ nhật' });
    }
    
    state.rectangles.forEach((rect, index) => {
      if (rect.width <= 0 || rect.height <= 0) {
        errors.push({ 
          type: 'rectangles', 
          message: `Hình chữ nhật ${index + 1} có kích thước không hợp lệ` 
        });
      }
    });
    
    errors.forEach(error => {
      dispatch({ type: 'SET_ERROR', payload: error });
    });
    
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
    if (!validateContainer() || !validateRectangles()) {
      return false;
    }

    dispatch({ type: 'START_OPTIMIZATION' });
    
    try {
      const result = await packingService.optimizePacking(
        state.container,
        state.rectangles,
        state.container.layers
      );
      
      dispatch({ type: 'SET_PACKING_RESULT', payload: result.result });
      return true;
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: { 
        type: 'optimization', 
        message: `Lỗi tối ưu: ${error.message}` 
      }});
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
