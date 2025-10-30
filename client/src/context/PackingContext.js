/* eslint-disable no-loop-func */
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { packingService } from '../services/packingService.js';

const PackingContext = createContext();

const initialState = {
  // Container settings
  container: {
    width: 0,
    length: 0,
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
        quantities: { ...state.quantities, [action.payload.id]: 1 }, // Default quantity 1 for new item
        selectedRectangles: [...state.selectedRectangles, action.payload.id] // Auto-select new custom item
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
        packingResult: null,
        errors: state.errors.filter(e => e.type !== 'optimization' && e.type !== 'rectangles') 
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

  // Utility to generate a unique ID
  const getNewRectId = useCallback(() => {
      // Find the current maximum ID and increment it
      return Math.max(0, ...state.rectangles.map(r => r.id)) + 1;
  }, [state.rectangles]);

  // Use useCallback for setQuantity to avoid unnecessary re-renders in child components
  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  // Validation
  const validateContainer = () => {
    const { width, length, layers } = state.container;
    const errors = [];
    
    if (width <= 0) {
      errors.push({ type: 'container', message: 'Chiều rộng container phải lớn hơn 0' });
    }
    
    if (length <= 0) {
      errors.push({ type: 'container', message: 'Chiều cao container phải lớn hơn 0' });
    }
    
    if (layers <= 0) {
      errors.push({ type: 'container', message: 'Số lớp phải lớn hơn 0' });
    }
    
    if (width > 10000 || length > 10000) {
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
    const newId = getNewRectId();
    // Use a generic color for custom items
    const defaultColor = '#9E9E9E'; 
    dispatch({ type: 'ADD_RECTANGLE', payload: { 
        ...rectangle, 
        id: newId, 
        color: defaultColor 
    } });
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
    dispatch({ type: 'CLEAR_ERRORS' });

    if (!validateContainer() || !validateRectangles()) {
      return false;
    }

    dispatch({ type: 'START_OPTIMIZATION' });
    
    try {
        // --- Chuẩn bị TẤT CẢ các hình cần đóng gói để tính tổng số lượng ---
        const rectanglesToPack = [];
        let uniqueIdCounter = Math.max(0, ...state.rectangles.map(r => r.id)) + 1;
        
        const selectedRectTypes = state.rectangles
            .filter(rect => state.selectedRectangles.includes(rect.id) && (state.quantities[rect.id] || 0) > 0);
            
        // Map để lưu trữ tổng số lượng của mỗi loại hình
        const rectTypeQuantities = selectedRectTypes.reduce((acc, rect) => {
            acc[rect.id] = state.quantities[rect.id];
            return acc;
        }, {});
            
        for (const rect of selectedRectTypes) {
            const quantity = rectTypeQuantities[rect.id];
            for (let i = 0; i < quantity; i++) {
                rectanglesToPack.push({ 
                    ...rect, 
                    id: uniqueIdCounter++, 
                    typeId: rect.id 
                });
            }
        }
        const totalRectanglesCount = rectanglesToPack.length; 
        
        
        // 1. CHUẨN BỊ INPUT CHO VIỆC TÌM MẪU TỐI ƯU (CÂN BẰNG ĐA DẠNG)
        const MAX_PATTERN_SAMPLE_SIZE = 25; 
        
        // Sắp xếp các loại hình theo diện tích giảm dần để ưu tiên hình lớn,
        // nhưng vẫn lấy mẫu từ tất cả các loại.
        const sortedTypes = selectedRectTypes.sort((a, b) => (b.width * b.length) - (a.width * a.length));
        
        let patternDiscoveryInput = [];
        let tempId = uniqueIdCounter;
        
        // Lấy ít nhất 1 hình của mỗi loại (nếu có thể) và sau đó thêm hình theo tỷ lệ.
        
        // Bước 1: Đảm bảo có ít nhất 1 mẫu của MỖI loại (nếu số lượng > 0)
        sortedTypes.forEach(rect => {
            if (rectTypeQuantities[rect.id] > 0 && patternDiscoveryInput.length < MAX_PATTERN_SAMPLE_SIZE) {
                 patternDiscoveryInput.push({
                    ...rect,
                    id: tempId++,
                    typeId: rect.id
                });
                rectTypeQuantities[rect.id]--; // Trừ đi 1 hình đã dùng để tạo mẫu
            }
        });
        
        // Bước 2: Thêm các hình còn lại theo tỷ lệ cho đến khi đạt MAX_PATTERN_SAMPLE_SIZE
        let currentTypeIndex = 0;
        while (patternDiscoveryInput.length < MAX_PATTERN_SAMPLE_SIZE && totalRectanglesCount > 0) {
            const rect = sortedTypes[currentTypeIndex % sortedTypes.length];
            if (rectTypeQuantities[rect.id] > 0) {
                 patternDiscoveryInput.push({
                    ...rect,
                    id: tempId++,
                    typeId: rect.id
                });
                rectTypeQuantities[rect.id]--;
            }
            currentTypeIndex++;
            if (currentTypeIndex >= sortedTypes.length * 2 && patternDiscoveryInput.length === 0) {
                 // Ngăn chặn vòng lặp vô hạn nếu tất cả các số lượng đã bị trừ hết trong bước 1
                 break;
            }
        }
        
        if (patternDiscoveryInput.length === 0 && totalRectanglesCount > 0) {
             // Dùng toàn bộ rectanglesToPack nếu mẫu quá nhỏ hoặc logic mẫu thất bại
             patternDiscoveryInput = rectanglesToPack.slice(0, MAX_PATTERN_SAMPLE_SIZE);
        }
        
        // 1b. Chạy tối ưu chỉ với 1 lớp để tìm ra pattern tối ưu
        const MAX_LAYERS_TO_RUN = 1;
        const containerForServer = { width: state.container.width, length: state.container.length, layers: 1 };
        
        const result = await packingService.optimizePacking(
          containerForServer, 
          patternDiscoveryInput, // Sử dụng input đa dạng, đã cân bằng
          MAX_LAYERS_TO_RUN 
        );
        
        // Lấy kết quả từ lớp đầu tiên (layer 0) VÀ LỌC CÁC MỤC UNDEFINED
        const patternRectsPlaced = result.result.rectangles
            .filter(Boolean) 
            .filter(r => r.layer === 0);
            
        let placedPerLayer = patternRectsPlaced.length;
        
        if (placedPerLayer === 0 && totalRectanglesCount > 0) {
            throw new Error(`Không thể sắp xếp bất kỳ hình nào vào tấm liệu ${state.container.width}x${state.container.length}. Vui lòng kiểm tra lại kích thước hình chữ nhật và tấm liệu.`);
        }

        // --- BƯỚC QUAN TRỌNG: SẮP XẾP LẠI MẪU THEO THỨ TỰ NHẬP BAN ĐẦU ---
        // Sắp xếp các hình trong mẫu theo typeId và vị trí (đảm bảo hết size này rồi tới size khác)
        const sortedPattern = patternRectsPlaced.sort((a, b) => a.typeId - b.typeId);

        const singleLayerPattern = sortedPattern.map(r => ({
            ...r,
            uniqueId: r.id, 
            width: r.width, 
            length: r.length,
            rotated: r.rotated,
        }));
        placedPerLayer = singleLayerPattern.length; // Cập nhật lại số lượng hình trong mẫu

        // 2. Tính toán số tấm liệu cần thiết
        const layersPerPlate = state.container.layers;
        const placedPerPlate = placedPerLayer * layersPerPlate;

        // Số tấm liệu cần thiết để xếp đủ totalRectanglesCount
        const platesNeeded = placedPerPlate > 0 
            ? Math.ceil(totalRectanglesCount / placedPerPlate) 
            : 0;
        
        // 3. Tính toán lại Hiệu suất TỔNG THỂ
        // Tính tổng diện tích của TẤT CẢ các hình chữ nhật ban đầu
        const totalRectanglesArea = rectanglesToPack.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        
        const totalMaxPlateArea = platesNeeded * state.container.width * state.container.length * layersPerPlate;
        
        const efficiency = totalMaxPlateArea > 0 
            ? (totalRectanglesArea / totalMaxPlateArea) * 100 
            : 0;
        
        // 4. Tạo cấu trúc kết quả đầy đủ cho hiển thị
        let allPlacedRectangles = [];
        let neededRects = totalRectanglesCount;
        let presentationIdCounter = 1; 
        
        const finalPlateResults = Array.from({ length: platesNeeded }, (_, plateIndex) => {
            const plate = {
                plateIndex: plateIndex,
                layers: []
            };

            for (let layerIndex = 0; layerIndex < layersPerPlate; layerIndex++) {
                if (neededRects <= 0) break; 
                
                // Lặp lại mẫu cho đến khi đủ số lượng cần thiết
                const numToPlaceInThisLayer = Math.min(placedPerLayer, neededRects);
                const layerRects = singleLayerPattern.slice(0, numToPlaceInThisLayer).map((rect) => {
                    return {
                        ...rect,
                        id: presentationIdCounter++, 
                        layer: layerIndex, 
                        plateIndex: plateIndex,
                        typeId: rect.typeId,
                        x: rect.x,
                        y: rect.y,
                    };
                });

                plate.layers.push({
                    layerIndexInPlate: layerIndex,
                    rectangles: layerRects
                });

                allPlacedRectangles.push(...layerRects);
                neededRects -= numToPlaceInThisLayer;
            }
            return plate;
        });

        const finalResult = { 
            ...result.result,
            layersUsed: platesNeeded, 
            platesNeeded: platesNeeded, 
            layersPerPlate: layersPerPlate,
            placedInSingleLayerCount: placedPerLayer,
            totalRectanglesCount: totalRectanglesCount,
            rectangles: allPlacedRectangles, 
            plates: finalPlateResults, 
            efficiency: efficiency
        };
      
      dispatch({ type: 'SET_PACKING_RESULT', payload: finalResult });
      return true;
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: { 
        type: 'optimization', 
        message: `Lỗi tối ưu: ${error.message}` 
      }});
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