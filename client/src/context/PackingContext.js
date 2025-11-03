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

  // Helper function: Calculate quantities of each type used in a layer pattern
  const calculatePatternQuantities = (pattern) => {
      return pattern.reduce((acc, rect) => {
          if (rect.typeId) { 
              acc[rect.typeId] = (acc[rect.typeId] || 0) + 1;
          }
          return acc;
      }, {});
  };

  // Helper function: Build the leftoverRects array (gán ID tạm thời cho việc xếp)
  const buildLeftoverRects = (quantitiesToPack, rectTypes, mixedPatternTempIdCounter) => {
      let rects = [];
      // Lọc ra các loại hình vẫn còn số lượng cần xếp
      const sortedTypes = rectTypes.filter(r => quantitiesToPack[r.id] > 0)
                                   .sort((a, b) => (b.width * b.length) - (a.width * a.length));

      for (const rectType of sortedTypes) {
          const quantityLeft = quantitiesToPack[rectType.id] || 0;
          for (let i = 0; i < quantityLeft; i++) {
              rects.push({
                  ...rectType,
                  // ID tạm thời duy nhất cho việc xếp
                  id: `mixed_${mixedPatternTempIdCounter.current++}`, 
                  typeId: rectType.id 
              });
          }
      }
      return rects;
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
      
      // 1. CHUẨN BỊ DỮ LIỆU
      // Map để theo dõi số lượng CẦN XẾP còn lại của mỗi loại
      let quantitiesToPack = allSelectedTypes.reduce((acc, rect) => {
          acc[rect.id] = state.quantities[rect.id];
          return acc;
      }, {});

      const finalPlates = []; // Mảng chứa tất cả các tấm liệu (plates) đã tối ưu
      let plateIdCounter = 0;
      // ID duy nhất cho mỗi hình chữ nhật được hiển thị trên UI, không reset
      let presentationIdCounterRef = { current: 1 }; 
      const layersPerPlate = state.container.layers;

      // =================================================================
      // GIAI ĐOẠN 1: TỐI ƯU CÁC TẤM THUẦN (PURE PLATES - N-LAYER)
      // =================================================================
      
      // Lặp qua TỪNG LOẠI hình chữ nhật
      for (const rectType of allSelectedTypes) {
          const typeId = rectType.id;
          let quantityNeeded = quantitiesToPack[typeId];

          if (quantityNeeded === 0) continue;

          // 1. Tìm pattern 1 lớp tốt nhất cho CHỈ LOẠI NÀY
          const rectsForPatternFinding = [];
          for (let i = 0; i < Math.min(quantityNeeded, 500); i++) { // Lấy tối đa 500 hình để tìm mẫu
              rectsForPatternFinding.push({ 
                  ...rectType, 
                  id: `temp_${typeId}_${i}`, // ID tạm thời
                  typeId: typeId 
              });
          }
          
          // *Gọi API với 1 lớp để tìm ra cách xếp 1 lớp tối ưu nhất (server sẽ xử lý xoay)*
          const patternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 }, 
              rectsForPatternFinding,
              1
          );

          // Lấy kết quả xếp hình trong 1 lớp (chỉ những hình được xếp)
          const singleLayerPattern = patternResult.result.rectangles
              .filter(r => r && r.layer === 0) 
              .map(r => ({ ...r, typeId: r.typeId })); 

          const placedPerLayer = singleLayerPattern.length;

          if (placedPerLayer === 0 && quantityNeeded > 0) {
              dispatch({ 
                type: 'SET_WARNING', 
                payload: { 
                    type: 'optimization', 
                    message: `Không thể xếp loại size ${rectType.name} vào tấm liệu (${state.container.width}x${state.container.length}mm).` 
                } 
              });
              continue; 
          }

          // 2. Tính toán và tạo các tấm thuần N-lớp
          const placedPerPlate = placedPerLayer * layersPerPlate;
          const fullPlatesNeeded = Math.floor(quantityNeeded / placedPerPlate);
          const remainingForPurePlates = quantityNeeded % placedPerPlate;

          if (fullPlatesNeeded > 0) {
              // 3. Tạo các tấm thuần và thêm vào kết quả
              for (let p = 0; p < fullPlatesNeeded; p++) {
                  const plate = {
                      plateIndex: plateIdCounter++,
                      layers: [],
                      description: `Tấm thuần Size ${rectType.name}`,
                      type: "pure"
                  };

                  for (let l = 0; l < layersPerPlate; l++) {
                      const layerRects = singleLayerPattern.map(rect => ({
                          ...rect,
                          id: presentationIdCounterRef.current++, // ID duy nhất
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

              // 4. Cập nhật số lượng còn lại
              quantitiesToPack[typeId] = remainingForPurePlates;
          }
      }

      // =================================================================
      // GIAI ĐOẠN 2: TỐI ƯU CÁC TẤM HỖN HỢP (MIXED PLATES)
      // Tìm 1 mẫu tối ưu nhất, tính số lần lặp lại, và nhân lên số lớp.
      // =================================================================
      
      let mixedPatternTempIdCounter = { current: 1 }; 
      let currentLeftoverRects = buildLeftoverRects(quantitiesToPack, allSelectedTypes, mixedPatternTempIdCounter);

      while (currentLeftoverRects.length > 0) {
          
          // A. CHỌN MẪU XẾP 1 LỚP TỐI ƯU CHO HỖN HỢP CÒN LẠI
          // Sử dụng một tập con của leftoverRects để tìm mẫu tối ưu (giảm tải cho server)
          const subsetForPatternFinding = currentLeftoverRects.slice(0, 500); 

          // 1. Gọi API để tìm MẪU LỚP TỐI ƯU (1 lớp)
          const mixedPatternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 },
              subsetForPatternFinding, 
              1
          );

          // Chỉ lấy các hình đã được đặt (đây là MẪU LỚP)
          const bestMixedLayerPattern = mixedPatternResult.result.rectangles
              .filter(r => r && r.layer === 0);

          if (bestMixedLayerPattern.length === 0) {
              // Vẫn còn leftoverRects nhưng không thể xếp thêm bất kỳ hình nào
              dispatch({ 
                  type: 'SET_WARNING', 
                  payload: { 
                      type: 'optimization', 
                      message: `Không thể xếp được ${currentLeftoverRects.length} hình (leftovers) vào tấm liệu có kích thước ${state.container.width}x${state.container.length}mm.` 
                  } 
              });
              break; // Dừng vòng lặp ngoài
          }

          // B. TÍNH TOÁN SỐ LỚP CÓ THỂ LẶP LẠI (TỐI ĐA layersPerPlate)
          const patternQuantitiesUsed = calculatePatternQuantities(bestMixedLayerPattern);
          let maxLayersToRepeat = layersPerPlate;
          let patternDescription = []; 

          // Kiểm tra và tính toán giới hạn số lớp dựa trên kho hàng (quantitiesToPack)
          for (const typeId in patternQuantitiesUsed) {
              const patternCount = patternQuantitiesUsed[typeId];
              const inventoryCount = quantitiesToPack[Number(typeId)] || 0;
              
              const rectTypeDetails = allSelectedTypes.find(r => r.id === Number(typeId));
              if (rectTypeDetails) {
                 patternDescription.push(`${patternCount}x ${rectTypeDetails.name}`);
              }

              if (inventoryCount < patternCount) {
                  maxLayersToRepeat = 0; 
                  break; 
              }

              const maxLayersForThisType = Math.floor(inventoryCount / patternCount);
              maxLayersToRepeat = Math.min(maxLayersToRepeat, maxLayersForThisType);
          }

          // Cap số lớp lặp lại ở số lớp tối đa cho phép của tấm liệu
          maxLayersToRepeat = Math.min(maxLayersToRepeat, layersPerPlate);

          if (maxLayersToRepeat > 0) {
              // C. XÂY DỰNG TẤM HỖN HỢP (LẶP LẠI MẪU)
              const mixedPlate = {
                  plateIndex: plateIdCounter++,
                  layers: [],
                  description: `Tấm hỗn hợp (${maxLayersToRepeat}/${layersPerPlate} lớp | Mẫu: ${patternDescription.join(', ')})`,
                  type: "mixed"
              };
              
              for (let l = 0; l < maxLayersToRepeat; l++) {
                  // Tạo bản sao của mẫu lớp, gán ID duy nhất và cập nhật layer index
                  const layerRects = bestMixedLayerPattern.map(rect => ({
                      ...rect,
                      id: presentationIdCounterRef.current++, // ID duy nhất cho việc hiển thị
                      layer: l,
                      plateIndex: mixedPlate.plateIndex,
                      typeId: rect.typeId
                  }));
                  mixedPlate.layers.push({
                      layerIndexInPlate: l,
                      rectangles: layerRects
                  });
              }
              
              // D. CẬP NHẬT KHO HÀNG CÒN LẠI (quantitiesToPack)
              for (const typeId in patternQuantitiesUsed) {
                  const quantityUsedInLayer = patternQuantitiesUsed[typeId];
                  // Trừ đi tổng số hình đã sử dụng (số hình trong mẫu * số lớp lặp lại)
                  quantitiesToPack[Number(typeId)] -= quantityUsedInLayer * maxLayersToRepeat;
              }
              
              finalPlates.push(mixedPlate);
              
              // Chuẩn bị cho vòng lặp tiếp theo
              mixedPatternTempIdCounter.current = 1; // Reset temp ID counter
              currentLeftoverRects = buildLeftoverRects(quantitiesToPack, allSelectedTypes, mixedPatternTempIdCounter);

          } else {
              // Nếu không thể tạo thêm lớp lặp lại nào
              if (currentLeftoverRects.length > 0) {
                dispatch({ 
                    type: 'SET_WARNING', 
                    payload: { 
                        type: 'optimization', 
                        message: `Vẫn còn hình (${currentLeftoverRects.length} tổng cộng) nhưng không đủ để tạo thêm 1 lớp lặp lại theo mẫu tối ưu. Các hình còn lại sẽ bị bỏ qua.`
                    } 
                });
              }
              break; // Dừng vòng lặp ngoài
          } 
      } // End while loop (Mixed Plates)

      // =================================================================
      // GIAI ĐOẠN 3: TỔNG HỢP KẾT QUẢ
      // =================================================================
      const allPlacedRectangles = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequestedCount = allSelectedTypes.reduce((sum, r) => sum + (state.quantities[r.id] || 0), 0);
      
      // Diện tích ban đầu của tất cả hình đã chọn
      const initialTotalArea = allSelectedTypes.reduce((sum, rectType) => {
          const rectCount = state.quantities[rectType.id] || 0;
          return sum + (rectType.width * rectType.length * rectCount);
      }, 0);
      
      // Tổng diện tích tối đa của TẤT CẢ lớp đã sử dụng 
      const totalUsedPlateArea = finalPlates.reduce((sum, plate) => {
          // Chỉ tính diện tích lớp thực tế đã điền
          return sum + (plate.layers.length * state.container.width * state.container.length);
      }, 0);

      const efficiency = totalUsedPlateArea > 0 
              ? (initialTotalArea / totalUsedPlateArea) * 100 
              : 0;

      const placedRectanglesCount = allPlacedRectangles.length;
      
      if (placedRectanglesCount !== totalRequestedCount) {
        const missingCount = totalRequestedCount - placedRectanglesCount;
        dispatch({ 
          type: 'SET_WARNING', 
          payload: { 
            type: 'optimization', 
            message: `Cảnh báo: Chỉ xếp được ${placedRectanglesCount} / ${totalRequestedCount} hình (${missingCount} hình bị thiếu).` 
          } 
        });
      }

      const finalResult = {
          layersUsed: finalPlates.length, // Số lượng tấm liệu cần dùng
          platesNeeded: finalPlates.length,
          layersPerPlate: layersPerPlate,
          totalRectanglesCount: totalRequestedCount,
          placedRectanglesCount: placedRectanglesCount, 
          rectangles: allPlacedRectangles,
          plates: finalPlates, 
          efficiency: efficiency
      };

      dispatch({ type: 'SET_PACKING_RESULT', payload: finalResult });
      return true;

    } catch (error) {
      console.error('Lỗi tối ưu:', error);
      dispatch({ type: 'SET_ERROR', payload: { 
        type: 'optimization', 
        message: `Lỗi trong quá trình tối ưu: ${error.message}` 
      }});
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } }); 
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