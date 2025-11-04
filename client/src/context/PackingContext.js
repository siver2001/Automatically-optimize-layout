/* eslint-disable no-loop-func */
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { packingService } from '../services/packingService.js';


const PackingContext = createContext();

const initialState = {
  // Container settings
  container: { width: 0, length: 0, layers: 1 },

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

// ------------------------- Reducer -------------------------
const packingReducer = (state, action) => {
  switch (action.type) {
    case 'SET_CONTAINER':
      return {
        ...state,
        container: { ...state.container, ...action.payload },
        errors: state.errors.filter(e => e.type !== 'container')
      };

    case 'SET_RECTANGLES': {
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

// ------------------------- Provider -------------------------
export const PackingProvider = ({ children }) => {
  const [state, dispatch] = useReducer(packingReducer, initialState);

  // Load default rectangles once
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

  // -------- Helpers (IDs / Validation) --------
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

  // -------- Helpers (Pattern & Leftovers) --------
  const calculatePatternQuantities = (pattern) =>
    pattern.reduce((acc, rect) => {
      if (rect.typeId != null) acc[rect.typeId] = (acc[rect.typeId] || 0) + 1;
      return acc;
    }, {});

  const buildLeftoverRects = (quantitiesToPack, rectTypes, tempCounterRef) => {
    const rects = [];
    const sortedTypes = rectTypes
      .filter(r => (quantitiesToPack[r.id] || 0) > 0)
      .sort(() => Math.random() - 0.5); // xáo trộn để tránh ưu tiên cố định

    for (const t of sortedTypes) {
      const need = quantitiesToPack[t.id] || 0;
      for (let i = 0; i < need; i++) {
        rects.push({
          ...t,
          id: `mixed_${tempCounterRef.current++}`,
          typeId: t.id
        });
      }
    }
    return rects;
  };

  // ------------------------- Core Optimization -------------------------
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

      // Bản đồ tồn kho cần xếp
      const quantitiesToPack = selectedTypes.reduce((acc, r) => {
        acc[r.id] = state.quantities[r.id];
        return acc;
      }, {});

      const finalPlates = [];
      let plateIndexCounter = 0;
      let rectPresentationId = 1;

      // ========== GIAI ĐOẠN 1: TẤM THUẦN ==========
      for (const rectType of selectedTypes) {
        let remainingQty = quantitiesToPack[rectType.id];
        if (!remainingQty) continue;

        // Tìm pattern 1 lớp tối ưu cho size này (server đã áp dụng xoay cố định & xếp đơn lớp):contentReference[oaicite:4]{index=4}
        const patternSeed = [];
        for (let i = 0; i < Math.min(remainingQty, 500); i++) {
          patternSeed.push({ ...rectType, id: `temp_${rectType.id}_${i}`, typeId: rectType.id });
        }

        const patternResult = await packingService.optimizePacking(
          { ...state.container, layers: 1 },
          patternSeed,
          1
        );

        const singleLayerPattern = (patternResult?.result?.rectangles || [])
          .filter(r => r && r.layer === 0 && r.x !== undefined)
          .map(r => ({ ...r, typeId: r.typeId }));

        const perLayer = singleLayerPattern.length;
        if (perLayer === 0) {
          // Không xếp được size này vào tấm
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể xếp loại size ${rectType.name} vào tấm liệu (${state.container.width}x${state.container.length}mm).`
            }
          });
          continue;
        }

        const perPlate = perLayer * layersPerPlate;
        const fullPlates = Math.floor(remainingQty / perPlate);
        const remainder = remainingQty % perPlate;

        // Sinh các tấm thuần đầy đủ
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
              typeId: r.typeId
            }));
            plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
          }
          finalPlates.push(plate);
        }

        quantitiesToPack[rectType.id] = remainder;
      }

      // ========== GIAI ĐOẠN 2: PHẦN CÒN LẠI ==========
      // Nếu còn 1 size duy nhất => vẫn coi là thuần & xếp nốt.
      // Nếu >= 2 size => hỗn hợp: chọn 1 pattern 1 lớp tối ưu và lặp lại pattern cho nhiều lớp giống nhau (tối đa layersPerPlate & tồn kho):contentReference[oaicite:5]{index=5}.
      let tempCounterRef = { current: 1 };
      let leftovers = buildLeftoverRects(quantitiesToPack, selectedTypes, tempCounterRef);

      const MAX_MIXED = 100; // an toàn
      let mixedCount = 0;

      while (leftovers.length > 0 && mixedCount < MAX_MIXED) {
        const distinctTypeIds = [...new Set(leftovers.map(r => r.typeId))];

        // (2a) Chỉ còn 1 size => xử lý như tấm thuần sót lại
        if (distinctTypeIds.length === 1) {
          const onlyTypeId = distinctTypeIds[0];
          const onlyType = selectedTypes.find(t => t.id === onlyTypeId);
          if (!onlyType) break;

          // pattern 1 lớp cho phần còn lại của size này
          const patternResult = await packingService.optimizePacking(
            { ...state.container, layers: 1 },
            leftovers, // toàn bộ còn lại đều cùng 1 size
            1
          );

          const singleLayerPattern = (patternResult?.result?.rectangles || [])
            .filter(r => r && r.layer === 0 && r.x !== undefined)
            .map(r => ({ ...r, typeId: r.typeId }));

          const perLayer = singleLayerPattern.length;
          if (perLayer === 0) {
            // Không xếp được nữa, thoát
            quantitiesToPack[onlyTypeId] = 0;
            leftovers = [];
            break;
          }

          // Tổng số hình còn lại của size này
          let remain = leftovers.length;
          const platesNeeded = Math.ceil(remain / (perLayer * layersPerPlate));

          for (let p = 0; p < platesNeeded; p++) {
            const plate = {
              plateIndex: plateIndexCounter++,
              type: 'pure',
              description: `Tấm thuần sót lại Size ${onlyType.name}`,
              layers: []
            };

            // Số lớp thực dùng cho tấm này
            const layersToFill = Math.min(layersPerPlate, Math.floor(remain / perLayer) || 1);

            for (let l = 0; l < layersToFill; l++) {
              // Số hình đặt được ở lớp này
              const put = Math.min(perLayer, remain);
              const layerRects = singleLayerPattern.slice(0, put).map(r => ({
                ...r,
                id: rectPresentationId++,
                layer: l,
                plateIndex: plate.plateIndex,
                typeId: r.typeId
              }));
              plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
              remain -= put;
              if (remain <= 0) break;
            }

            finalPlates.push(plate);
            if (remain <= 0) break;
          }

          // Xóa tồn kho size này
          quantitiesToPack[onlyTypeId] = 0;
          leftovers = [];
          break;
        }

        // (2b) HỖN HỢP: chọn pattern 1 lớp tối ưu cho phần leftover (cắt 500 để nhanh)
        // Gom leftovers theo typeId
        const byType = new Map();
        for (const r of leftovers) {
          if (!byType.has(r.typeId)) byType.set(r.typeId, []);
          byType.get(r.typeId).push(r);
        }
        // Lấy round-robin: mỗi vòng nhặt 1 cái từ từng type (ưu tiên 3–5 vòng)
        const mixedSeed = [];
        const ROUNDS = 10; // thử 10 lượt, <=1000 phần tử
        for (let k = 0; k < ROUNDS; k++) {
          for (const [, list] of byType) {
            if (list.length) mixedSeed.push(list.shift());
            if (mixedSeed.length >= 500) break;
          }
          if (mixedSeed.length >= 500) break;
        }
        const mixedPatternResult = await packingService.optimizePacking(
          { ...state.container, layers: 1 },
          mixedSeed,
          1
        );

        const bestMixedLayerPattern = (mixedPatternResult?.result?.rectangles || [])
          .filter(r => r && r.layer === 0 && r.x !== undefined);

        if (bestMixedLayerPattern.length === 0) {
          // Không tạo nổi mẫu hỗn hợp, dừng
          break;
        }

        // Đếm nhu cầu theo type trong pattern
        const patternUse = calculatePatternQuantities(bestMixedLayerPattern);
        let maxRepeat = layersPerPlate;

        // giới hạn theo tồn kho thực tế
        for (const typeIdStr of Object.keys(patternUse)) {
          const typeId = Number(typeIdStr);
          const perLayerNeed = patternUse[typeId];
          const stock = quantitiesToPack[typeId] || 0;
          const canRepeat = Math.floor(stock / perLayerNeed);
          maxRepeat = Math.min(maxRepeat, canRepeat);
        }

        if (maxRepeat <= 0) {
          // Có mẫu nhưng không đủ hàng để lặp 1 lớp => dừng
          break;
        }

        // Mô tả hiển thị mẫu
        const patternDesc = Object.entries(patternUse)
          .map(([id, cnt]) => {
            const t = selectedTypes.find(x => x.id === Number(id));
            return `${cnt}x ${t ? t.name : `#${id}`}`;
          })
          .join(', ');

        // Sinh tấm hỗn hợp
        const mixedPlate = {
          plateIndex: plateIndexCounter++,
          type: 'mixed',
          description: `Tấm hỗn hợp (${maxRepeat}/${layersPerPlate} lớp | Mẫu: ${patternDesc})`,
          layers: []
        };

        for (let l = 0; l < maxRepeat; l++) {
          const layerRects = bestMixedLayerPattern.map(r => ({
            ...r,
            id: rectPresentationId++,
            layer: l,
            plateIndex: mixedPlate.plateIndex,
            typeId: r.typeId
          }));
          mixedPlate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
        }
        finalPlates.push(mixedPlate);
        mixedCount++;
        if (mixedCount > selectedTypes.length * 5) break;

        // Trừ tồn kho theo số lớp lặp
        const placedCountByType = bestMixedLayerPattern.reduce((acc, r) => {
          acc[r.typeId] = (acc[r.typeId] || 0) + 1;
          return acc;
        }, {});
        for (const [typeIdStr, cnt] of Object.entries(placedCountByType)) {
          const typeId = Number(typeIdStr);
          quantitiesToPack[typeId] = Math.max(0, (quantitiesToPack[typeId] || 0) - cnt * maxRepeat);
        }

        // Xây lại leftovers cho vòng lặp sau
        tempCounterRef.current = 1;
        leftovers = buildLeftoverRects(quantitiesToPack, selectedTypes, tempCounterRef);
      }
      // Sau khi kết thúc hỗn hợp, nếu vẫn còn hàng lẻ thì gom và sắp phần dư
      if (leftovers.length > 0) {
        const remainderDistinct = [...new Set(leftovers.map(r => r.typeId))];
        // Nếu chỉ còn 1 size => tạo tấm sót lại nhỏ
        if (remainderDistinct.length === 1) {
          const onlyTypeId = remainderDistinct[0];
          const onlyType = selectedTypes.find(t => t.id === onlyTypeId);
          const patternResult = await packingService.optimizePacking(
            { ...state.container, layers: 1 },
            leftovers,
            1
          );

          const singleLayerPattern = (patternResult?.result?.rectangles || [])
            .filter(r => r && r.layer === 0 && r.x !== undefined)
            .map(r => ({ ...r, typeId: r.typeId }));

          if (singleLayerPattern.length > 0) {
            const plate = {
              plateIndex: plateIndexCounter++,
              type: 'pure',
              description: `Tấm lẻ Size ${onlyType.name} (phần còn lại)`,
              layers: [{ layerIndexInPlate: 0, rectangles: singleLayerPattern }]
            };
            finalPlates.push(plate);
          }
        } else {
          // Nếu còn nhiều size nhưng ít, tạo 1 tấm hỗn hợp cuối
          const patternResult = await packingService.optimizePacking(
            { ...state.container, layers: 1 },
            leftovers,
            1
          );
          const mixedPattern = (patternResult?.result?.rectangles || [])
            .filter(r => r && r.layer === 0 && r.x !== undefined);

          if (mixedPattern.length > 0) {
            const mixedPlate = {
              plateIndex: plateIndexCounter++,
              type: 'mixed',
              description: `Tấm hỗn hợp (phần dư cuối)`,
              layers: [{ layerIndexInPlate: 0, rectangles: mixedPattern }]
            };
            finalPlates.push(mixedPlate);
          }
        }
      }
      // ========== GIAI ĐOẠN 3: GỘP KẾT QUẢ ==========
      const allPlaced = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);

      // Chỉ tính diện tích của các lớp đã dùng thực tế (mỗi lớp là 1 mặt container):contentReference[oaicite:6]{index=6}
      const usedPlateArea = finalPlates.reduce(
        (sum, plate) => sum + plate.layers.length * state.container.width * state.container.length,
        0
      );
      const placedArea = allPlaced.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = usedPlateArea > 0 ? (placedArea / usedPlateArea) * 100 : 0;

      const placedCount = allPlaced.length;
      const missing = totalRequested - placedCount;
      if (placedCount !== totalRequested) {
        dispatch({
          type: 'SET_WARNING',
          payload: {
            type: 'optimization',
            message: `Cảnh báo: Chỉ xếp được ${placedCount} / ${totalRequested} hình (${missing} hình bị thiếu). Các hình còn lại không đủ tạo thành mẫu hoặc không thể xếp được nữa.`
          }
        });
      }

      const result = {
        layersUsed: finalPlates.length,          // số tấm
        platesNeeded: finalPlates.length,
        layersPerPlate,
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

  // ------------------------- Public API -------------------------
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

  const updateRectangle = (_id, _updates) => {
    // tuỳ nhu cầu mở rộng sau
  };

  const removeRectangle = (id) => dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  const selectRectangle = (id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id });
  const selectAllRectangles = () => dispatch({ type: 'SELECT_ALL_RECTANGLES' });
  const clearSelection = () => dispatch({ type: 'CLEAR_SELECTION' });
  const setContainer = (data) => dispatch({ type: 'SET_CONTAINER', payload: data });

  const value = {
    ...state,
    // setters
    setContainer,
    setQuantity,
    addRectangle,
    updateRectangle,
    removeRectangle,
    selectRectangle,
    selectAllRectangles,
    clearSelection,
    // actions
    startOptimization,
    clearErrors,
    toggleModbus,
    // validators
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
