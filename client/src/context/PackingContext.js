/* eslint-disable no-loop-func */
import React from 'react';
import { packingService } from '../services/packingService.js';

// ============================================================
// ✅ HELPER 1: Tách Giai đoạn 3 - MERGE
// (Hàm này nhận vào 1 danh sách pieces, trả về danh sách đã merge)
// ============================================================
const runMergePhase = (allPlacedPieces) => {
  const mergedRects = [];
  const tolerance = 1.0;

  // Tách các mảnh full (không cần merge)
  const fullPieces = allPlacedPieces.filter(r => r.pairId == null || r.splitDirection === 'none');
  mergedRects.push(...fullPieces);

  // Lấy các mảnh 1/2 (cần merge)
  let halfPieces = allPlacedPieces.filter(r => r.pairId != null && r.splitDirection !== 'none');
  const processedPieces = new Set(); // Đánh dấu các mảnh đã được merge

  // Sắp xếp các mảnh theo Tấm -> Lớp -> Y -> X
  halfPieces.sort((a, b) =>
    a.plateIndex - b.plateIndex ||
    a.layer - b.layer ||
    a.y - b.y ||
    a.x - b.x
  );

  for (let i = 0; i < halfPieces.length; i++) {
    const p1 = halfPieces[i];

    // Nếu mảnh này đã được xử lý (ghép) rồi, bỏ qua
    if (processedPieces.has(p1.id)) continue;

    let foundPair = false;

    // Lấy kích thước gốc từ p1 (quan trọng)
    const originalW = p1.originalWidth;
    const originalL = p1.originalLength;

    // Chỉ tìm các mảnh "hàng xóm" tiềm năng (gần p1)
    for (let j = i + 1; j < halfPieces.length; j++) {
      const p2 = halfPieces[j];

      // Bỏ qua nếu đã xử lý, hoặc khác tấm, khác lớp
      if (processedPieces.has(p2.id)) continue;
      if (p1.plateIndex !== p2.plateIndex || p1.layer !== p2.layer) continue;

      // Bỏ qua nếu không "tương thích" (không cùng loại gốc)
      if (p1.originalTypeId !== p2.originalTypeId) {
        continue;
      }

      let adjacent = false;
      let boundingW = 0;
      let boundingL = 0;
      let minX = 0;
      let minY = 0;

      // --- LOGIC KIỂM TRA KỀ NHAU (GIỮ NGUYÊN) ---
      // 1. p2 nằm BÊN PHẢI p1 (ghép ngang)
      if (Math.abs(p1.y - p2.y) < tolerance &&
        Math.abs((p1.x + p1.width) - p2.x) < tolerance &&
        Math.abs(p1.length - p2.length) < tolerance) { // Phải cùng chiều dài

        adjacent = true;
        minX = p1.x;
        minY = p1.y;
        boundingW = p1.width + p2.width;
        boundingL = p1.length;
      }
      // 2. p1 nằm BÊN PHẢI p2 (ghép ngang)
      else if (Math.abs(p1.y - p2.y) < tolerance &&
        Math.abs((p2.x + p2.width) - p1.x) < tolerance &&
        Math.abs(p1.length - p2.length) < tolerance) { // Phải cùng chiều dài

        adjacent = true;
        minX = p2.x;
        minY = p1.y;
        boundingW = p1.width + p2.width;
        boundingL = p1.length;
      }
      // 3. p2 nằm BÊN DƯỚI p1 (ghép dọc)
      else if (Math.abs(p1.x - p2.x) < tolerance &&
        Math.abs((p1.y + p1.length) - p2.y) < tolerance &&
        Math.abs(p1.width - p2.width) < tolerance) { // Phải cùng chiều rộng

        adjacent = true;
        minX = p1.x;
        minY = p1.y;
        boundingW = p1.width;
        boundingL = p1.length + p2.length;
      }
      // 4. p1 nằm BÊN DƯỚI p2 (ghép dọc)
      else if (Math.abs(p1.x - p2.x) < tolerance &&
        Math.abs((p2.y + p2.length) - p1.y) < tolerance &&
        Math.abs(p1.width - p2.width) < tolerance) { // Phải cùng chiều rộng

        adjacent = true;
        minX = p2.x;
        minY = p2.y;
        boundingW = p1.width;
        boundingL = p1.length + p2.length;
      }
      // --- KẾT THÚC LOGIC KỀ NHAU ---

      // Nếu không nằm cạnh nhau, bỏ qua
      if (!adjacent) continue;

      // --- Đã tìm thấy hàng xóm, kiểm tra kích thước merge ---
      let mergedRect = null;

      // CASE 1: Bounding khớp kích thước gốc (KHÔNG xoay)
      if (Math.abs(boundingW - originalW) < tolerance &&
        Math.abs(boundingL - originalL) < tolerance) {

        mergedRect = {
          width: originalW,
          length: originalL,
          rotated: false,
        };
      }
      // CASE 2: Bounding khớp kích thước gốc (ĐÃ xoay 90°)
      else if (Math.abs(boundingW - originalL) < tolerance &&
        Math.abs(boundingL - originalW) < tolerance) {

        mergedRect = {
          width: originalL, // Đảo
          length: originalW, // Đảo
          rotated: true,
        };
      }

      // Nếu merge thành công
      if (mergedRect) {
        mergedRects.push({
          ...mergedRect, // width, length, rotated
          id: `merged_${p1.id}_${p2.id}`,
          plateIndex: p1.plateIndex,
          layer: p1.layer,
          x: minX,
          y: minY,
          color: p1.color,
          typeId: p1.originalTypeId,
          originalTypeId: p1.originalTypeId,
          pairId: null, // Đã merge
          mergedFrom: [p1.id, p2.id]
        });
        processedPieces.add(p1.id);
        processedPieces.add(p2.id);
        foundPair = true;
        break; // Thoát vòng lặp 'j' (đã tìm được cặp cho p1)
      }
    } // Kết thúc vòng lặp 'j' (tìm hàng xóm)

    // Nếu p1 không tìm thấy cặp nào (bị mồ côi)
    if (!foundPair && !processedPieces.has(p1.id)) {
      mergedRects.push(p1); // Vẫn thêm mảnh mồ côi vào
      processedPieces.add(p1.id);
    }
  }
  return mergedRects;
};


// ============================================================
// ✅ HELPER 2: Tách Giai đoạn 4 - REBUILD
// (Hàm này nhận mergedRects, trả về finalPlates mới)
// ============================================================
const runRebuildPhase = (mergedRects, originalPlates, displayIdStart) => {
  const newFinalPlates = [];
  const plateMap = new Map();
  let displayIdCounter = displayIdStart;

  // Lấy thông tin metadata của các tấm gốc (originalPlates)
  // để giữ lại 'description' khi Rebuild
  const originalPlateMeta = new Map();
  originalPlates.forEach(p => {
    originalPlateMeta.set(p.plateIndex, {
      description: p.description,
      type: p.type,
      patternDescription: p.patternDescription
    });
  });

  mergedRects.sort((a, b) => a.plateIndex - b.plateIndex || a.layer - b.layer);

  for (const rect of mergedRects) {
    // Gán ID hiển thị MỚI chỉ nếu nó là mảnh "thô" (chưa có ID dạng rect_...)
    if (rect.id.startsWith('merged_') || rect.id.startsWith('full_')) {
      rect.id = `rect_${displayIdCounter++}`;
    } else if (rect.pairId && !rect.id.startsWith('rect_half_')) { // Mảnh 1/2 "thô"
      rect.id = `rect_half_${displayIdCounter++}`;
    }
    // Nếu id là 'rect_...' hoặc 'rect_half_...' (từ lần chạy trước) thì giữ nguyên

    if (!plateMap.has(rect.plateIndex)) {
      const originalMeta = originalPlateMeta.get(rect.plateIndex) || {
        description: `Tấm ${rect.plateIndex + 1}`,
        layers: []
      };

      plateMap.set(rect.plateIndex, {
        ...originalMeta, // Giữ lại metadata
        plateIndex: rect.plateIndex,
        layers: new Map()
      });
    }

    const plateData = plateMap.get(rect.plateIndex);

    if (!plateData.layers.has(rect.layer)) {
      plateData.layers.set(rect.layer, {
        layerIndexInPlate: rect.layer,
        rectangles: []
      });
    }

    plateData.layers.get(rect.layer).rectangles.push(rect);
  }

  for (const [, plateData] of plateMap.entries()) {
    const newPlate = {
      ...plateData,
      layers: Array.from(plateData.layers.values()).sort((a, b) => a.layerIndexInPlate - b.layerIndexInPlate)
    };
    newFinalPlates.push(newPlate);
  }

  return newFinalPlates.sort((a, b) => a.plateIndex - b.plateIndex);
};

const PackingContext = React.createContext();

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
  unsplitableRectIds: [],
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
    case 'SET_UNSPLITABLE_IDS':
      return { ...state, unsplitableRectIds: action.payload };
    default:
      return state;
  }
};

export const PackingProvider = ({ children }) => {

  const [state, dispatch] = React.useReducer(packingReducer, initialState);

  React.useEffect(() => {
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

  const getNewRectId = React.useCallback(() => {
    const currentMaxId = Math.max(0, ...state.rectangles.map(r => r.id));
    if (currentMaxId >= nextIdRef.current) {
      nextIdRef.current = currentMaxId + 1;
    }
    const newId = nextIdRef.current;
    nextIdRef.current += 1;
    return newId;
  }, [state.rectangles]);

  const addRectanglesFromExcel = React.useCallback((parsedData) => {
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
  const setQuantity = React.useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  const setUnsplitableRectIds = React.useCallback((ids) => {
    dispatch({ type: 'SET_UNSPLITABLE_IDS', payload: ids });
  }, []);

  const validateContainer = React.useCallback(() => {
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

  const validateRectangles = React.useCallback(() => {
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
  // CONSTANTS
  // ============================================================
  const MIN_SPLIT_WIDTH = 10; // Chiều rộng tối thiểu để chia đôi (mm)
  const MAX_ITERATIONS = 10000; // Số lần lặp tối đa cho mixed plates

  // ============================================================
  // HELPER: Tạo chữ ký pattern để phát hiện tấm trùng lặp
  // ============================================================
  const createPatternSignature = (placed) => {
    const layer0Rects = placed.filter(r => r.layer === 0);

    const sorted = [...layer0Rects].sort((a, b) => {
      if (a.typeId !== b.typeId) return a.typeId - b.typeId;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    return sorted.map(r =>
      `${r.typeId}:${r.x}:${r.y}:${r.width}:${r.length}:${r.rotated ? 1 : 0}`
    ).join('|');
  };

  // ============================================================
  // HELPER: Tạo mixed plate với multi-strategy
  // ============================================================
  const createMixedPlateMultiStrategy = async (pool, layersPerPlate) => {
    if (pool.length === 0) return null;

    const strategies = [
      {
        name: 'Area Descending',
        sort: (a, b) => (b.width * b.length) - (a.width * a.length)
      },
      {
        name: 'Max Dimension',
        sort: (a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length)
      },
      {
        name: 'Perimeter',
        sort: (a, b) => (2 * (b.width + b.length)) - (2 * (a.width + a.length))
      },
      {
        name: 'Aspect Ratio',
        sort: (a, b) => {
          const ratioA = Math.max(a.width, a.length) / Math.min(a.width, a.length);
          const ratioB = Math.max(b.width, b.length) / Math.min(b.width, b.length);
          return (ratioA - ratioB) || (a.pairId || '').localeCompare(b.pairId || '');
        }
      }
    ];

    let bestResult = null;
    let bestArea = 0;

    for (const strategy of strategies) {
      // Clone và sort pool theo chiến thuật mới
      const sortedPool = [...pool].sort(strategy.sort);

      // CHỈ CHẠY CHO 1 LỚP - Logic xếp nhiều lớp sẽ được xử lý ở bên ngoài
      const result = await packingService.optimizePacking(
        { ...state.container, layers: 1 },
        sortedPool,
        1
      );

      const placed = (result?.result?.rectangles || [])
        .filter(r => r && r.x !== undefined)
        .map(r => ({
          ...r,
          typeId: r.typeId,
          originalTypeId: r.originalTypeId,
          pairId: r.pairId,
          pieceIndex: r.pieceIndex,
          splitDirection: r.splitDirection,
          originalWidth: r.originalWidth,
          originalLength: r.originalLength,
          x: r.x,
          y: r.y,
          width: r.width,
          length: r.length,
          layer: r.layer || 0,
          rotated: r.rotated || false,
          color: r.color,
          name: r.name
        }));

      const totalArea = placed.reduce((sum, r) => sum + (r.width * r.length), 0);

      if (totalArea > bestArea) {
        bestArea = totalArea;
        bestResult = placed;
      }
    }

    if (!bestResult || bestResult.length === 0) return null;


    const usedTypeIds = new Set(bestResult.map(r => r.typeId));
    const placedIds = new Set(bestResult.map(r => r.id));

    const typeCount = {};
    bestResult.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });

    return { placed: bestResult, placedIds, usedTypeIds, typeCount };
  };

  // ============================================================
  // MAIN OPTIMIZATION LOGIC
  // ============================================================
  const startOptimization = async () => {
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) return false;

    try {
      dispatch({ type: 'START_OPTIMIZATION' });
      const layersPerPlate = state.container.layers;

      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      let finalPlates = [];
      let plateIndexCounter = 0;

      // ========== GIAI ĐOẠN 1: SPLIT - Tạo Pool (Xử lý dựa trên Strategy) ==========

      let pool = [];
      let poolCounter = 0;

      // Kiểm tra chiến thuật sắp xếp
      if (state.packingStrategy === 'FULL_SIZE') {
        // 🔵 TRƯỜNG HỢP 1: CHIẾN THUẬT SIZE NGUYÊN (FULL_SIZE)
        // Logic: Không bao giờ chia nhỏ, giữ nguyên kích thước gốc
        for (const rectType of selectedTypes) {
          const quantity = state.quantities[rectType.id] || 0;
          if (quantity <= 0) continue;

          for (let i = 0; i < quantity; i++) {
            const fullPiece = {
              ...rectType,
              id: `full_size_${poolCounter++}`, // ID riêng cho chiến thuật này
              typeId: rectType.id,
              originalTypeId: rectType.id,
              pairId: null,           // Không có pairId vì không chia
              pieceIndex: 0,
              splitDirection: 'none', // Đánh dấu không chia
              width: rectType.width,  // Giữ nguyên width
              length: rectType.length,// Giữ nguyên length
              originalWidth: rectType.width,
              originalLength: rectType.length,
              transform: {
                originalWidth: rectType.width,
                originalLength: rectType.length,
                splitAxis: 'none'
              },
              name: rectType.name,
              color: rectType.color
            };
            pool.push(fullPiece);
          }
        }
      } else {
        // 🔴 TRƯỜNG HỢP 2: CHIẾN THUẬT TỐI ƯU DIỆN TÍCH 
        // Logic: Chia đôi chiều rộng nếu đủ lớn 
        for (const rectType of selectedTypes) {
          const quantity = state.quantities[rectType.id] || 0;
          if (quantity <= 0) continue;

          // --- LOGIC MỚI BẮT ĐẦU TỪ ĐÂY ---
          // Kiểm tra xem ID này có nằm trong danh sách cấm chia không
          const isRestricted = state.unsplitableRectIds.includes(rectType.id);

          const halfWidth = rectType.width / 2;
          // Chỉ chia nếu: Không bị cấm VÀ đủ rộng
          const canSplit = !isRestricted && (halfWidth >= MIN_SPLIT_WIDTH);

          for (let i = 0; i < quantity; i++) {
            const pairId = `pair_${rectType.id}_${i}`;

            if (canSplit) {
              const transformMetadata = {
                originalWidth: rectType.width,
                originalLength: rectType.length,
                splitAxis: 'width',               // Chia theo chiều rộng
                pieceWidth: halfWidth,
                pieceLength: rectType.length,
                expectedOrientation: 'horizontal' // Mảnh nằm ngang
              };
              // CHIA ĐÔI theo chiều rộng: 1 rectangle → 2 pieces
              const piece1 = {
                ...rectType,
                id: `half_${poolCounter++}`,
                typeId: rectType.id,
                originalTypeId: rectType.id,
                pairId: pairId,
                pieceIndex: 1,
                splitDirection: 'width',
                width: halfWidth,
                length: rectType.length,
                originalWidth: rectType.width,
                originalLength: rectType.length,
                transform: { ...transformMetadata },
                name: `1/2 ${rectType.name}`,
                color: rectType.color,
              };

              const piece2 = {
                ...rectType,
                id: `half_${poolCounter++}`,
                typeId: rectType.id,
                originalTypeId: rectType.id,
                pairId: pairId,
                pieceIndex: 2,
                splitDirection: 'width',
                width: halfWidth,
                length: rectType.length,
                originalWidth: rectType.width,
                originalLength: rectType.length,
                transform: { ...transformMetadata },
                name: `1/2 ${rectType.name}`,
                color: rectType.color,
              };

              pool.push(piece1, piece2);
            } else {
              // KHÔNG CHIA: Giữ nguyên 1 piece
              const fullPiece = {
                ...rectType,
                id: `full_${poolCounter++}`,
                typeId: rectType.id,
                originalTypeId: rectType.id,
                pairId: null,
                pieceIndex: 0,
                splitDirection: 'none',
                originalWidth: rectType.width,
                originalLength: rectType.length,
                transform: {
                  originalWidth: rectType.width,
                  originalLength: rectType.length,
                  splitAxis: 'none'
                },
                name: rectType.name,
                color: rectType.color
              };

              pool.push(fullPiece);

              dispatch({
                type: 'SET_WARNING',
                payload: {
                  type: 'optimization',
                  message: `Size ${rectType.name} quá hẹp để chia (cần ≥${MIN_SPLIT_WIDTH}mm), giữ nguyên.`
                }
              });
            }
          }
        }
      }
      const initialPoolSize = pool.length;
      // ========== GIAI ĐOẠN 2: PACK - Sắp xếp các pieces ==========

      const mixedPatterns = new Map();
      let mixedPlateCounter = 1;
      let iterationCount = 0;

      while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
        iterationCount++;

        const currentProgress = initialPoolSize > 0
          ? Math.round(((initialPoolSize - pool.length) / initialPoolSize) * 100)
          : 0;

        // Cập nhật tiến độ ra ngoài
        dispatch({ type: 'UPDATE_OPTIMIZATION_PROGRESS', payload: currentProgress });

        // Yield (nhường) một chút thời gian cho UI render lại (tránh bị đơ màn hình)
        await new Promise(resolve => setTimeout(resolve, 0));

        const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
          break;
        }

        const { placed, placedIds, typeCount } = mixedResult;

        // Chuẩn hóa về layer 0 để tạo signature
        const normalizedPlaced = placed.map(r => ({ ...r, layer: 0 }));
        const signature = createPatternSignature(normalizedPlaced);

        if (mixedPatterns.has(signature)) {
          const existingData = mixedPatterns.get(signature);

          // Nếu plate hiện tại đã đủ lớp, "đóng" plate và mở plate mới
          if (existingData.layers.length >= layersPerPlate) {
            finalPlates.push({
              ...existingData.plate,
              layers: existingData.layers
            });

            existingData.plate = {
              plateIndex: plateIndexCounter++,
              type: 'mixed',
              description: `Tấm Hỗn Hợp #${existingData.plate.plateIndex + 1}`,
              patternDescription: existingData.plate.patternDescription,
              layers: []
            };
            existingData.layers = [];
          }

          // LAYER INDEX THEO PLATE/PATTERN (không dùng biến toàn cục)
          const layerIndexInPlate = existingData.layers.length;

          existingData.layers.push({
            layerIndexInPlate,
            rectangles: placed.map(r => ({
              ...r,
              layer: layerIndexInPlate,
              plateIndex: existingData.plate.plateIndex
            }))
          });

          existingData.repetitions++;
        } else {
          // Pattern mới → tạo plate mới và thêm lớp đầu tiên (layerIndex=0)
          const typeDesc = Object.entries(typeCount)
            .map(([id, cnt]) => {
              const t = selectedTypes.find(x => x.id === Number(id));
              return `${cnt}×${t ? t.name : `#${id}`}`;
            }).join(', ');

          const plate = {
            plateIndex: plateIndexCounter++,
            type: 'mixed',
            description: `Tấm Hỗn Hợp #${mixedPlateCounter}`,
            patternDescription: typeDesc,
            layers: []
          };

          const firstLayer = {
            layerIndexInPlate: 0,
            rectangles: placed.map(r => ({
              ...r,
              layer: 0,
              plateIndex: plate.plateIndex
            }))
          };

          plate.layers = [firstLayer];

          mixedPatterns.set(signature, {
            plate,
            layers: [firstLayer],
            repetitions: 1
          });

          mixedPlateCounter++;
        }


        pool = pool.filter(r => !placedIds.has(r.id));
      }
      // Đưa plates vào finalPlates
      for (const [, data] of mixedPatterns.entries()) {
        const { plate, layers } = data;

        plate.description = `Tấm Hỗn Hợp #${plate.plateIndex + 1} (${layers.length} lớp)`;
        plate.layers = layers;
        finalPlates.push(plate);
      }

      if (pool.length > 0 && iterationCount >= MAX_ITERATIONS) {
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp, còn ${pool.length} pieces chưa xếp được.`
          }
        });
      }

      // ========== GIAI ĐOẠN 3: MERGE - Hợp nhất các mảnh đôi với bounding box ==========
      const allPlacedPieces = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));

      let mergedRects;
      // Nếu là FULL_SIZE thì KHÔNG CẦN MERGE (vì đâu có chia)
      if (state.packingStrategy === 'FULL_SIZE') {
        mergedRects = allPlacedPieces;
      } else {
        // Nếu là tối ưu diện tích thì chạy Merge như cũ
        mergedRects = runMergePhase(allPlacedPieces);
      }

      // ========== GIAI ĐOẠN 4: REBUILD - Xây dựng lại plates ==========
      finalPlates = runRebuildPhase(mergedRects, finalPlates, 1);


      // ============================================================
      // ✅ GIAI ĐOẠN 5: CONSOLIDATION - Gộp dùng Smart FFD (NÂNG CẤP CHO SHELF)
      // ============================================================

      // 1. THU THẬP TẤM 1 LỚP
      const singleLayerPlates = finalPlates.filter(p => p.layers.length === 1);
      const platesToRemove = new Set(singleLayerPlates.map(p => p.plateIndex));

      // Chỉ chạy nếu có nhiều hơn 1 tấm 1-lớp để gộp
      if (singleLayerPlates.length > 1) {
        console.log(`[DEBUG CONSOLIDATION] Tìm thấy ${singleLayerPlates.length} tấm 1-lớp để gộp`);

        const checkOverlap = (rect, existingRects, tolerance = 0.1) => {
          for (const existing of existingRects) {
            const overlapX = !(rect.x + rect.width <= existing.x + tolerance ||
              rect.x >= existing.x + existing.width - tolerance);
            const overlapY = !(rect.y + rect.length <= existing.y + tolerance ||
              rect.y >= existing.y + existing.length - tolerance);

            if (overlapX && overlapY) return true;
          }
          return false;
        };

        // ✅ HELPER MỚI: Find Best Position ưu tiên GRID/SHELF
        const findBestPositionSmart = (rect, existingRects, containerWidth, containerLength) => {
          let bestPos = null;
          let bestScore = Infinity;

          // Thử cả 2 hướng (Ưu tiên chiều ngang để tạo shelf)
          const orientations = [
            { w: rect.width, l: rect.length, r: rect.rotated || false },
            { w: rect.length, l: rect.width, r: !(rect.rotated || false) }
          ];

          // Các điểm neo: Góc (0,0) và các góc của hình đã xếp
          const candidates = [{ x: 0, y: 0 }];
          existingRects.forEach(e => {
            candidates.push({ x: e.x + e.width, y: e.y }); // Bên phải (Tạo hàng)
            candidates.push({ x: e.x, y: e.y + e.length }); // Bên dưới (Tạo hàng mới)
            // Không cần góc chéo cho shelf logic
          });

          for (const ori of orientations) {
            const { w, l, r } = ori;
            if (w > containerWidth || l > containerLength) continue;

            for (const p of candidates) {
              // 1. Check biên
              if (p.x + w > containerWidth || p.y + l > containerLength) continue;

              // 2. Check chồng lấn
              const testRect = { x: p.x, y: p.y, width: w, length: l };
              if (checkOverlap(testRect, existingRects)) continue;

              // 3. ✅ TÍNH ĐIỂM (SCORE) - Càng thấp càng tốt
              // Tiêu chí 1: Vị trí Bottom-Left (quan trọng nhất)
              let score = p.y * containerWidth + p.x;

              // Tiêu chí 2: Alignment (Thưởng cực lớn nếu khớp cạnh)
              let aligns = false;
              for (const e of existingRects) {
                // Khớp chiều cao với hình bên trái (Tạo hàng ngang đẹp)
                if (Math.abs(e.x + e.width - p.x) < 0.1 && Math.abs(e.length - l) < 0.1 && Math.abs(e.y - p.y) < 0.1) {
                  score -= 500000; // Thưởng siêu lớn
                  aligns = true;
                }
                // Khớp chiều rộng với hình bên dưới (Tạo cột đẹp)
                if (Math.abs(e.y + e.length - p.y) < 0.1 && Math.abs(e.width - w) < 0.1 && Math.abs(e.x - p.x) < 0.1) {
                  score -= 500000;
                  aligns = true;
                }
              }

              // Tiêu chí 3: Phạt xoay (nếu không align)
              if (!aligns && r !== (rect.rotated || false)) {
                score += 1000;
              }

              if (score < bestScore) {
                bestScore = score;
                bestPos = { x: p.x, y: p.y, width: w, length: l, rotated: r };
              }
            }
          }
          return bestPos;
        };

        // 2. THU THẬP ITEMS
        let allItems = singleLayerPlates.flatMap(p =>
          p.layers[0].rectangles.map(r => ({ ...r }))
        );

        // ✅ CẬP NHẬT SẮP XẾP: Ưu tiên Chiều Cao (Height) để tạo Shelf
        allItems.sort((a, b) => {
          const hA = Math.min(a.width, a.length);
          const hB = Math.min(b.width, b.length);
          if (Math.abs(hB - hA) > 1) return hB - hA; // Ưu tiên hình cao trước

          const wA = Math.max(a.width, a.length);
          const wB = Math.max(b.width, b.length);
          return wB - wA; // Nếu cùng cao, ưu tiên hình rộng
        });

        console.log(`[DEBUG CONSOLIDATION] Tổng cộng ${allItems.length} items, sắp xếp ưu tiên Shelf (Height)`);

        // Lấy các tấm nhiều lớp (không gộp) ra
        const multiLayerPlates = finalPlates.filter(p => !platesToRemove.has(p.plateIndex));

        // 4. ĐÓNG GÓI (Smart First Fit)
        const newConsolidatedPlates = [];
        let newPlateCounter = multiLayerPlates.length;

        for (const item of allItems) {
          let placed = false;

          // Thử xếp vào các "thùng" (tấm) đã có
          for (const bin of newConsolidatedPlates) {
            const targetRects = bin.layers[0].rectangles;

            // Sử dụng hàm Smart mới
            const bestPos = findBestPositionSmart(
              item,
              targetRects,
              state.container.width,
              state.container.length
            );

            if (bestPos) {
              const mergedRect = {
                ...item,
                x: bestPos.x, y: bestPos.y, width: bestPos.width, length: bestPos.length, rotated: bestPos.rotated,
                layer: 0, plateIndex: bin.plateIndex
              };
              targetRects.push(mergedRect);
              placed = true;
              break;
            }
          }

          // Nếu không vừa thùng nào, mở thùng mới
          if (!placed) {
            const newPlateIndex = newPlateCounter++;
            const bestPos = findBestPositionSmart(item, [], state.container.width, state.container.length);

            const newRect = {
              ...item,
              x: bestPos.x, y: bestPos.y, width: bestPos.width, length: bestPos.length, rotated: bestPos.rotated,
              layer: 0, plateIndex: newPlateIndex
            };

            const newBin = {
              plateIndex: newPlateIndex,
              type: 'mixed',
              description: `Tấm Gộp #${newPlateIndex + 1}`,
              layers: [{
                layerIndexInPlate: 0,
                rectangles: [newRect]
              }]
            };
            newConsolidatedPlates.push(newBin);
          }
        }

        // 5. THAY THẾ
        finalPlates = [...multiLayerPlates, ...newConsolidatedPlates];

        // Cập nhật lại description và đánh số lại
        finalPlates.forEach((plate, idx) => {
          plate.plateIndex = idx;
          plate.layers.forEach(layer => {
            layer.rectangles.forEach(rect => {
              rect.plateIndex = idx;
            });
          });
          if (newConsolidatedPlates.find(p => p.plateIndex === idx)) {
            plate.description = `Tấm Gộp #${idx + 1} `;
          }
        });

        dispatch({
          type: 'SET_WARNING',
          payload: {
            type: 'optimization',
            message: `✅ Đã gộp ${singleLayerPlates.length} tấm 1-lớp thành ${newConsolidatedPlates.length} tấm mới (Tiết kiệm ${singleLayerPlates.length - newConsolidatedPlates.length} tấm).`
          }
        });

      } else {
        console.log(`[DEBUG CONSOLIDATION] Chỉ có ${singleLayerPlates.length} tấm 1-lớp, không cần gộp.`);
      }

      // ============================================================
      // ✅ GIAI ĐOẠN 5.5: RE-MERGE (Chạy lại MERGE cho các tấm đã GỘP)
      // ============================================================
      console.log("[DEBUG] Chạy RE-MERGE sau khi gộp...");
      // Lấy TẤT CẢ các piece từ các tấm MỚI (bao gồm cả tấm gộp)
      const piecesToReMerge = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));

      // Chạy lại Giai đoạn 3 (Merge)
      // Biến 'mergedRects' (đang ở scope 'startOptimization') sẽ được cập nhật
      mergedRects = runMergePhase(piecesToReMerge);

      // ============================================================
      // ✅ GIAI ĐOẠN 5.6: RE-REBUILD (Chạy lại REBUILD)
      // ============================================================
      // Chạy lại Giai đoạn 4 (Rebuild), 
      // dùng 'finalPlates' làm metadata, bắt đầu ID lại từ 1 (an toàn)
      finalPlates = runRebuildPhase(mergedRects, finalPlates, 1);

      console.log(`[DEBUG] RE-MERGE hoàn tất. Số tấm cuối cùng: ${finalPlates.length}`);

      // ========== GIAI ĐOẠN 6 : SUMMARY - Tổng kết ==========
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);

      // Đếm số lượng rectangles GỐC đã được place
      let placedOriginalsCount = 0;
      const processedPairs = new Set();

      for (const rect of mergedRects) {
        if (rect.pairId != null) {
          if (!processedPairs.has(rect.pairId)) {
            processedPairs.add(rect.pairId);
            const otherPiece = mergedRects.find(r => r.pairId === rect.pairId && r.id !== rect.id);
            if (otherPiece) {
              placedOriginalsCount += 1;
            } else {
              placedOriginalsCount += 0.5;
            }
          }
        } else {
          placedOriginalsCount += 1;
        }
      }

      const placedCount = Math.round(placedOriginalsCount);


      // Tính efficiency
      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce((sum, plate) => sum + plate.layers.length * containerArea, 0);
      const placedArea = mergedRects.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;


      // Breakdown theo loại

      const placedByType = {};
      for (const rect of mergedRects) { // ✅ Tự động dùng 'mergedRects' mới nhất
        const typeId = rect.originalTypeId || rect.typeId;
        if (rect.pairId != null) {
          placedByType[typeId] = (placedByType[typeId] || 0) + 0.5;
        } else {
          placedByType[typeId] = (placedByType[typeId] || 0) + 1;
        }
      }

      // Cảnh báo nếu còn pieces trong pool
      if (pool.length > 0 || placedCount < totalRequested) {
        const poolByType = {};
        for (const item of pool) {
          const typeId = item.originalTypeId || item.typeId;
          poolByType[typeId] = (poolByType[typeId] || 0) + 0.5;
        }

        const poolDetails = Object.entries(poolByType)
          .filter(([_, cnt]) => cnt > 0)
          .map(([id, cnt]) => {
            const t = selectedTypes.find(x => x.id === Number(id));
            const rectCount = Math.round(cnt * 10) / 10;
            return `${t ? t.name : `#${id}`}: ${rectCount}`;
          }).join(', ');

        if (poolDetails) {
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Chỉ sắp được ${placedCount}/${totalRequested} hình (${((placedCount / totalRequested) * 100).toFixed(1)}%). Còn lại: ${poolDetails}`
            }
          });
        }
      }

      const result = {
        layersUsed: finalPlates.reduce((sum, p) => sum + p.layers.length, 0),
        platesNeeded: finalPlates.length,
        layersPerPlate: layersPerPlate,
        totalRectanglesCount: totalRequested,
        placedRectanglesCount: placedCount,
        rectangles: mergedRects,
        plates: finalPlates,
        efficiency,
        pureCount: 0,
        hybridCount: 0,
        mixedCount: finalPlates.length
      };


      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('Error:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'optimization', message: `Lỗi trong quá trình tối ưu: ${error.message}` }
      });
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } });
      return false;
    }
  };

  const clearErrors = React.useCallback(() => dispatch({ type: 'CLEAR_ERRORS' }), []);
  const toggleModbus = React.useCallback(() => dispatch({ type: 'TOGGLE_MODBUS' }), []);

  const addRectangle = React.useCallback((rectangle) => {
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

  const updateRectangle = React.useCallback((_id, _updates) => { }, []);

  const removeRectangle = React.useCallback((id) => {
    dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  }, []);

  const selectRectangle = React.useCallback((id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id }), []);
  const selectAllRectangles = React.useCallback(() => dispatch({ type: 'SELECT_ALL_RECTANGLES' }), []);
  const clearSelection = React.useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []);
  const setContainer = React.useCallback((data) => dispatch({ type: 'SET_CONTAINER', payload: data }), []);
  const setPackingStrategy = React.useCallback((strategy) => {
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
    setUnsplitableRectIds,
  };

  return <PackingContext.Provider value={value}>{children}</PackingContext.Provider>;
};

export const usePacking = () => {
  const ctx = React.useContext(PackingContext);
  if (!ctx) throw new Error('usePacking must be used within a PackingProvider');
  return ctx;
};