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
  

  // --- (*** LOGIC TỐI ƯU MỚI: PURE N-LAYER / MIXED N-LAYER ***) ---
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

          // 1. Tạo một mảng chỉ chứa các hình của loại này
          // Gửi MỘT SỐ LƯỢNG LỚN (ví dụ 1000 hoặc số lượng thực tế) để tìm pattern 1 lớp tốt nhất
          // Chúng ta cần đủ số lượng để thuật toán tìm ra cách lấp đầy 1 lớp
          const sampleSize = Math.min(quantityNeeded, 500); // Lấy 500 hình (hoặc ít hơn) để tìm pattern
          const rectsForPatternFinding = [];
          for (let i = 0; i < sampleSize; i++) {
              rectsForPatternFinding.push({ ...rectType, id: `temp_${typeId}_${i}`, typeId: typeId });
          }
          
          // 2. Gọi API để tìm pattern TỐT NHẤT CHO 1 LỚP của CHỈ LOẠI NÀY
          const patternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 }, // Luôn tìm pattern cho 1 lớp
              rectsForPatternFinding,
              1
          );

          const singleLayerPattern = patternResult.result.rectangles
              .filter(r => r && r.layer === 0) // Lọc các hình đã xếp ở lớp 0
              .map(r => ({ ...r, typeId: r.typeId })); // Đảm bảo giữ lại typeId gốc

          const placedPerLayer = singleLayerPattern.length;

          if (placedPerLayer === 0) {
              // Loại này không thể xếp vừa, sẽ được xử lý ở giai đoạn hỗn hợp
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
                      // Thêm thông tin để nhận diện đây là tấm thuần
                      description: `Tấm thuần Size ${rectType.name}` 
                  };

                  for (let l = 0; l < layersPerPlate; l++) {
                      const layerRects = singleLayerPattern.map(rect => ({
                          ...rect,
                          id: presentationIdCounter++,
                          layer: l,
                          plateIndex: plate.plateIndex,
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
          
          // 3. Tìm pattern 1 lớp TỐT NHẤT cho các hình CÒN LẠI
          const mixedResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 },
              leftoverRects, // Gửi tất cả những gì còn lại
              1
          );

          const mixedSingleLayerPattern = mixedResult.result.rectangles
              .filter(r => r && r.layer === 0)
              .map(r => ({ ...r, typeId: r.typeId })); // Giữ typeId

          const placedPerLayerMixed = mixedSingleLayerPattern.length;

          if (placedPerLayerMixed === 0) {
              // Không thể xếp thêm bất cứ hình nào, dừng lại
              break; 
          }

          // 4. Tạo 1 tấm hỗn hợp mới
          const mixedPlate = {
              plateIndex: plateIdCounter++,
              layers: [],
              description: "Tấm hỗn hợp (Leftovers)"
          };

          const layersPerPlate = state.container.layers;
          
          // 5. Lấp đầy các lớp của tấm hỗn hợp này
          for (let l = 0; l < layersPerPlate; l++) {
              if (leftoverRects.length === 0) break; // Dừng nếu hết hình

              // Phải tìm lại pattern cho mỗi lớp, vì số lượng `leftoverRects` đã thay đổi
              // (Đây là cách đơn giản, cách tối ưu hơn là "đóng gói" pattern)
              
              // Đơn giản: Lấy pattern đã tìm (mixedSingleLayerPattern) và xem có bao nhiêu hình 
              // trong pattern đó còn tồn tại trong leftoverRects
              
              const layerRects = [];
              const patternRectsToPlace = [...mixedSingleLayerPattern]; // Bản sao của pattern
              
              for (const patternRect of patternRectsToPlace) {
                  // Tìm một hình trong leftovers có cùng typeId
                  const indexInLeftovers = leftoverRects.findIndex(r => r.typeId === patternRect.typeId);
                  
                  if (indexInLeftovers > -1) {
                      // Tìm thấy, lấy ra khỏi leftovers
                      const rectToAdd = leftoverRects.splice(indexInLeftovers, 1)[0];
                      
                      // Thêm vào lớp này với đúng tọa độ của pattern
                      layerRects.push({
                          ...rectToAdd,
                          ...patternRect, // Ghi đè tọa độ, kích thước, xoay
                          id: presentationIdCounter++,
                          layer: l,
                          plateIndex: mixedPlate.plateIndex
                      });
                  }
                  // Nếu không tìm thấy, bỏ qua hình đó trong pattern cho lớp này
              }

              if (layerRects.length > 0) {
                  mixedPlate.layers.push({
                      layerIndexInPlate: l,
                      rectangles: layerRects
                  });
              } else {
                  // Nếu không thể thêm bất kỳ hình nào (do hết hàng), dừng lấp đầy các lớp
                  break;
              }
              
              // Nếu số lượng còn lại ít hơn số lượng pattern, 
              // chúng ta cần gọi lại API optimizePacking ở vòng lặp while tiếp theo
              // để tìm pattern mới cho số lượng ít ỏi còn lại
              if (leftoverRects.length < placedPerLayerMixed) {
                  break; // Thoát vòng lặp 'layers' để tính toán lại pattern ở vòng 'while'
              }
          }

          if (mixedPlate.layers.length > 0) {
              finalPlates.push(mixedPlate);
          } else if (leftoverRects.length > 0) {
              // Vẫn còn hình nhưng không thể xếp (lỗi)
              console.warn("Không thể xếp các hình còn lại:", leftoverRects);
              break;
          }
      }

      // =================================================================
      // GIAI ĐOẠN 3: TỔNG HỢP KẾT QUẢ
      // =================================================================
      const allPlacedRectangles = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRectanglesCount = allSelectedTypes.reduce((sum, r) => sum + (state.quantities[r.id] || 0), 0);
      const totalRectanglesArea = allSelectedTypes.reduce((sum, r) => sum + (r.width * r.length * (state.quantities[r.id] || 0)), 0);
      
      // Tổng diện tích đã SỬ DỤNG
      const totalUsedPlateArea = finalPlates.length * state.container.width * state.container.length * state.container.layers;
      
      const efficiency = totalUsedPlateArea > 0 
              ? (totalRectanglesArea / totalUsedPlateArea) * 100 
              : 0;

      const finalResult = {
          layersUsed: finalPlates.length, // Số tấm liệu
          platesNeeded: finalPlates.length,
          layersPerPlate: state.container.layers,
          totalRectanglesCount: totalRectanglesCount,
          placedInSingleLayerCount: 0, // Giá trị này không còn ý nghĩa
          rectangles: allPlacedRectangles,
          plates: finalPlates, // Cấu trúc mới
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