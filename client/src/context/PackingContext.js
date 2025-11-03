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

// Reducer 
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

  // Validation
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
      let quantitiesToPack = allSelectedTypes.reduce((acc, rect) => {
          acc[rect.id] = state.quantities[rect.id];
          return acc;
      }, {});

      const finalPlates = []; // Mảng chứa tất cả các tấm liệu (plates) đã tối ưu
      let plateIdCounter = 0;
      let presentationIdCounterRef = { current: 1 }; 
      const layersPerPlate = state.container.layers;

      // =================================================================
      // GIAI ĐOẠN 1: TỐI ƯU CÁC TẤM THUẦN (PURE PLATES - N-LAYER)
      // =================================================================
      
      for (const rectType of allSelectedTypes) {
          const typeId = rectType.id;
          let quantityNeeded = quantitiesToPack[typeId];
          
          if (quantityNeeded === 0) continue;

          // *Gọi API với 1 lớp để tìm ra cách xếp 1 lớp tối ưu nhất (server sẽ xử lý xoay)*
          const rectsForPatternFinding = [];
          for (let i = 0; i < Math.min(quantityNeeded, 500); i++) { 
              rectsForPatternFinding.push({ 
                  ...rectType, 
                  id: `temp_${typeId}_${i}`, 
                  typeId: typeId 
              });
          }
          
          const patternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 }, 
              rectsForPatternFinding,
              1
          );

          const singleLayerPattern = patternResult.result.rectangles
              .filter(r => r && r.layer === 0 && r.x !== undefined)
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

          const placedPerPlate = placedPerLayer * layersPerPlate;
          const fullPlatesNeeded = Math.floor(quantityNeeded / placedPerPlate);
          const remainingForPurePlates = quantityNeeded % placedPerPlate;

          if (fullPlatesNeeded > 0) {
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
                          id: presentationIdCounterRef.current++, 
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

              quantitiesToPack[typeId] = remainingForPurePlates;
          }
      } // Kết thúc Giai đoạn 1

      // =================================================================
      // GIAI ĐOẠN 2: XỬ LÝ HÌNH CÒN LẠI (LEFT
      // Nếu chỉ còn 1 loại size sót lại, vẫn coi nó là tấm thuần.
      // Nếu còn >= 2 loại size sót lại, mới coi là HỖN HỢP.
      // =================================================================
      
      let mixedPatternTempIdCounter = { current: 1 }; 
      let currentLeftoverRects = buildLeftoverRects(quantitiesToPack, allSelectedTypes, mixedPatternTempIdCounter);
      let mixedPlatesCount = 0;
      const MAX_MIXED_PLATES = 50; 

      while (currentLeftoverRects.length > 0 && mixedPlatesCount < MAX_MIXED_PLATES) {
          
          const distinctTypesInLeftover = [...new Set(currentLeftoverRects.map(r => r.typeId))];
          
          // --- BƯỚC MỚI VÀ QUAN TRỌNG: XỬ LÝ TRƯỜNG HỢP CÒN LẠI LÀ THUẦN ---
          if (distinctTypesInLeftover.length === 1) {
              // ⚠️ CHỈ CÒN MỘT LOẠI SIZE DUY NHẤT ⚠️
              // Xử lý như Tấm Thuần sót lại và THOÁT khỏi vòng lặp hỗn hợp.
              const rectType = allSelectedTypes.find(r => r.id === distinctTypesInLeftover[0]);
              if (!rectType) break; // Thoát nếu không tìm thấy loại hình (không nên xảy ra)

              // 1. Tìm mẫu 1 lớp tối ưu cho loại còn lại này
              const subsetForPatternFinding = currentLeftoverRects; 
              const patternResult = await packingService.optimizePacking(
                  { ...state.container, layers: 1 }, 
                  subsetForPatternFinding,
                  1
              );
              
              const singleLayerPattern = patternResult.result.rectangles
                  .filter(r => r && r.layer === 0 && r.x !== undefined) 
                  .map(r => ({ ...r, typeId: r.typeId })); 

              const placedPerLayer = singleLayerPattern.length;
              
              if (placedPerLayer > 0) {
                  // 2. Tính toán số tấm CẦN tạo ra để hết số hình còn lại
                  const neededLayersTotal = currentLeftoverRects.length;
                  const finalPlatesNeeded = Math.ceil(neededLayersTotal / placedPerLayer / layersPerPlate);
                  let remainingCount = neededLayersTotal;
                  
                  for (let p = 0; p < finalPlatesNeeded; p++) {
                      const plate = {
                          plateIndex: plateIdCounter++,
                          layers: [],
                          // Vẫn gọi là "pure" vì nó chỉ chứa 1 loại size.
                          description: `Tấm thuần sót lại Size ${rectType.name}`,
                          type: "pure" 
                      };
                      
                      // Số lớp thực tế cần điền trên tấm này
                      const layersToFill = Math.min(layersPerPlate, Math.ceil(remainingCount / placedPerLayer)); 

                      for (let l = 0; l < layersToFill; l++) {
                          const rectsToPlace = Math.min(placedPerLayer, remainingCount);
                          
                          const layerRects = singleLayerPattern.slice(0, rectsToPlace).map(rect => ({
                              ...rect,
                              id: presentationIdCounterRef.current++, 
                              layer: l,
                              plateIndex: plate.plateIndex,
                              typeId: rect.typeId
                          }));
                          plate.layers.push({
                              layerIndexInPlate: l,
                              rectangles: layerRects
                          });
                          remainingCount -= placedPerLayer;
                      }
                      finalPlates.push(plate);
                  }
                  
                  // Đánh dấu tất cả số lượng của loại này là đã dùng
                  quantitiesToPack[rectType.id] = 0;
                  currentLeftoverRects = []; // THOÁT LUÔN VÌ ĐÃ XỬ LÝ HẾT LOẠI DUY NHẤT CÒN LẠI
                  break; 

              } else {
                  // Không thể xếp được hình còn lại
                  quantitiesToPack[rectType.id] = 0;
                  currentLeftoverRects = [];
                  break;
              }
          } 


          // A. CHỌN MẪU XẾP 1 LỚP TỐI ƯU CHO HỖN HỢP CÒN LẠI
          const subsetForPatternFinding = currentLeftoverRects.slice(0, 500); 

          const mixedPatternResult = await packingService.optimizePacking(
              { ...state.container, layers: 1 },
              subsetForPatternFinding, 
              1
          );

          const bestMixedLayerPattern = mixedPatternResult.result.rectangles
              .filter(r => r && r.layer === 0 && r.x !== undefined); 

          if (bestMixedLayerPattern.length === 0) {
              break; 
          }

          // B. TÍNH TOÁN SỐ LỚP CÓ THỂ LẶP LẠI VÀ MÔ TẢ
          const patternQuantitiesUsed = calculatePatternQuantities(bestMixedLayerPattern);
          let maxLayersToRepeat = layersPerPlate;
          let patternDescription = []; 

          for (const typeId in patternQuantitiesUsed) {
              const patternCount = patternQuantitiesUsed[typeId];
              const inventoryCount = quantitiesToPack[Number(typeId)] || 0;
              
              const rectTypeDetails = allSelectedTypes.find(r => r.id === Number(typeId));
              if (rectTypeDetails) {
                 patternDescription.push(`${patternCount}x ${rectTypeDetails.name.split(' ')[0].replace('#', '')}#`);
              }

              const maxLayersForThisType = Math.floor(inventoryCount / patternCount);
              maxLayersToRepeat = Math.min(maxLayersToRepeat, maxLayersForThisType);
          }

          maxLayersToRepeat = Math.min(maxLayersToRepeat, layersPerPlate);

          if (maxLayersToRepeat > 0) {
              // C. XÂY DỰNG TẤM HỖN HỢP (LẶP LẠI MẪU)
              const mixedPlate = {
                  plateIndex: plateIdCounter++,
                  layers: [],
                  description: `Tấm hỗn hợp (${maxLayersToRepeat}/${layersPerPlate} lớp | Mẫu: ${patternDescription.join(', ')})`,
                  type: "mixed" // Phân loại là hỗn hợp
              };
              
              for (let l = 0; l < maxLayersToRepeat; l++) {
                  const layerRects = bestMixedLayerPattern.map(rect => ({
                      ...rect,
                      id: presentationIdCounterRef.current++, 
                      layer: l,
                      plateIndex: mixedPlate.plateIndex,
                      typeId: rect.typeId,
                  }));
                  mixedPlate.layers.push({
                      layerIndexInPlate: l,
                      rectangles: layerRects
                  });
              }
              
              // D. CẬP NHẬT KHO HÀNG CÒN LẠI
              for (const typeId in patternQuantitiesUsed) {
                  const quantityUsedInLayer = patternQuantitiesUsed[typeId];
                  quantitiesToPack[Number(typeId)] -= quantityUsedInLayer * maxLayersToRepeat;
              }
              
              finalPlates.push(mixedPlate);
              mixedPlatesCount++;
              
              // Chuẩn bị cho vòng lặp tiếp theo
              mixedPatternTempIdCounter.current = 1; 
              currentLeftoverRects = buildLeftoverRects(quantitiesToPack, allSelectedTypes, mixedPatternTempIdCounter);

          } else {
              // TERMINATION CONDITION 2: Mẫu được tìm thấy nhưng không đủ hàng tồn kho để lặp lại
              break; 
          }
      } // End while loop (Mixed Plates)

      // =================================================================
      // GIAI ĐOẠN 3: TỔNG HỢP KẾT QUẢ
      // =================================================================
      const allPlacedRectangles = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
  const totalRequestedCount = allSelectedTypes.reduce((sum, r) => sum + (state.quantities[r.id] || 0), 0);
  
  // Tổng diện tích tối đa của TẤT CẢ lớp đã sử dụng 
  const totalUsedPlateArea = finalPlates.reduce((sum, plate) => {
      // Chỉ tính diện tích lớp thực tế đã điền
      return sum + (plate.layers.length * state.container.width * state.container.length);
  }, 0);
  
  // Tổng diện tích các hình đã xếp
  const totalPlacedArea = allPlacedRectangles.reduce((sum, rect) => sum + (rect.width * rect.length), 0);

  const efficiency = totalUsedPlateArea > 0 
          ? (totalPlacedArea / totalUsedPlateArea) * 100 
          : 0;

  const placedRectanglesCount = allPlacedRectangles.length;
  const missingCount = totalRequestedCount - placedRectanglesCount; 
  
  if (placedRectanglesCount !== totalRequestedCount) {
    dispatch({ 
      type: 'SET_WARNING', 
      payload: { 
        type: 'optimization', 
        // Cảnh báo chi tiết hơn
        message: `Cảnh báo: Chỉ xếp được ${placedRectanglesCount} / ${totalRequestedCount} hình (${missingCount} hình bị thiếu). Các hình còn lại không đủ tạo thành mẫu hoặc không thể xếp được nữa.` 
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
    // Logic cập nhật không được cung cấp trong reducer, giữ nguyên nếu không cần thiết
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