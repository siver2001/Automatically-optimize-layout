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

// Reducer (Giữ nguyên)
const packingReducer = (state, action) => {
  switch (action.type) {
    case 'SET_CONTAINER':
      return {
        ...state,
        container: { ...state.container, ...action.payload },
        errors: state.errors.filter(e => e.type !== 'container')
      };
      
    case 'SET_RECTANGLES':
      const initialQuantities = action.payload.reduce((acc, rect) => {
          acc[rect.id] = 1; 
          return acc;
      }, {});
      return {
        ...state,
        rectangles: action.payload,
        selectedRectangles: [], 
        quantities: initialQuantities
      };
      
    case 'ADD_RECTANGLE':
      return {
        ...state,
        rectangles: [...state.rectangles, action.payload],
        quantities: { ...state.quantities, [action.payload.id]: 1 },
        selectedRectangles: [...state.selectedRectangles, action.payload.id]
      };
      
    case 'REMOVE_RECTANGLE':
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
        errors: state.errors.filter(e => e.type !== 'optimization' && e.type !== 'rectangles'),
        warnings: [] // Xóa cảnh báo cũ
      };
      
    case 'SET_WARNING':
      // Tránh lặp lại cảnh báo
      if (state.warnings.find(w => w.message === action.payload.message)) return state;
      return {
        ...state,
        warnings: [...state.warnings, action.payload]
      };
      
    case 'UPDATE_OPTIMIZATION_PROGRESS':
      return {
        ...state,
        optimizationProgress: action.payload
      };
      
    case 'SET_ERROR':
      const filteredErrors = state.errors.filter(e => e.type !== action.payload.type);
      return {
        ...state,
        errors: [...filteredErrors, action.payload],
        isOptimizing: false // Dừng tối ưu nếu có lỗi
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

  const getNewRectId = useCallback(() => {
      return Math.max(0, ...state.rectangles.map(r => r.id)) + 1;
  }, [state.rectangles]);

  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  // Validation (Giữ nguyên)
  const validateContainer = () => {
    const { width, length, layers } = state.container;
    const errors = [];
    if (width <= 0) errors.push('Chiều rộng tấm liệu phải lớn hơn 0');
    if (length <= 0) errors.push('Chiều dài tấm liệu phải lớn hơn 0');
    if (layers <= 0) errors.push('Số lớp phải lớn hơn 0');
    if (width > 10000 || length > 10000) errors.push('Kích thước tấm liệu quá lớn (tối đa 10000mm)');
    
    if (errors.length > 0) {
        dispatch({ type: 'SET_ERROR', payload: { type: 'container', message: errors.join('. ') } });
    }
    return errors.length === 0;
  };

  const validateRectangles = () => {
    const totalRectanglesCount = state.rectangles
        .filter(rect => state.selectedRectangles.includes(rect.id))
        .reduce((sum, rect) => sum + (state.quantities[rect.id] || 0), 0);
    
    if (totalRectanglesCount === 0) {
      dispatch({ type: 'SET_ERROR', payload: { type: 'rectangles', message: 'Phải chọn ít nhất một size với số lượng lớn hơn 0' } });
      return false;
    }
    return true;
  };
  

  // --- (*** LOGIC TỐI ƯU : PURE N-LAYER / MIXED N-LAYER ***) ---
  const startOptimization = async () => {
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) {
      return false;
    }
    dispatch({ type: 'START_OPTIMIZATION' });

      try {
      const allSelectedTypes = state.rectangles.filter(
          rect => state.selectedRectangles.includes(rect.id) && (state.quantities[rect.id] || 0) > 0
      );

      // Map để theo dõi số lượng CẦN XẾP còn lại của mỗi loại
      let quantitiesToPack = allSelectedTypes.reduce((acc, rect) => {
          acc[rect.id] = state.quantities[rect.id];
          return acc;
      }, {});

      const finalPlates = []; // Mảng chứa tất cả các tấm liệu (plates) đã tối ưu
      let plateIdCounter = 0;
      let presentationIdCounter = 1; // ID duy nhất cho mỗi hình chữ nhật được hiển thị

      // =================================================================
      // GIAI ĐOẠN 1: TỐI ƯU CÁC TẤM THUẦN (PURE PLATES)
      // =================================================================
      for (const rectType of allSelectedTypes) {
          const typeId = rectType.id;
          const quantityNeeded = quantitiesToPack[typeId];

          if (quantityNeeded === 0) continue;

          // 1. Tạo một mảng chỉ chứa các hình của loại này để tìm pattern 1 lớp tốt nhất.
          const sampleSize = Math.min(quantityNeeded, 500); 
          const rectsForPatternFinding = [];
          for (let i = 0; i < sampleSize; i++) {
              rectsForPatternFinding.push({ ...rectType, id: `temp_${typeId}_${i}`, typeId: typeId });
          }
          
          // 2. Gọi API để tìm pattern TỐT NHẤT CHO 1 LỚP của CHỈ LOẠI NÀY
          const patternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 }, 
              rectsForPatternFinding,
              1
          );

          const singleLayerPattern = patternResult.result.rectangles
              .filter(r => r && r.layer === 0) 
              .map(r => ({ ...r, typeId: r.typeId })); 

          const placedPerLayer = singleLayerPattern.length;

          if (placedPerLayer === 0) {
              continue; 
          }

          // 3. Tính toán số tấm thuần (pure plates)
          const layersPerPlate = state.container.layers;
          const placedPerPlate = placedPerLayer * layersPerPlate;
          const fullPlatesNeeded = Math.floor(quantityNeeded / placedPerPlate);

          if (fullPlatesNeeded > 0) {
              // 4. Tạo các tấm thuần và thêm vào kết quả
              for (let p = 0; p < fullPlatesNeeded; p++) {
                  const plate = {
                      plateIndex: plateIdCounter++,
                      layers: [],
                      description: `Tấm thuần Size ${rectType.name}` 
                  };

                  for (let l = 0; l < layersPerPlate; l++) {
                      const layerRects = singleLayerPattern.map(rect => ({
                          ...rect,
                          id: presentationIdCounter++,
                          layer: l,
                          plateIndex: plate.plateIndex,
                          typeId: rect.typeId
                      }));
                      plate.layers.push({
                          layerIndexInPlate: l,
                          rectangles: layerRects
                      });
                  }
                  finalPlates.push(plate);
              }

              // 5. Cập nhật số lượng còn lại
              quantitiesToPack[typeId] -= fullPlatesNeeded * placedPerPlate;
          }
      }

      // =================================================================
      // GIAI ĐOẠN 2: TỐI ƯU CÁC TẤM HỖN HỢP (MIXED PLATES)
      // Đã tối ưu để ưu tiên lấp đầy diện tích tối đa cho từng lớp
      // =================================================================
      
      // 1. Tạo mảng các hình còn thừa (leftovers)
      let leftoverRects = [];
      let tempMixedId = 1;
      for (const rectType of allSelectedTypes) {
          const quantityLeft = quantitiesToPack[rectType.id];
          for (let i = 0; i < quantityLeft; i++) {
              leftoverRects.push({
                  ...rectType,
                  id: `mixed_${tempMixedId++}`,
                  typeId: rectType.id 
              });
          }
      }

      // 2. Lặp lại việc xếp các tấm hỗn hợp cho đến khi hết
      while (leftoverRects.length > 0) {
          
          let mixedPlateLayers = [];
          // Bản sao của leftoverRects để theo dõi những gì đã được xếp trong tấm hiện tại
          let currentUnpacked = [...leftoverRects]; 
          const layersPerPlate = state.container.layers;
          
          let placedInThisPlateCount = 0;

          // 3. Lấp đầy các lớp của tấm hỗn hợp này
          for (let l = 0; l < layersPerPlate; l++) {
              
              if (currentUnpacked.length === 0) {
                  break; 
              }

              // 3a. Chạy thuật toán tối ưu 2D trên các hình còn lại (currentUnpacked) 
              // để tìm bố cục tốt nhất cho layer hiện tại (ƯU TIÊN DIỆN TÍCH TỐI ĐA).
              const layerOptimizationResult = await packingService.optimizePacking(
                  { ...state.container, layers: 1 },
                  currentUnpacked, 
                  1
              );

              const placedInLayerRaw = layerOptimizationResult.result.rectangles
                  .filter(r => r && r.layer === 0);
              
              if (placedInLayerRaw.length === 0) {
                  // Không thể xếp thêm bất kỳ hình nào vào layer này, dừng lại
                  break; 
              }

              // 3b. Cập nhật kết quả cho layer
              const placedIds = new Set(placedInLayerRaw.map(r => r.id));
              
              const layerRects = placedInLayerRaw.map(rect => {
                  placedInThisPlateCount++;
                  return {    
                      ...rect,         
                      id: presentationIdCounter++, 
                      layer: l,
                      plateIndex: plateIdCounter
                  };
              });

              mixedPlateLayers.push({
                  layerIndexInPlate: l,
                  rectangles: layerRects
              });
              
              // 3c. Cập nhật danh sách các hình còn lại (unpacked) cho vòng lặp layer tiếp theo
              currentUnpacked = currentUnpacked.filter(r => !placedIds.has(r.id));
          }
          
          // 4. Nếu có hình được xếp vào tấm này, thêm nó vào danh sách tấm liệu cuối cùng
          if (mixedPlateLayers.length > 0) {
              const mixedPlate = {
                  plateIndex: plateIdCounter++,
                  layers: mixedPlateLayers,
                  description: placedInThisPlateCount === leftoverRects.length ? 
                      "Tấm hỗn hợp (Cuối cùng)" : 
                      "Tấm hỗn hợp (Leftovers)"
              };
              finalPlates.push(mixedPlate);
              
              // Cập nhật lại leftoverRects cho vòng lặp ngoài: chỉ giữ lại những gì chưa xếp
              leftoverRects = currentUnpacked; 
          } else {
              // Vẫn còn hình trong leftoverRects nhưng không thể xếp vào tấm mới
              if (leftoverRects.length > 0) {
                dispatch({ type: 'SET_WARNING', payload: { type: 'optimization', message: `Không thể xếp được ${leftoverRects.length} hình còn lại. Vui lòng kiểm tra kích thước tấm liệu và các size còn lại.` } });
              }
              break; // Dừng vòng lặp ngoài
          } 
      } // End while loop

      // =================================================================
      // GIAI ĐOẠN 3: TỔNG HỢP KẾT QUẢ
      // =================================================================
      const allPlacedRectangles = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRectanglesCount = allSelectedTypes.reduce((sum, r) => sum + (state.quantities[r.id] || 0), 0);
      
      const initialTotalArea = allSelectedTypes.reduce((sum, rectType) => {
          const rectCount = state.quantities[rectType.id] || 0;
          return sum + (rectType.width * rectType.length * rectCount);
      }, 0);
      
      const totalUsedPlateArea = finalPlates.length * state.container.width * state.container.length * state.container.layers;
      
      const efficiency = totalUsedPlateArea > 0 
              ? (initialTotalArea / totalUsedPlateArea) * 100 
              : 0;

      const placedRectanglesCount = allPlacedRectangles.length;
      
      if (placedRectanglesCount !== totalRectanglesCount) {
        dispatch({ type: 'SET_WARNING', payload: { type: 'optimization', message: `Cảnh báo: Chỉ xếp được ${placedRectanglesCount} / ${totalRectanglesCount} hình chữ nhật. Vui lòng kiểm tra kích thước.` } });
      }

      const finalResult = {
          layersUsed: finalPlates.length, 
          platesNeeded: finalPlates.length,
          layersPerPlate: state.container.layers,
          totalRectanglesCount: totalRectanglesCount,
          placedRectanglesCount: placedRectanglesCount, 
          rectangles: allPlacedRectangles,
          plates: finalPlates, 
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

  // --- Các hàm còn lại giữ nguyên ---
  const clearErrors = () => {
    dispatch({ type: 'CLEAR_ERRORS' });
  };

  const toggleModbus = () => {
    dispatch({ type: 'TOGGLE_MODBUS' });
  };
  
  const addRectangle = (rectangle) => {
    const newId = getNewRectId();
    // Cố định màu cho size tùy chỉnh (dựa trên logic getColorForRectangle của server)
    const defaultColor = '#3498db'; 
    dispatch({ type: 'ADD_RECTANGLE', payload: { 
        ...rectangle, 
        id: newId, 
        color: defaultColor, 
        typeId: newId 
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
  
  const setContainer = (containerData) => {
    dispatch({ type: 'SET_CONTAINER', payload: containerData });
  };
  // --- Hết các hàm giữ nguyên ---

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