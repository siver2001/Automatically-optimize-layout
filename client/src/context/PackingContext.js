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

  const nextIdRef = React.useRef(Math.max(0, ...initialState.rectangles.map(r => r?.id || 0)) + 1);
  
  const getNewRectId = useCallback(() => {
    const currentMaxId = Math.max(0, ...state.rectangles.map(r => r.id));
    if (currentMaxId >= nextIdRef.current) {
      nextIdRef.current = currentMaxId + 1;
    }
    const newId = nextIdRef.current;
    nextIdRef.current += 1;
    return newId;
  }, [state.rectangles]);

  const setQuantity = useCallback((id, quantity) => {
    dispatch({ type: 'SET_QUANTITY', payload: { id, quantity } });
  }, []);

  const validateContainer = useCallback(() => {
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

  const validateRectangles = useCallback(() => {
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
  // HELPER FUNCTIONS
  // ============================================================
  
  const findPurePatternAdvanced = async (rectType) => {
    const containerArea = state.container.width * state.container.length;
    const rectArea = rectType.width * rectType.length;
    const theoreticalMax = Math.floor(containerArea / rectArea);
    
    const sampleSize = Math.min(Math.max(theoreticalMax * 2, 200), 500);
    
    console.log(`🔍 Testing pattern for ${rectType.name}: ${sampleSize} samples (theoretical max: ${theoreticalMax})`);
    
    const testRects = Array.from({ length: sampleSize }, (_, i) => ({
      ...rectType,
      id: `temp_pure_${rectType.id}_${i}`,
      typeId: rectType.id
    }));

    const result = await packingService.optimizePacking(
      { ...state.container, layers: 1 },
      testRects,
      1
    );

    const pattern = (result?.result?.rectangles || [])
      .filter(r => r && r.layer === 0 && r.x !== undefined)
      .map(r => ({ 
        ...r, 
        typeId: r.typeId,
        x: r.x,
        y: r.y,
        width: r.width,
        length: r.length,
        rotated: r.rotated || false,
        color: r.color
      }));

    const perLayer = pattern.length;
    const usedArea = pattern.reduce((sum, r) => sum + (r.width * r.length), 0);
    const calculatedEfficiency = containerArea > 0 ? (usedArea / containerArea) * 100 : 0;
    const wasteRatio = (containerArea - usedArea) / containerArea;
    const packingDensity = theoreticalMax > 0 ? perLayer / theoreticalMax : 0;

    console.log(`   ✓ Pattern found: ${perLayer} rects/layer, efficiency: ${calculatedEfficiency.toFixed(1)}%, density: ${(packingDensity * 100).toFixed(1)}%`);

    return { 
      pattern, 
      perLayer, 
      efficiency: calculatedEfficiency, 
      usedArea, 
      totalArea: containerArea,
      wasteRatio,
      packingDensity,
      theoreticalMax
    };
  };

  const calculateDynamicThreshold = (rectType, patternData, allTypes) => {
    const { packingDensity } = patternData;
    
    let threshold = 85;
    
    const aspectRatio = Math.min(rectType.width, rectType.length) / 
                       Math.max(rectType.width, rectType.length);
    if (aspectRatio < 0.5) {
      threshold -= 5;
    } else if (aspectRatio > 0.9) {
      threshold += 3;
    }
    
    const smallerSizes = allTypes.filter(t => 
      t.id !== rectType.id && 
      t.width * t.length < rectType.width * rectType.length * 0.3
    );
    
    if (allTypes.length <= 2) {
      threshold -= 10;
    } else if (smallerSizes.length >= 3) {
      threshold += 5;
    }
    
    if (packingDensity > 0.8) {
      threshold -= 5;
    } else if (packingDensity < 0.5) {
      threshold -= 8;
    }
    
    const sizeRatio = (rectType.width * rectType.length) / 
                     (state.container.width * state.container.length);
    if (sizeRatio > 0.3) {
      threshold -= 7;
    }
    
    const finalThreshold = Math.max(70, Math.min(92, threshold));
    
    console.log(`   📊 Dynamic threshold for ${rectType.name}: ${finalThreshold}% (base: 85%, adjustments: aspect=${aspectRatio.toFixed(2)}, sizes=${allTypes.length}, density=${(packingDensity*100).toFixed(1)}%)`);
    
    return finalThreshold;
  };

  const analyzeGaps = (placedRects, container) => {
    const resolution = 5;
    const gridW = Math.ceil(container.width / resolution);
    const gridH = Math.ceil(container.length / resolution);
    const grid = Array(gridH).fill(0).map(() => Array(gridW).fill(0));
    
    for (const rect of placedRects) {
      const x1 = Math.floor(rect.x / resolution);
      const y1 = Math.floor(rect.y / resolution);
      const x2 = Math.ceil((rect.x + rect.width) / resolution);
      const y2 = Math.ceil((rect.y + rect.length) / resolution);
      
      for (let y = Math.max(0, y1); y < Math.min(gridH, y2); y++) {
        for (let x = Math.max(0, x1); x < Math.min(gridW, x2); x++) {
          grid[y][x] = 1;
        }
      }
    }
    
    const gaps = [];
    const visited = new Set();
    
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (grid[y][x] === 0 && !visited.has(`${x},${y}`)) {
          const gap = floodFill(grid, x, y, visited, resolution);
          if (gap.area > 1000) {
            gaps.push(gap);
          }
        }
      }
    }
    
    return gaps.sort((a, b) => b.area - a.area);
  };

  const floodFill = (grid, startX, startY, visited, resolution) => {
    const queue = [[startX, startY]];
    visited.add(`${startX},${startY}`);
    
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;
    let count = 0;
    const gridH = grid.length;
    const gridW = grid[0].length;
    
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      count++;
      
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      
      const neighbors = [[x+1,y], [x-1,y], [x,y+1], [x,y-1]];
      for (const [nx, ny] of neighbors) {
        const key = `${nx},${ny}`;
        if (nx >= 0 && ny >= 0 && 
            ny < gridH && nx < gridW &&
            grid[ny][nx] === 0 && !visited.has(key)) {
          visited.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    
    return {
      x: minX * resolution,
      y: minY * resolution,
      width: (maxX - minX + 1) * resolution,
      length: (maxY - minY + 1) * resolution,
      area: count * resolution * resolution,
      cellCount: count
    };
  };

  // ============================================================
  // NÂNG CẤP MỚI: SMART SPLITTING FUNCTIONS
  // ============================================================
  
  const MIN_SPLIT_WIDTH = 10;
  
  const findSplittableSizes = (stock, gaps, selectedTypes) => {
    const candidates = [];
    
    for (const [typeId, qty] of stock.entries()) {
      if (qty === 0) continue;
      
      const rectType = selectedTypes.find(t => t.id === typeId);
      if (!rectType) continue;
      
      const halfWidth = rectType.width / 2;
      const halfLength = rectType.length / 2;
      
      if (halfWidth < MIN_SPLIT_WIDTH && halfLength < MIN_SPLIT_WIDTH) {
        continue;
      }
      
      let score = 0;
      let fitCountWidth = 0;
      let fitCountLength = 0;
      
      for (const gap of gaps) {
        if (halfWidth >= MIN_SPLIT_WIDTH) {
          if (halfWidth <= gap.width && rectType.length <= gap.length) {
            const fitRatio = (halfWidth * rectType.length) / gap.area;
            score += fitRatio * 10;
            fitCountWidth++;
          }
          if (rectType.length <= gap.width && halfWidth <= gap.length) {
            const fitRatio = (halfWidth * rectType.length) / gap.area;
            score += fitRatio * 9.5;
            fitCountWidth++;
          }
        }
        
        if (halfLength >= MIN_SPLIT_WIDTH) {
          if (rectType.width <= gap.width && halfLength <= gap.length) {
            const fitRatio = (rectType.width * halfLength) / gap.area;
            score += fitRatio * 10;
            fitCountLength++;
          }
          if (halfLength <= gap.width && rectType.width <= gap.length) {
            const fitRatio = (rectType.width * halfLength) / gap.area;
            score += fitRatio * 9.5;
            fitCountLength++;
          }
        }
      }
      
      if (score > 0) {
        const preferSplitDirection = fitCountWidth >= fitCountLength ? 'width' : 'length';
        const halfDim = preferSplitDirection === 'width' ? halfWidth : halfLength;
        
        candidates.push({
          typeId,
          rectType,
          score,
          availableQty: qty,
          splitDirection: preferSplitDirection,
          halfDim,
          fitCount: Math.max(fitCountWidth, fitCountLength)
        });
      }
    }
    
    return candidates.sort((a, b) => b.score - a.score);
  };

  const trySplitAndFill = async (purePlate, splitCandidate, stock, layersPerPlate) => {
    const { typeId, rectType, splitDirection, halfDim } = splitCandidate;
    
    const maxSplit = Math.min(stock.get(typeId), 30);
    
    console.log(`   🔧 Trying to split ${rectType.name} (${splitDirection}): ${maxSplit} items available`);
    
    const splitPool = [];
    for (let i = 0; i < maxSplit; i++) {
      const split1 = { ...rectType, id: `split_${typeId}_${i}_1`, typeId };
      const split2 = { ...rectType, id: `split_${typeId}_${i}_2`, typeId };
      
      if (splitDirection === 'width') {
        split1.width = halfDim;
        split2.width = halfDim;
      } else {
        split1.length = halfDim;
        split2.length = halfDim;
      }
      
      splitPool.push(split1, split2);
    }
    
    const existingRects = purePlate.layers.flatMap(l => l.rectangles);
    const combinedRects = [...existingRects, ...splitPool];
    
    const result = await packingService.optimizePacking(
      { ...state.container, layers: layersPerPlate },
      combinedRects,
      layersPerPlate
    );
    
    const placed = (result?.result?.rectangles || []).filter(r => r && r.x !== undefined);
    const originalIds = new Set(existingRects.map(r => r.id));
    const newlyPlaced = placed.filter(r => !originalIds.has(r.id));
    
    if (newlyPlaced.length === 0) {
      console.log(`   ✗ Split failed: No new rectangles placed`);
      return null;
    }
    
    const totalArea = state.container.width * state.container.length * layersPerPlate;
    const usedArea = placed.reduce((s, r) => s + r.width * r.length, 0);
    const newEfficiency = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;
    
    const usedOriginals = Math.ceil(newlyPlaced.length / 2);
    
    console.log(`   ✓ Split successful: ${newlyPlaced.length} split pieces placed, efficiency: ${newEfficiency.toFixed(1)}%`);
    
    const layerMap = new Map();
    placed.forEach(r => {
      if (!layerMap.has(r.layer)) {
        layerMap.set(r.layer, []);
      }
      layerMap.get(r.layer).push(r);
    });
    
    const newLayers = Array.from(layerMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([layerIdx, rects]) => ({
        layerIndexInPlate: layerIdx,
        rectangles: rects
      }));
    
    return {
      plate: {
        ...purePlate,
        layers: newLayers,
        type: 'hybrid',
        description: `Tấm Lai (Split ${rectType.name})`
      },
      newEfficiency,
      usedTypes: { [typeId]: usedOriginals },
      splitInfo: {
        typeId,
        direction: splitDirection,
        count: usedOriginals
      }
    };
  };

  const fillWithExistingStock = async (purePlate, availableTypes, stock, layersPerPlate) => {
    const existingRects = purePlate.layers.flatMap(layer => layer.rectangles);
    const gaps = analyzeGaps(existingRects, state.container);
    
    if (gaps.length === 0) {
      return null;
    }
    
    console.log(`   🔍 Found ${gaps.length} gaps for filling`);
    
    const candidates = [];
    
    for (const type of availableTypes) {
      if (type.id === purePlate.primaryTypeId) continue;
      
      const availableQty = stock.get(type.id) || 0;
      if (availableQty <= 0) continue;
      
      let score = 0;
      let fitCount = 0;
      
      for (const gap of gaps) {
        if (type.width <= gap.width && type.length <= gap.length) {
          const rectArea = type.width * type.length;
          const fitRatio = rectArea / gap.area;
          fitCount++;
          score += fitRatio;
        }
        
        if (type.length <= gap.width && type.width <= gap.length) {
          const rectArea = type.width * type.length;
          const fitRatio = rectArea / gap.area;
          fitCount++;
          score += fitRatio * 0.95;
        }
      }
      
      if (fitCount > 0) {
        const rectArea = type.width * type.length;
        const priority = score / rectArea * 1000;
        
        candidates.push({
          type,
          score,
          fitCount,
          priority,
          availableQty
        });
      }
    }
    
    candidates.sort((a, b) => b.priority - a.priority);
    
    if (candidates.length === 0) {
      return null;
    }
    
    const fillPool = [];
    let poolId = 0;
    const MAX_FILL_POOL_SIZE = 100;
    let remainingSlots = MAX_FILL_POOL_SIZE;
    
    for (const candidate of candidates) {
      if (remainingSlots <= 0) break;
      
      const slotsForThis = Math.min(
        Math.ceil(candidate.priority * 0.5),
        candidate.availableQty,
        remainingSlots
      );
      
      for (let i = 0; i < slotsForThis; i++) {
        fillPool.push({
          ...candidate.type,
          id: `fill_${candidate.type.id}_${poolId++}`,
          typeId: candidate.type.id
        });
      }
      
      remainingSlots -= slotsForThis;
    }
    
    if (fillPool.length === 0) return null;
    
    const combinedRects = [...existingRects, ...fillPool];
    
    const result = await packingService.optimizePacking(
      { ...state.container, layers: layersPerPlate },
      combinedRects,
      layersPerPlate
    );

    const placed = (result?.result?.rectangles || []).filter(r => r && r.x !== undefined);
    const originalIds = new Set(existingRects.map(r => r.id));
    const newlyPlaced = placed.filter(r => !originalIds.has(r.id));

    if (newlyPlaced.length === 0) {
      return null;
    }

    const usedTypeIds = new Set(newlyPlaced.map(r => r.typeId));
    const typeCount = {};
    newlyPlaced.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });

    const totalArea = state.container.width * state.container.length * layersPerPlate;
    const usedArea = placed.reduce((s, r) => s + r.width * r.length, 0);
    const newEfficiency = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;

    const layerMap = new Map();
    placed.forEach(r => {
      if (!layerMap.has(r.layer)) {
        layerMap.set(r.layer, []);
      }
      layerMap.get(r.layer).push(r);
    });

    const newLayers = Array.from(layerMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([layerIdx, rects]) => ({
        layerIndexInPlate: layerIdx,
        rectangles: rects
      }));

    console.log(`   ✓ Fill successful: ${newlyPlaced.length} items added, efficiency: ${newEfficiency.toFixed(1)}%`);

    return {
      plate: {
        ...purePlate,
        layers: newLayers,
        type: 'hybrid'
      },
      newEfficiency,
      usedTypes: typeCount,
      usedTypeIds
    };
  };

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
          return ratioA - ratioB;
        }
      }
    ];

    let bestResult = null;
    let bestArea = 0;
    let bestStrategyName = '';

    for (const strategy of strategies) {
      const sortedPool = [...pool].sort(strategy.sort);

      const result = await packingService.optimizePacking(
        { ...state.container, layers: layersPerPlate },
        sortedPool,
        layersPerPlate
      );

      const placed = (result?.result?.rectangles || [])
        .filter(r => r && r.x !== undefined)
        .map(r => ({
          ...r,
          typeId: r.typeId,
          x: r.x,
          y: r.y,
          width: r.width,
          length: r.length,
          layer: r.layer || 0,
          rotated: r.rotated || false,
          color: r.color
        }));

      const totalArea = placed.reduce((sum, r) => sum + (r.width * r.length), 0);

      if (totalArea > bestArea) {
        bestArea = totalArea;
        bestResult = placed;
        bestStrategyName = strategy.name;
      }
    }

    if (!bestResult || bestResult.length === 0) return null;

    console.log(`   ✓ Best strategy: ${bestStrategyName}, placed: ${bestResult.length} items, area: ${bestArea.toFixed(0)}mm²`);

    const usedTypeIds = new Set(bestResult.map(r => r.typeId));
    const placedIds = new Set(bestResult.map(r => r.id));

    const typeCount = {};
    bestResult.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });

    return { placed: bestResult, placedIds, usedTypeIds, typeCount };
  };

  // ============================================================
  // THUẬT TOÁN CHÍNH - NÂNG CẤP HOÀN CHỈNH
  // ============================================================
  
  const startOptimization = async () => {
    dispatch({ type: 'CLEAR_ERRORS' });
    if (!validateContainer() || !validateRectangles()) return false;
    
    console.log('\n🚀 ========== BẮT ĐẦU TỐI ƯU NÂNG CẤP (V2.0) ==========\n');

    try {
      dispatch({ type: 'START_OPTIMIZATION' });
      const layersPerPlate = state.container.layers;

      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      const finalPlates = [];
      let plateIndexCounter = 0;
      let rectPresentationId = 1;

      // ========== GIAI ĐOẠN 1: TẤM THUẦN VỚI SMART SPLITTING ==========
      console.log('📋 GIAI ĐOẠN 1: Tạo Tấm Thuần (Smart Splitting)\n');

      const purePatterns = new Map();
      const stock = new Map();

      selectedTypes.forEach(t => stock.set(t.id, state.quantities[t.id] || 0));

      for (const rectType of selectedTypes) {
        console.log(`\n🔍 Analyzing ${rectType.name} (${rectType.width}×${rectType.length}mm)...`);
        
        const patternData = await findPurePatternAdvanced(rectType);
        purePatterns.set(rectType.id, patternData);

        if (patternData.perLayer === 0) {
          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp size ${rectType.name} vào tấm liệu (quá lớn).`
            }
          });
          stock.set(rectType.id, 0);
          continue;
        }

        const dynamicThreshold = calculateDynamicThreshold(rectType, patternData, selectedTypes);
        const totalQuantity = stock.get(rectType.id) || 0;
        const perPlate = patternData.perLayer * layersPerPlate;

        if (totalQuantity < perPlate) {
          console.log(`   ⚠️ Quantity ${totalQuantity} < ${perPlate} → Cannot create pure plate.`);
          continue;
        }

        let potentialFullPlates = Math.floor(totalQuantity / perPlate);
        let createdPlates = 0;
        
        console.log(`   📊 Quantity: ${totalQuantity}, per plate: ${perPlate}, potential plates: ${potentialFullPlates}`);

        for (let p = 0; p < potentialFullPlates; p++) {
          let isPlateSuccessful = false;
          
          const plate = {
            plateIndex: plateIndexCounter,
            type: 'pure',
            primaryTypeId: rectType.id,
            description: `Tấm Thuần ${rectType.name} (#${p + 1})`,
            efficiency: patternData.efficiency,
            layers: []
          };

          for (let l = 0; l < layersPerPlate; l++) {
            const layerRects = patternData.pattern.map(r => ({
              ...r,
              id: rectPresentationId++,
              layer: l,
              plateIndex: plate.plateIndex,
              typeId: rectType.id,
              color: rectType.color
            }));
            plate.layers.push({ layerIndexInPlate: l, rectangles: layerRects });
          }

          // === LOGIC QUYẾT ĐỊNH MỚI ===
          if (patternData.efficiency >= dynamicThreshold) {
            // CASE 1: Hiệu suất tốt → Chấp nhận
            console.log(`   ✓ Plate #${p+1}: Efficiency OK (${patternData.efficiency.toFixed(1)}%) → Create Pure Plate.`);
            isPlateSuccessful = true;
            
          } else {
            // CASE 2: Hiệu suất kém → Thử cải thiện
            console.log(`   🔧 Plate #${p+1}: Efficiency ${patternData.efficiency.toFixed(1)}% < threshold ${dynamicThreshold}% → Try improvement...`);
            
            // B1: Thử fill bằng size có sẵn
            const fillResult = await fillWithExistingStock(plate, selectedTypes, stock, layersPerPlate);
            
            if (fillResult && fillResult.newEfficiency >= dynamicThreshold) {
              console.log(`   ✅ Fill with existing stock successful → Hybrid plate`);
              isPlateSuccessful = true;
              
              plate.type = 'hybrid';
              plate.efficiency = fillResult.newEfficiency;
              plate.layers = fillResult.plate.layers;
              
              const otherTypesDesc = Array.from(fillResult.usedTypeIds)
                .filter(id => id !== rectType.id)
                .map(id => {
                  const t = selectedTypes.find(x => x.id === id);
                  const count = fillResult.usedTypes[id] || 0;
                  return `${count}×${t ? t.name : `#${id}`}`;
                })
                .join(', ');
              
              plate.description = `Tấm Lai ${rectType.name} + [${otherTypesDesc}] (#${p + 1})`;
              
              for (const [fillTypeId, fillCount] of Object.entries(fillResult.usedTypes)) {
                if (Number(fillTypeId) !== rectType.id) {
                  const currentStock = stock.get(Number(fillTypeId)) || 0;
                  stock.set(Number(fillTypeId), Math.max(0, currentStock - fillCount));
                }
              }
            } else {
              // B2: Fill thất bại → Thử split
              console.log(`   🔨 Fill failed → Trying split...`);
              
              const gaps = analyzeGaps(plate.layers.flatMap(l => l.rectangles), state.container);
              const splitCandidates = findSplittableSizes(stock, gaps, selectedTypes);
              
              let splitSuccess = false;
              
              for (const splitCandidate of splitCandidates.slice(0, 3)) {
                if (splitCandidate.typeId === rectType.id) continue;
                
                const splitResult = await trySplitAndFill(
                  plate,
                  splitCandidate,
                  stock,
                  layersPerPlate
                );
                
                if (splitResult && splitResult.newEfficiency >= dynamicThreshold) {
                  console.log(`   ✅ Split successful with ${splitCandidate.rectType.name} → Hybrid plate`);
                  
                  isPlateSuccessful = true;
                  splitSuccess = true;
                  
                  plate.type = 'hybrid';
                  plate.efficiency = splitResult.newEfficiency;
                  plate.layers = splitResult.plate.layers;
                  
                  const splitInfo = splitResult.splitInfo;
                  const splitType = selectedTypes.find(t => t.id === splitInfo.typeId);
                  
                  plate.description = `Tấm Lai ${rectType.name} + [Split ${splitInfo.count}×${splitType?.name || splitInfo.typeId}] (#${p + 1})`;
                  
                  for (const [usedTypeId, usedCount] of Object.entries(splitResult.usedTypes)) {
                    const currentStock = stock.get(Number(usedTypeId)) || 0;
                    stock.set(Number(usedTypeId), Math.max(0, currentStock - usedCount));
                  }
                  
                  break;
                }
              }
              
              if (!splitSuccess) {
                // B3: Split cũng thất bại → HỦY tấm này
                console.log(`   ⚠️ Plate #${p+1}: Both fill and split failed. Cancel this plate.`);
                isPlateSuccessful = false;
              }
            }
          }

          // === RA QUYẾT ĐỊNH CUỐI CÙNG ===
          if (isPlateSuccessful) {
            finalPlates.push(plate);
            createdPlates++;
            plateIndexCounter++;
            
            const currentStock = stock.get(rectType.id) || 0;
            stock.set(rectType.id, Math.max(0, currentStock - perPlate));
            
          } else {
            console.log(`   🛑 Stop creating pure/hybrid plates for ${rectType.name}. Push ${stock.get(rectType.id)} remaining to Mixed.`);
            
            rectPresentationId -= (perPlate);
            break;
          }
        }

        console.log(`   ✓ Created ${createdPlates} Pure/Hybrid plates. Remaining ${stock.get(rectType.id)} of ${rectType.name} for Stage 2.`);
      }

      // ========== GIAI ĐOẠN 2: TẤM HỖN HỢP ==========
      console.log('\n\n📋 GIAI ĐOẠN 2: Tạo Tấm Hỗn Hợp\n');

      let pool = [];
      let poolCounter = 0;
      
      for (const [typeId, qty] of stock.entries()) {
        if (qty <= 0) continue;
        
        const rectType = selectedTypes.find(t => t.id === typeId);
        if (!rectType) continue;

        for (let i = 0; i < qty; i++) {
          pool.push({
            ...rectType,
            id: `pool_${typeId}_${poolCounter++}`,
            typeId: typeId
          });
        }
      }

      console.log(`📦 Pool created with ${pool.length} items from ${new Set(pool.map(r => r.typeId)).size} types`);

      if (pool.length === 0) {
        console.log('✅ No items left in pool!\n');
      }

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

      let mixedPlateCounter = 1;
      const MAX_ITERATIONS = 100;
      const mixedPatterns = new Map();
      let iterationCount = 0;

      while (pool.length > 0 && iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        console.log(`\n🔄 Mixed plate iteration ${iterationCount}, pool size: ${pool.length}`);

        const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
          console.log(`   ✗ Cannot pack remaining ${pool.length} items`);
          
          const remainingByType = {};
          pool.forEach(r => {
            remainingByType[r.typeId] = (remainingByType[r.typeId] || 0) + 1;
          });
          
          const msg = Object.entries(remainingByType)
            .map(([id, cnt]) => {
              const t = selectedTypes.find(x => x.id === Number(id));
              return `${t ? t.name : `#${id}`}: ${cnt}`;
            }).join(', ');

          dispatch({
            type: 'SET_WARNING',
            payload: {
              type: 'optimization',
              message: `Không thể sắp xếp ${pool.length} hình còn lại (${msg}) - Có thể do kích thước quá lớn hoặc không gian không đủ.`
            }
          });
          
          break;
        }

        const { placed, placedIds, typeCount } = mixedResult;

        const normalizedPlaced = placed.map(r => ({
          ...r,
          layer: 0,
          typeId: r.typeId,
          x: r.x,
          y: r.y,
          width: r.width,
          length: r.length,
          rotated: r.rotated || false,
          color: r.color
        }));

        const signature = createPatternSignature(normalizedPlaced);

        const layerMap = new Map();
        placed.forEach(r => {
          if (!layerMap.has(r.layer)) {
            layerMap.set(r.layer, []);
          }
          layerMap.get(r.layer).push({
            ...r,
            typeId: r.typeId,
            x: r.x,
            y: r.y,
            width: r.width,
            length: r.length,
            rotated: r.rotated || false,
            color: r.color
          });
        });

        const newLayers = Array.from(layerMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, rects]) => rects);

        if (mixedPatterns.has(signature)) {
          const existingData = mixedPatterns.get(signature);
          console.log(`   🔁 Pattern match found! Reusing existing plate #${existingData.plate.plateIndex}`);
          
          const layersToAdd = newLayers.map((rects, layerOffset) => {
            const currentLayerIndex = existingData.layers.length + layerOffset;
            return {
              layerIndexInPlate: currentLayerIndex,
              rectangles: rects.map(r => ({
                ...r,
                id: rectPresentationId++,
                layer: currentLayerIndex,
                plateIndex: existingData.plate.plateIndex
              }))
            };
          });

          existingData.layers.push(...layersToAdd);
          existingData.repetitions++;

        } else {
          console.log(`   ✨ New pattern detected, creating plate #${mixedPlateCounter}`);
          
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

          const initialLayers = newLayers.map((rects, layerIdx) => ({
            layerIndexInPlate: layerIdx,
            rectangles: rects.map(r => ({
              ...r,
              id: rectPresentationId++,
              layer: layerIdx,
              plateIndex: plate.plateIndex
            }))
          }));

          plate.layers = initialLayers;

          mixedPatterns.set(signature, {
            plate: plate,
            layers: initialLayers,
            repetitions: 1
          });

          mixedPlateCounter++;
        }
        
        pool = pool.filter(r => !placedIds.has(r.id));
        console.log(`   ✓ Removed ${placedIds.size} items from pool`);
      }

      for (const [, data] of mixedPatterns.entries()) {
        const { plate, layers, repetitions } = data;
        
        plate.description = `Tấm Hỗn Hợp #${plate.plateIndex - plateIndexCounter + mixedPlateCounter} (${layers.length} lớp | ${plate.patternDescription})`;
        if (repetitions > 1) {
          plate.description += ` [×${repetitions}]`;
        }
        
        plate.layers = layers;
        finalPlates.push(plate);
      }

      if (pool.length > 0 && iterationCount >= MAX_ITERATIONS) {
        console.error(`\n✗ Reached iteration limit! ${pool.length} items still remaining`);
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp nhưng vẫn còn ${pool.length} hình chưa xếp được.`
          }
        });
      }

      // ========== GIAI ĐOẠN 3: TỐI ƯU TÀN DƯ (Split cuối cùng) ==========
      console.log(`\n\n📋 GIAI ĐOẠN 3: Tối Ưu Tàn Dư (Split Cuối Cùng)\n`);
      console.log(`📦 Starting Stage 3 with ${pool.length} remaining items`);
      
      const overlaps = (r1, r2) => {
        if (r1.x + r1.width <= r2.x || r1.x >= r2.x + r2.width) {
          return false;
        }
        if (r1.y + r1.length <= r2.y || r1.y >= r2.y + r2.length) {
          return false;
        }
        return true;
      };

      const layerOverlaps = (newRect, existingRects) => {
        for (const rect of existingRects) {
          if (overlaps(newRect, rect)) {
            return true;
          }
        }
        return false;
      };

      const findFirstAvailableSlot = (rectToPlace, gapsList, allPlates) => {
        const orientations = [
          { placeWidth: rectToPlace.width, placeLength: rectToPlace.length, rotated: false },
          { placeWidth: rectToPlace.length, placeLength: rectToPlace.width, rotated: true },
        ];
        
        for (let i = 0; i < gapsList.length; i++) {
          const gap = gapsList[i];
          const layerRects = allPlates[gap.plateIndex].layers[gap.layerIndex].rectangles;

          for (const o of orientations) {
            const { placeWidth, placeLength, rotated } = o;
            
            if (placeWidth > gap.width || placeLength > gap.length) {
              continue;
            }

            const placements = [
              { x: gap.x, y: gap.y, width: placeWidth, length: placeLength, rotated },
              { x: gap.x, y: gap.y + gap.length - placeLength, width: placeWidth, length: placeLength, rotated },
              { x: gap.x + gap.width - placeWidth, y: gap.y, width: placeWidth, length: placeLength, rotated },
              { x: gap.x + gap.width - placeWidth, y: gap.y + gap.length - placeLength, width: placeWidth, length: placeLength, rotated },
            ];

            for (const p of placements) {
              if (!layerOverlaps(p, layerRects)) {
                return {
                  loc: { plateIndex: gap.plateIndex, layerIndex: gap.layerIndex },
                  placement: p,
                  gap_idx: i,
                };
              }
            }
          }
        }
        return null;
      };
      
      const all_gaps = [];
      finalPlates.forEach((plate, plateIndex) => {
        plate.layers.forEach((layer, layerIndex) => {
          const gaps = analyzeGaps(layer.rectangles, state.container); 
          gaps.forEach(gap => {
            all_gaps.push({ ...gap, plateIndex, layerIndex });
          });
        });
      });
      
      all_gaps.sort((a, b) => b.area - a.area);

      const itemsToSplit = [...pool]; 
      pool = [];

      for (const item of itemsToSplit) {
        const newWidth = item.width / 2;
        
        if (newWidth < MIN_SPLIT_WIDTH) {
          console.log(`   ✗ ${item.name}: New width (${newWidth.toFixed(1)}mm) too small, skip.`);
          pool.push(item);
          continue;
        }

        console.log(`   🔍 Trying to split ${item.name} (${item.width}x${item.length}) -> 2x (${newWidth.toFixed(1)}x${item.length})`);

        const half_1 = { ...item, width: newWidth, id: `split_1_${item.id}`, typeId: item.typeId };
        const half_2 = { ...item, width: newWidth, id: `split_2_${item.id}`, typeId: item.typeId };

        const loc1 = findFirstAvailableSlot(half_1, all_gaps, finalPlates);
        
        if (!loc1) {
          console.log(`      -> Cannot find slot for half 1.`);
          pool.push(item);
          continue;
        }
        
        all_gaps.splice(loc1.gap_idx, 1);
        
        const loc2 = findFirstAvailableSlot(half_2, all_gaps, finalPlates);
        
        if (!loc2) {
          console.log(`      -> Found slot for half 1, but NOT for half 2.`);
          pool.push(item);
          continue;
        }

        console.log(`   ✅ SUCCESS: Placed both halves of ${item.name} into Plate ${loc1.loc.plateIndex+1} and Plate ${loc2.loc.plateIndex+1}`);
        
        all_gaps.splice(loc2.gap_idx, 1);
        
        const layer1 = finalPlates[loc1.loc.plateIndex].layers[loc1.loc.layerIndex];
        layer1.rectangles.push({
          ...half_1,
          id: rectPresentationId++, 
          name: `1/2 ${half_1.name}`,
          x: loc1.placement.x,
          y: loc1.placement.y,
          width: loc1.placement.width,
          length: loc1.placement.length,
          rotated: loc1.placement.rotated,
          color: half_1.color,
          plateIndex: loc1.loc.plateIndex,
          layer: loc1.loc.layerIndex
        });

        const layer2 = finalPlates[loc2.loc.plateIndex].layers[loc2.loc.layerIndex];
        layer2.rectangles.push({
          ...half_2,
          id: rectPresentationId++, 
          name: `1/2 ${half_2.name}`,
          x: loc2.placement.x,
          y: loc2.placement.y,
          width: loc2.placement.width,
          length: loc2.placement.length,
          rotated: loc2.placement.rotated,
          color: half_2.color,
          plateIndex: loc2.loc.plateIndex,
          layer: loc2.loc.layerIndex
        });
      }
      
      console.log(`📦 Finished Stage 3, ${pool.length} items cannot be placed.`);

      // ========== TỔNG KẾT ==========
      const allPlaced = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);
      const placedCount = totalRequested - pool.length;

      const pureCount = finalPlates.filter(p => p.type === 'pure').length;
      const hybridCount = finalPlates.filter(p => p.type === 'hybrid').length;
      const mixedCount = finalPlates.filter(p => p.type === 'mixed').length;

      console.log(`\n✓ Total plates: ${finalPlates.length} (Pure: ${pureCount}, Hybrid: ${hybridCount}, Mixed: ${mixedCount})`);
      console.log(`✓ Rectangles: ${placedCount}/${totalRequested} placed`);

      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce(
        (sum, plate) => sum + plate.layers.length * containerArea,
        0
      );
      const placedArea = allPlaced.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;

      console.log(`✓ Total area: ${totalPlateArea.toFixed(0)}mm², Used: ${placedArea.toFixed(0)}mm²`);
      console.log(`✓ Overall efficiency: ${efficiency.toFixed(2)}%`);

      console.log('\n📋 Per-type breakdown:');
      const remainingTypes = pool.reduce((acc, rect) => {
        acc[rect.typeId] = (acc[rect.typeId] || 0) + 1;
        return acc;
      }, {});

      selectedTypes.forEach(type => {
        const requested = state.quantities[type.id] || 0;
        const remaining = remainingTypes[type.id] || 0;
        const placed = requested - remaining;
        const percentage = requested > 0 ? (placed / requested) * 100 : 0;
        console.log(`   ${type.name}: ${placed}/${requested} (${percentage.toFixed(1)}%)`);
      });

      const missing = pool.length;
      if (missing > 0) {
        console.log(`\n⚠️ Warning: ${missing} items could not be placed`);
        
        const remainingByType = {};
        pool.forEach(r => {
          remainingByType[r.typeId] = (remainingByType[r.typeId] || 0) + 1;
        });
        const msg = Object.entries(remainingByType)
          .map(([id, cnt]) => {
            const t = selectedTypes.find(x => x.id === Number(id));
            return `${t ? t.name : `#${id}`}: ${cnt}`;
          }).join(', ');
            
        dispatch({
          type: 'SET_WARNING',
          payload: {
            type: 'optimization',
            message: `Chỉ sắp được ${placedCount}/${totalRequested} hình. ${missing} hình không thể xếp (kể cả khi đã thử chia đôi): ${msg}`
          }
        });
      }

      const result = {
        layersUsed: finalPlates.length,
        platesNeeded: finalPlates.length,
        layersPerPlate: layersPerPlate,
        totalRectanglesCount: totalRequested,
        placedRectanglesCount: placedCount,
        rectangles: allPlaced,
        plates: finalPlates,
        efficiency,
        pureCount,
        hybridCount,
        mixedCount
      };

      console.log('\n🎉 ========== TỐI ƯU HOÀN THÀNH (V2.0) ==========\n');

      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('\n✗ ========== LỖI TỐI ƯU ==========');
      console.error('Error:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: { type: 'optimization', message: `Lỗi trong quá trình tối ưu: ${error.message}` }
      });
      dispatch({ type: 'SET_PACKING_RESULT', payload: { plates: [], rectangles: [] } });
      return false;
    }
  };

  const clearErrors = useCallback(() => dispatch({ type: 'CLEAR_ERRORS' }), []);
  const toggleModbus = useCallback(() => dispatch({ type: 'TOGGLE_MODBUS' }), []);

  const addRectangle = useCallback((rectangle) => {
    const newId = getNewRectId();
    const defaultColor = '#3498db';
    
    console.log(`➕ Adding new rectangle with ID: ${newId}`, rectangle);
    
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

  const updateRectangle = useCallback((_id, _updates) => {}, []);
  const removeRectangle = useCallback((id) => {
    console.log(`🗑️ Removing rectangle with ID: ${id}`);
    dispatch({ type: 'REMOVE_RECTANGLE', payload: id });
  }, []);
  const selectRectangle = useCallback((id) => dispatch({ type: 'SELECT_RECTANGLE', payload: id }), []);
  const selectAllRectangles = useCallback(() => dispatch({ type: 'SELECT_ALL_RECTANGLES' }), []);
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []);
  const setContainer = useCallback((data) => dispatch({ type: 'SET_CONTAINER', payload: data }), []);

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