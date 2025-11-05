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
      // ĐẢM BẢO MỌI RECTANGLE ĐỀU CÓ ID VÀ TYPEID
      let counter = 1; // Dùng để tạo ID dự phòng
      
      const processedRectangles = action.payload.map(rect => {
        // Nếu rect.id bị thiếu (null hoặc undefined), gán cho nó một số
        const id = rect.id ?? counter++; 
        
        return {
          ...rect,
          id: id,
          // Gán typeId = id nếu typeId cũng bị thiếu
          typeId: rect.typeId ?? id 
        };
      });

      // Tạo số lượng ban đầu dựa trên các ID đã được xử lý
      const initialQuantities = processedRectangles.reduce((acc, rect) => {
        acc[rect.id] = 1; // Bây giờ rect.id chắc chắn tồn tại
        return acc;
      }, {});

      return {
        ...state,
        rectangles: processedRectangles, // Dùng danh sách đã xử lý
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

  // Helper: Tính số lượng từng size trong pattern
  const calculatePatternQuantities = (pattern) =>
    pattern.reduce((acc, rect) => {
      if (rect.typeId != null) acc[rect.typeId] = (acc[rect.typeId] || 0) + 1;
      return acc;
    }, {});

  // Helper: Build rectangles để tối ưu pattern
  const buildRectsForPatternOptimization = (stock, rectTypes, maxSample = 500) => {
    const rects = [];
    let counter = 0;
    
    // Xáo trộn để tránh ưu tiên cố định
    const shuffled = [...rectTypes].sort(() => Math.random() - 0.5);
    
    for (const type of shuffled) {
      const need = stock[type.id] || 0;
      if (need <= 0) continue;
      
      const take = Math.min(need, Math.ceil(maxSample / rectTypes.length));
      for (let i = 0; i < take; i++) {
        rects.push({
          ...type,
          id: `temp_${type.id}_${counter++}`,
          typeId: type.id
        });
      }
    }
    return rects;
  };

  // ------------------------- CORE OPTIMIZATION -------------------------
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

      // Tồn kho ban đầu (dùng Map để dễ dàng cập nhật)
      const stock = new Map(selectedTypes.map(r => [r.id, state.quantities[r.id] || 0]));

      const finalPlates = [];
      let plateIndexCounter = 0;
      let rectPresentationId = 1;

      console.log('=== BẮT ĐẦU TỐI ƯU ===');
      console.log('Tồn kho ban đầu:', Object.fromEntries(stock));

      // ========== GIAI ĐOẠN 1: TẤM THUẦN (FULL LAYERS) ==========
      for (const rectType of selectedTypes) {
        const remainingQty = stock.get(rectType.id) || 0;
        if (remainingQty === 0) continue;

        console.log(`\n--- Xử lý size ${rectType.name} (ID: ${rectType.id}) - Tồn: ${remainingQty} ---`);

        // Tìm pattern 1 lớp tối ưu
        const patternSeed = Array.from({ length: Math.min(remainingQty, 100) }, (_, i) => ({
          ...rectType,
          id: `temp_${rectType.id}_${i}`,
          typeId: rectType.id
        }));

        const patternResult = await packingService.optimizePacking(
          { ...state.container, layers: 1 },
          patternSeed,
          1
        );

        const singleLayerPattern = (patternResult?.result?.rectangles || [])
          .filter(r => r && r.layer === 0 && r.x !== undefined)
          .map(r => ({ ...r, typeId: r.typeId }));

        const perLayer = singleLayerPattern.length;
        console.log(`Pattern 1 lớp: ${perLayer} hình/lớp`);

        if (perLayer === 0) {
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp size ${rectType.name} vào tấm liệu.`
            }
          });
          stock.set(rectType.id, 0);
          continue;
        }

        const perPlate = perLayer * layersPerPlate;
        const fullPlates = Math.floor(remainingQty / perPlate);

        console.log(`Tạo ${fullPlates} tấm thuần (${perPlate} hình/tấm)`);

        // Tạo tấm thuần
        for (let p = 0; p < fullPlates; p++) {
          const plate = {
            plateIndex: plateIndexCounter++,
            type: 'pure',
            description: `Tấm thuần Size ${rectType.name}`,
            layers: []
          };

          for (let l = 0; l < layersPerPlate; l++) {
            const layerRects = singleLayerPattern.map(r => ({
              ...r,
              id: rectPresentationId++,
              layer: l,
              plateIndex: plate.plateIndex,
              typeId: r.typeId,
              x: r.x,
              y: r.y,
              width: r.width,
              length: r.length,
              rotated: r.rotated || false
            }));
            plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
          }
          finalPlates.push(plate);
        }

        // CẬP NHẬT TỒN KHO SAU TẤM THUẦN
        const usedInPure = fullPlates * perPlate;
        const newStock = remainingQty - usedInPure;
        stock.set(rectType.id, newStock);
        console.log(`Đã sắp ${usedInPure} hình, còn lại: ${newStock}`);
      }

      console.log('\n=== GIAI ĐOẠN 2: TẤM HỖN HỢP ===');
      console.log('Tồn kho sau tấm thuần:', Object.fromEntries(stock));

      // ========== GIAI ĐOẠN 2: TẤM HỖN HỢP ==========
      while (true) {
        // Lọc các size còn tồn kho
        const remainingTypes = selectedTypes.filter(t => (stock.get(t.id) || 0) > 0);
        if (remainingTypes.length === 0) {
          console.log('Không còn tồn kho. Dừng Giai đoạn 2.');
          break; // ĐÃ SẮP HẾT
        }

        const totalRemaining = remainingTypes.reduce((sum, t) => sum + (stock.get(t.id) || 0), 0);
        console.log(`\n--- Bắt đầu vòng lặp mới, còn ${totalRemaining} hình (${remainingTypes.length} size) ---`);
        console.log('Tồn kho hiện tại:', Object.fromEntries(stock));

        // 1. TẠO MẪU (PATTERN) 1 LỚP TỐT NHẤT TỪ TỒN KHO CÒN LẠI
        const stockObj = Object.fromEntries(stock);
        // buildRectsForPatternOptimization sẽ lấy MỘT TẬP MẪU từ tồn kho
        const rectsForPattern = buildRectsForPatternOptimization(stockObj, remainingTypes, 500);

        console.log(`Tạo pattern từ ${rectsForPattern.length} hình mẫu...`);

        const patternResult = await packingService.optimizePacking(
          { ...state.container, layers: 1 },
          rectsForPattern,
          1
        );

        const pattern = (patternResult?.result?.rectangles || [])
          .filter(r => r && r.layer === 0 && r.x !== undefined)
          .map(r => ({ ...r, typeId: r.typeId })); // Đảm bảo typeId tồn tại

        // 2. KIỂM TRA PATTERN
        if (pattern.length === 0) {
          console.warn('!!! Không thể tạo pattern 1 lớp từ tồn kho còn lại.');
          // Đây là những hình không thể sắp được nữa
          // Báo warning cho user về số lượng còn lại
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp ${totalRemaining} hình còn lại (các size: ${remainingTypes.map(t => t.name).join(', ')}).`
            }
          });
          // Xóa tồn kho để thoát vòng lặp
          remainingTypes.forEach(t => stock.set(t.id, 0));
          break; // Thoát vòng lặp while(true)
        }

        // 3. TÍNH TOÁN PATTERN VÀ SỐ LẦN LẶP TỐI ĐA (maxRepeat)
        const patternQty = calculatePatternQuantities(pattern);
        console.log('Pattern 1 lớp tìm được:', patternQty);
        if (Object.keys(patternQty).length === 0 && pattern.length > 0) {
            console.error("!!! LỖI NGHIÊM TRỌNG: Đã tạo pattern nhưng không thể đếm số lượng (thiếu typeId). Dừng tối ưu.");
            dispatch({
                type: 'SET_ERROR',
                payload: { type: 'optimization', message: 'Lỗi logic: Pattern được tạo nhưng thiếu typeId.' }
            });
            break; // Dừng vòng lặp while(true)
        }
        let maxRepeat = layersPerPlate; // Bắt đầu với số lớp tối đa của 1 tấm
        for (const [typeIdStr, perLayer] of Object.entries(patternQty)) {
          const typeId = Number(typeIdStr);
          const available = stock.get(typeId) || 0;
          
          if (available === 0 || perLayer === 0) {
              maxRepeat = 0; // Không có sẵn hàng, không thể lặp
              break;
          }
          
          const canRepeat = Math.floor(available / perLayer);
          maxRepeat = Math.min(maxRepeat, canRepeat);
        }

        if (maxRepeat === 0) {
          console.warn('!!! Có pattern nhưng tồn kho không đủ để lặp (maxRepeat = 0). Điều này không nên xảy ra nếu pattern.length > 0.');
          // Đây là một kịch bản lỗi, có thể do logic `calculatePatternQuantities`
          // Tạm thời dừng để tránh vòng lặp vô hạn
          dispatch({ type: 'SET_ERROR', payload: { type: 'optimization', message: 'Lỗi logic: maxRepeat = 0 dù đã có pattern.' }});
          break;
        }

        console.log(`Có thể lặp pattern này ${maxRepeat} lần (tối đa ${layersPerPlate} lớp/tấm)`);

        // 4. TẠO TẤM MỚI VÀ THÊM CÁC LỚP
        
        // Xác định loại tấm (thuần hay hỗn hợp)
        const isPure = Object.keys(patternQty).length === 1;
        const typeName = isPure ? selectedTypes.find(t => t.id === Number(Object.keys(patternQty)[0])).name : 'Hỗn Hợp';

        const patternDesc = Object.entries(patternQty)
          .map(([id, cnt]) => {
            const t = selectedTypes.find(x => x.id === Number(id));
            return `${cnt}x ${t ? t.name : `#${id}`}`;
          })
          .join(', ');

        const plate = {
          plateIndex: plateIndexCounter++,
          type: isPure ? 'pure' : 'mixed', // Gán loại 'pure' nếu chỉ có 1 size
          description: `Tấm ${isPure ? `Thuần (Sót lại) Size ${typeName}` : 'Hỗn Hợp'} (${maxRepeat}/${layersPerPlate} lớp | Mẫu: ${patternDesc})`,
          layers: []
        };

        for (let l = 0; l < maxRepeat; l++) {
          const layerRects = pattern.map(r => ({
            ...r,
            id: rectPresentationId++,
            layer: l, // layer index trong tấm
            plateIndex: plate.plateIndex,
            typeId: r.typeId,
            x: r.x,
            y: r.y,
            width: r.width,
            length: r.length,
            rotated: r.rotated || false
          }));
          plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
        }
        
        finalPlates.push(plate);

        // 5. TRỪ TỒN KHO
        let usedStockDesc = [];
        for (const [typeIdStr, perLayer] of Object.entries(patternQty)) {
          const typeId = Number(typeIdStr);
          const used = perLayer * maxRepeat;
          const newStockVal = (stock.get(typeId) || 0) - used;
          stock.set(typeId, newStockVal);
          usedStockDesc.push(`${used} x ID ${typeId}`);
        }
        console.log(`Đã tạo tấm ${plate.plateIndex} (${maxRepeat} lớp). Đã dùng: [${usedStockDesc.join(', ')}]`);
      
        // Vòng lặp while(true) sẽ tự động lặp lại với tồn kho mới
      }

      // ========== TỔNG KẾT KẾT QUẢ ==========
      console.log('\n=== TỔNG KẾT ===');
      console.log('Tồn kho cuối:', Object.fromEntries(stock));

      const allPlaced = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);
      const placedCount = allPlaced.length;

      const containerArea = state.container.width * state.container.length;
      const usedPlateArea = finalPlates.reduce(
        (sum, plate) => sum + plate.layers.length * containerArea,
        0
      );
      const placedArea = allPlaced.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = usedPlateArea > 0 ? (placedArea / usedPlateArea) * 100 : 0;

      const missing = totalRequested - placedCount;
      if (missing > 0) {
        dispatch({
          type: 'SET_WARNING',
          payload: {
            type: 'optimization',
            message: `Cảnh báo: Chỉ sắp được ${placedCount} / ${totalRequested} hình (${missing} hình bị thiếu).`
          }
        });
      } else {
        console.log(`✓ Đã sắp đủ ${placedCount}/${totalRequested} hình`);
      }

      const result = {
        layersUsed: finalPlates.length,
        platesNeeded: finalPlates.length,
        layersPerPlate: layersPerPlate,
        totalRectanglesCount: totalRequested,
        placedRectanglesCount: placedCount,
        rectangles: allPlaced,
        plates: finalPlates,
        efficiency
      };

      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;
    } catch (error) {
      console.error('Lỗi tối ưu:', error);
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