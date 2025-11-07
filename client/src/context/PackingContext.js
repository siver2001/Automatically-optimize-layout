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
      // Clean up both rectangles and quantities completely
      const idToRemove = action.payload;
      const { [idToRemove]: _removed, ...newQuantities } = state.quantities;
      
      return {
        ...state,
        rectangles: state.rectangles.filter(r => r.id !== idToRemove),
        selectedRectangles: state.selectedRectangles.filter(id => id !== idToRemove),
        quantities: newQuantities,
        // Clear any packing results that might reference the removed rectangle
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

  // Use a ref to track the highest ID ever assigned (prevents ID reuse)
  const nextIdRef = React.useRef(Math.max(0, ...initialState.rectangles.map(r => r?.id || 0)) + 1);
  
  const getNewRectId = useCallback(() => {
    const currentMaxId = Math.max(0, ...state.rectangles.map(r => r.id));
    // Ensure we never reuse IDs
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
  // NÂNG CẤP 1: TÌM PATTERN THUẦN TỐI ƯU VỚI ADAPTIVE SAMPLE SIZE
  // ============================================================
  const findPurePatternAdvanced = async (rectType) => {
    const containerArea = state.container.width * state.container.length;
    const rectArea = rectType.width * rectType.length;
    const theoreticalMax = Math.floor(containerArea / rectArea);
    
    // Adaptive sample size: tối thiểu 200, tối đa 500
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

  // ============================================================
  // NÂNG CẤP 2: SMART DYNAMIC THRESHOLD CALCULATION
  // ============================================================
  const calculateDynamicThreshold = (rectType, patternData, allTypes) => {
    const {  packingDensity } = patternData;
    
    let threshold = 85; // Base threshold
    
    // 1. Điều chỉnh theo tỷ lệ kích thước (aspect ratio)
    const aspectRatio = Math.min(rectType.width, rectType.length) / 
                       Math.max(rectType.width, rectType.length);
    if (aspectRatio < 0.5) {
      threshold -= 5; // Hình dài khó sắp → nới lỏng
    } else if (aspectRatio > 0.9) {
      threshold += 3; // Hình gần vuông dễ sắp → yêu cầu cao hơn
    }
    
    // 2. Điều chỉnh theo số lượng size khác có sẵn để lấp đầy
    const smallerSizes = allTypes.filter(t => 
      t.id !== rectType.id && 
      t.width * t.length < rectType.width * rectType.length * 0.3
    );
    
    if (allTypes.length <= 2) {
      threshold -= 10; // Ít size → khó lấp đầy → nới lỏng
    } else if (smallerSizes.length >= 3) {
      threshold += 5; // Nhiều size nhỏ → dễ lấp đầy → yêu cầu cao hơn
    }
    
    // 3. Điều chỉnh theo packing density
    if (packingDensity > 0.8) {
      threshold -= 5; // Đã pack rất tốt so với lý thuyết
    } else if (packingDensity < 0.5) {
      threshold -= 8; // Pack kém → có thể do hình phức tạp
    }
    
    // 4. Điều chỉnh theo kích thước tuyệt đối
    const sizeRatio = (rectType.width * rectType.length) / 
                     (state.container.width * state.container.length);
    if (sizeRatio > 0.3) {
      threshold -= 7; // Size lớn chiếm >30% tấm → khó lấp đầy
    }
    
    // Giới hạn threshold trong khoảng 70-92%
    const finalThreshold = Math.max(70, Math.min(92, threshold));
    
    console.log(`   📊 Dynamic threshold for ${rectType.name}: ${finalThreshold}% (base: 85%, adjustments: aspect=${aspectRatio.toFixed(2)}, sizes=${allTypes.length}, density=${(packingDensity*100).toFixed(1)}%)`);
    
    return finalThreshold;
  };

  // ============================================================
  // NÂNG CẤP 3: INTELLIGENT GAP ANALYSIS
  // ============================================================
  const analyzeGaps = (placedRects, container) => {
    const resolution = 10; // 10mm grid resolution
    const gridW = Math.ceil(container.width / resolution);
    const gridH = Math.ceil(container.length / resolution);
    const grid = Array(gridH).fill(0).map(() => Array(gridW).fill(0));
    
    // Mark occupied cells
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
    
    // Find gaps using flood fill
    const gaps = [];
    const visited = new Set();
    
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (grid[y][x] === 0 && !visited.has(`${x},${y}`)) {
          const gap = floodFill(grid, x, y, visited, resolution);
          if (gap.area > 1000) { // Only consider gaps > 1000mm²
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
      
      // Check 4 directions
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
  // NÂNG CẤP 4: SMART GAP FILLING WITH PRIORITIZATION
  // ============================================================
  const findBestFillCandidates = (purePlate, availableTypes, stock) => {
    const existingRects = purePlate.layers.flatMap(layer => layer.rectangles);
    const gaps = analyzeGaps(existingRects, state.container);
    
    if (gaps.length === 0) {
      return [];
    }
    
    console.log(`   🔍 Found ${gaps.length} gaps, total gap area: ${gaps.reduce((s, g) => s + g.area, 0).toFixed(0)}mm²`);
    
    const candidates = [];
    
    for (const type of availableTypes) {
      if (type.id === purePlate.primaryTypeId) continue;
      
      const availableQty = stock.get(type.id) || 0;
      if (availableQty <= 0) continue;
      
      let score = 0;
      let fitCount = 0;
      let bestFitRatio = 0;
      
      for (const gap of gaps) {
        // Test normal orientation
        if (type.width <= gap.width && type.length <= gap.length) {
          const rectArea = type.width * type.length;
          const fitRatio = rectArea / gap.area;
          fitCount++;
          score += fitRatio; // Ưu tiên size fill đầy gap
          bestFitRatio = Math.max(bestFitRatio, fitRatio);
        }
        
        // Test rotated orientation
        if (type.length <= gap.width && type.width <= gap.length) {
          const rectArea = type.width * type.length;
          const fitRatio = rectArea / gap.area;
          fitCount++;
          score += fitRatio * 0.95; // Small penalty for rotation
          bestFitRatio = Math.max(bestFitRatio, fitRatio);
        }
      }
      
      if (fitCount > 0) {
        const rectArea = type.width * type.length;
        const priority = score / rectArea * 1000; // Normalize by area
        
        candidates.push({
          type,
          score,
          fitCount,
          priority,
          bestFitRatio,
          availableQty
        });
      }
    }
    
    // Sort by priority (higher is better)
    candidates.sort((a, b) => b.priority - a.priority);
    
    if (candidates.length > 0) {
      console.log(`   ✓ Top 3 fill candidates:`);
      candidates.slice(0, 3).forEach((c, i) => {
        console.log(`     ${i+1}. ${c.type.name}: priority=${c.priority.toFixed(2)}, fits=${c.fitCount} gaps, ratio=${(c.bestFitRatio*100).toFixed(1)}%`);
      });
    }
    
    return candidates;
  };

  // ============================================================
  // NÂNG CẤP 5: ENHANCED GAP FILLING WITH SMART SELECTION
  // ============================================================
  const fillPurePlateGapsAdvanced = async (purePlate, availableTypes, stock) => {
    if (!purePlate || !purePlate.layers || purePlate.layers.length === 0) return null;
    
    const existingRects = purePlate.layers.flatMap(layer => layer.rectangles);
    
    // Find best candidates
    const candidates = findBestFillCandidates(purePlate, availableTypes, stock);
    
    if (candidates.length === 0) {
      console.log(`   ⚠ No suitable candidates for gap filling`);
      return null;
    }
    
    // Create smart fill pool: prioritize best candidates
    const fillPool = [];
    let poolId = 0;
    
    // Take top candidates up to total sample limit
    const MAX_FILL_POOL_SIZE = 100;
    let remainingSlots = MAX_FILL_POOL_SIZE;
    
    for (const candidate of candidates) {
      if (remainingSlots <= 0) break;
      
      // Allocate more slots to better candidates
      const slotsForThis = Math.min(
        Math.ceil(candidate.priority * 0.5), // Proportional to priority
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
    
    console.log(`   🔧 Created fill pool with ${fillPool.length} items from ${new Set(fillPool.map(r => r.typeId)).size} types`);
    
    // Combine and re-pack
    const combinedRects = [...existingRects, ...fillPool];
    
    const result = await packingService.optimizePacking(
      { ...state.container, layers: purePlate.layers.length },
      combinedRects,
      purePlate.layers.length
    );

    const placed = (result?.result?.rectangles || [])
      .filter(r => r && r.x !== undefined);

    const originalIds = new Set(existingRects.map(r => r.id));
    const newlyPlaced = placed.filter(r => !originalIds.has(r.id));

    if (newlyPlaced.length === 0) {
      console.log(`   ❌ Gap filling didn't add any new rectangles`);
      return null;
    }

    const usedTypeIds = new Set(newlyPlaced.map(r => r.typeId));
    const placedIds = new Set(newlyPlaced.map(r => r.id));

    const typeCount = {};
    newlyPlaced.forEach(r => {
      typeCount[r.typeId] = (typeCount[r.typeId] || 0) + 1;
    });

    return {
      newlyPlaced,
      placedIds,
      usedTypeIds,
      typeCount,
      allPlaced: placed
    };
  };

  // ============================================================
  // NÂNG CẤP 6: MULTI-STRATEGY MIXED PLATE PACKING
  // ============================================================
  const createMixedPlateMultiStrategy = async (pool, layersPerPlate) => {
    if (pool.length === 0) return null;

    // Try multiple sorting strategies
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
    
    console.log('\n🚀 ========== BẮT ĐẦU TỐI ƯU NÂNG CẤP ==========\n');

    try {
      dispatch({ type: 'START_OPTIMIZATION' });
      const layersPerPlate = state.container.layers;

      const selectedTypes = state.rectangles.filter(
        r => state.selectedRectangles.includes(r.id) && (state.quantities[r.id] || 0) > 0
      );

      const finalPlates = [];
      let plateIndexCounter = 0;
      let rectPresentationId = 1;

      // ========== GIAI ĐOẠN 1: TẤM THUẦN VỚI DYNAMIC THRESHOLD ==========
      console.log('📋 GIAI ĐOẠN 1: TẠO TẤM THUẦN\n');

      const purePatterns = new Map();
      const stock = new Map();

      selectedTypes.forEach(t => stock.set(t.id, state.quantities[t.id] || 0));

      for (const rectType of selectedTypes) {
        console.log(`\n🔍 Analyzing ${rectType.name} (${rectType.width}×${rectType.length}mm)...`);
        
        // Use advanced pattern finding
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

        // Calculate dynamic threshold
        const dynamicThreshold = calculateDynamicThreshold(rectType, patternData, selectedTypes);

        const totalQuantity = stock.get(rectType.id) || 0;
        const perPlate = patternData.perLayer * layersPerPlate;
        const fullPlates = Math.floor(totalQuantity / perPlate);

        console.log(`   📊 Quantity: ${totalQuantity}, per plate: ${perPlate}, full plates: ${fullPlates}`);

        if (fullPlates > 0) {
          for (let p = 0; p < fullPlates; p++) {
            const plate = {
              plateIndex: plateIndexCounter++,
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

            // ========== GAP FILLING WITH SMART SELECTION ==========
            if (patternData.efficiency < dynamicThreshold) {
              console.log(`\n   🔧 Efficiency ${patternData.efficiency.toFixed(1)}% < threshold ${dynamicThreshold}% → Attempting gap fill...`);
              
              const fillResult = await fillPurePlateGapsAdvanced(plate, selectedTypes, stock);
              
              if (fillResult && fillResult.newlyPlaced.length > 0) {
                console.log(`   ✅ Gap filling SUCCESS: Added ${fillResult.newlyPlaced.length} items`);
                
                plate.type = 'hybrid';
                
                const otherTypesDesc = Array.from(fillResult.usedTypeIds)
                  .filter(id => id !== rectType.id)
                  .map(id => {
                    const t = selectedTypes.find(x => x.id === id);
                    const count = fillResult.typeCount[id] || 0;
                    return `${count}×${t ? t.name : `#${id}`}`;
                  })
                  .join(', ');
                
                plate.description = `Tấm Lai ${rectType.name} + [${otherTypesDesc}] (#${p + 1})`;
                
                const newUsedArea = fillResult.allPlaced.reduce((sum, r) => sum + (r.width * r.length), 0);
                const totalPlateArea = state.container.width * state.container.length * layersPerPlate;
                const newEfficiency = totalPlateArea > 0 ? (newUsedArea / totalPlateArea) * 100 : 0;
                plate.efficiency = newEfficiency;
                
                console.log(`   📈 Efficiency improved: ${patternData.efficiency.toFixed(1)}% → ${newEfficiency.toFixed(1)}%`);
                
                const layerMap = new Map();
                fillResult.allPlaced.forEach(r => {
                  if (!layerMap.has(r.layer)) {
                    layerMap.set(r.layer, []);
                  }
                  layerMap.get(r.layer).push({
                    ...r,
                    id: rectPresentationId++,
                    plateIndex: plate.plateIndex,
                    color: r.color
                  });
                });

                plate.layers = Array.from(layerMap.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([layerIdx, rects]) => ({
                    layerIndexInPlate: layerIdx,
                    rectangles: rects
                  }));

                // Update stock for filled types
                for (const [fillTypeId, fillCount] of Object.entries(fillResult.typeCount)) {
                  if (Number(fillTypeId) !== rectType.id) {
                    const currentStock = stock.get(Number(fillTypeId)) || 0;
                    stock.set(Number(fillTypeId), Math.max(0, currentStock - fillCount));
                    console.log(`   📦 Used ${fillCount}×${selectedTypes.find(t => t.id === Number(fillTypeId))?.name || fillTypeId} from stock`);
                  }
                }
              } else {
                console.log(`   ⚠ Gap filling failed: No suitable items found`);
              }
            } else {
              console.log(`   ✓ Efficiency ${patternData.efficiency.toFixed(1)}% >= threshold ${dynamicThreshold}% → No gap filling needed`);
            }

            finalPlates.push(plate);
          }

          const used = fullPlates * perPlate;
          const remaining = totalQuantity - used;
          stock.set(rectType.id, remaining);
          console.log(`   ✓ Created ${fullPlates} pure plates, remaining: ${remaining}`);
        } else {
          console.log(`   ⚠ Quantity ${totalQuantity} < ${perPlate} → Cannot create pure plate`);
        }
      }

      // ========== GIAI ĐOẠN 2: TẤM HỖN HỢP VỚI MULTI-STRATEGY ==========
      console.log('\n\n📋 GIAI ĐOẠN 2: TẠO TẤM HỖN HỢP\n');

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

        // Use multi-strategy approach
        const mixedResult = await createMixedPlateMultiStrategy(pool, layersPerPlate);

        if (!mixedResult || mixedResult.placed.length === 0) {
          console.log(`   ❌ Cannot pack remaining ${pool.length} items`);
          
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

      // Add all mixed plates to final result
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
        console.error(`\n❌ Reached iteration limit! ${pool.length} items still remaining`);
        dispatch({
          type: 'SET_ERROR',
          payload: {
            type: 'optimization',
            message: `Đã đạt giới hạn ${MAX_ITERATIONS} lần lặp nhưng vẫn còn ${pool.length} hình chưa xếp được.`
          }
        });
      }
      // ============================================================
      // NÂNG CẤP MỚI: GIAI ĐOẠN 3 - TỐI ƯU TÀN DƯ (CHIA RỘNG)
      // ============================================================
      console.log(`\n\n📋 GIAI ĐOẠN 3: TỐI ƯU TÀN DƯ (CHIA RỘNG)\n`);
      console.log(`📦 Bắt đầu Giai đoạn 3 với ${pool.length} items còn lại`);
      
      const MIN_SPLIT_WIDTH = 10; // Ngưỡng chia nhỏ nhất (ví dụ: 10mm)

      // Hàm helper để kiểm tra xem 1 hình có vừa 1 gap không
      // (Chúng ta định nghĩa nó ở đây để nó có thể truy cập `analyzeGaps`)
      const canFit = (gap, rect) => {
        // Check normal
        if (rect.width <= gap.width && rect.length <= gap.length) {
          return { rotated: false, placeWidth: rect.width, placeLength: rect.length };
        }
        // Check rotated (cho phép xoay nửa đã chia)
        if (rect.length <= gap.width && rect.width <= gap.length) {
          return { rotated: true, placeWidth: rect.length, placeLength: rect.width };
        }
        return null;
      };
      
      const itemsToSplit = [...pool]; // Lấy danh sách tàn dư
      pool = []; // Reset pool, sẽ add lại những gì thất bại

      for (const item of itemsToSplit) {
        const newWidth = item.width / 2;
        
        // Kiểm tra xem có đáng để chia không
        if (newWidth < MIN_SPLIT_WIDTH) {
          console.log(`   ❌ ${item.name}: Chiều rộng mới (${newWidth.toFixed(1)}mm) quá nhỏ, bỏ qua.`);
          pool.push(item);
          continue;
        }

        console.log(`   🔍 Đang thử chia ${item.name} (${item.width}x${item.length}) -> 2x (${newWidth.toFixed(1)}x${item.length})`);

        const half_1 = { ...item, width: newWidth, id: `split_1_${item.id}`, typeId: item.typeId };
        const half_2 = { ...item, width: newWidth, id: `split_2_${item.id}`, typeId: item.typeId };

        // 1. Thu thập TẤT CẢ các gaps từ TẤT CẢ các tấm và lớp
        const all_gaps = [];
        finalPlates.forEach((plate, plateIndex) => {
          plate.layers.forEach((layer, layerIndex) => {
            // Dùng state.container vì 'container' không có trong scope này
            const gaps = analyzeGaps(layer.rectangles, state.container); 
            gaps.forEach(gap => {
              // Thêm tham chiếu 'layerRef' để có thể thêm rect vào
              all_gaps.push({ ...gap, plateIndex, layerIndex, layerRef: layer });
            });
          });
        });

        // 2. Tìm gap cho half_1
        let loc1 = null, fit1 = null, gap_1_idx = -1;
        for (let i = 0; i < all_gaps.length; i++) {
           fit1 = canFit(all_gaps[i], half_1);
           if (fit1) {
             gap_1_idx = i;
             break;
           }
        }

        if (gap_1_idx === -1) {
          console.log(`      -> Không tìm thấy chỗ cho nửa 1.`);
          pool.push(item);
          continue;
        }
        loc1 = all_gaps.splice(gap_1_idx, 1)[0]; // Lấy và XÓA gap 1

        // 3. Tìm gap cho half_2 (từ các gaps còn lại)
        let loc2 = null, fit2 = null, gap_2_idx = -1;
        for (let i = 0; i < all_gaps.length; i++) {
           fit2 = canFit(all_gaps[i], half_2);
           if (fit2) {
             gap_2_idx = i;
             break;
           }
        }
        
        if (gap_2_idx === -1) {
          console.log(`      -> Tìm thấy chỗ cho nửa 1, nhưng KHÔNG tìm thấy chỗ cho nửa 2.`);
          pool.push(item); // Thất bại, trả lại hình gốc
          continue;
        }
        loc2 = all_gaps.splice(gap_2_idx, 1)[0]; // Lấy và XÓA gap 2

        // 4. THÀNH CÔNG! Đã tìm thấy cả 2.
        console.log(`   ✅ SUCCESS: Đặt 2 nửa của ${item.name} vào Tấm ${loc1.plateIndex+1}/Lớp ${loc1.layerIndex} và Tấm ${loc2.plateIndex+1}/Lớp ${loc2.layerIndex}`);
        
        // Thêm rect 1 vào layer (dùng layerRef)
        loc1.layerRef.rectangles.push({
          ...half_1,
          id: rectPresentationId++, // Dùng ID duy nhất
          name: `1/2 ${half_1.name}`, // Đánh dấu là nửa
          x: loc1.x,
          y: loc1.y,
          width: fit1.placeWidth,
          length: fit1.placeLength,
          rotated: fit1.rotated,
          color: half_1.color,
          plateIndex: loc1.plateIndex,
          layer: loc1.layerIndex
        });

        // Thêm rect 2 vào layer (dùng layerRef)
        loc2.layerRef.rectangles.push({
          ...half_2,
          id: rectPresentationId++, // Dùng ID duy nhất
          name: `1/2 ${half_2.name}`, // Đánh dấu là nửa
          x: loc2.x,
          y: loc2.y,
          width: fit2.placeWidth,
          length: fit2.placeLength,
          rotated: fit2.rotated,
          color: half_2.color,
          plateIndex: loc2.plateIndex,
          layer: loc2.layerIndex
        });
        
        // Không push 'item' vào pool nữa, vì nó đã được xếp thành công
      }
      
      console.log(`📦 Kết thúc Giai đoạn 3, còn lại ${pool.length} items không thể xếp.`);

      // ========== TỔNG KẾT ==========
      console.log('\n\n📊 ========== TỔNG KẾT ==========\n');

      const allPlaced = finalPlates.flatMap(p => p.layers.flatMap(l => l.rectangles));
      const totalRequested = selectedTypes.reduce((s, t) => s + (state.quantities[t.id] || 0), 0);
      const placedCount = totalRequested - pool.length;

      const pureCount = finalPlates.filter(p => p.type === 'pure').length;
      const hybridCount = finalPlates.filter(p => p.type === 'hybrid').length;
      const mixedCount = finalPlates.filter(p => p.type === 'mixed').length;

      console.log(`✓ Total plates: ${finalPlates.length} (Pure: ${pureCount}, Hybrid: ${hybridCount}, Mixed: ${mixedCount})`);
      console.log(`✓ Rectangles: ${placedCount}/${totalRequested} (hình gốc) đã xếp`);

      const containerArea = state.container.width * state.container.length;
      const totalPlateArea = finalPlates.reduce(
        (sum, plate) => sum + plate.layers.length * containerArea,
        0
      );
      const placedArea = allPlaced.reduce((sum, r) => sum + r.width * r.length, 0);
      const efficiency = totalPlateArea > 0 ? (placedArea / totalPlateArea) * 100 : 0;

      console.log(`✓ Total area: ${totalPlateArea.toFixed(0)}mm², Used: ${placedArea.toFixed(0)}mm²`);
      console.log(`✓ Overall efficiency: ${efficiency.toFixed(2)}%`);

      // Calculate per-type efficiency
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
        console.log(`\n⚠ Warning: ${missing} (hình gốc) could not be placed`);
        
        // Tạo thông báo lỗi từ pool
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
            message: `Chỉ sắp được ${placedCount}/${totalRequested} hình. ${missing} hình không thể xếp (Ngay cả khi đã thử chia đôi): ${msg}`
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

      console.log('\n🎉 ========== TỐI ƯU HOÀN THÀNH ==========\n');

      dispatch({ type: 'SET_PACKING_RESULT', payload: result });
      return true;

    } catch (error) {
      console.error('\n❌ ========== LỖI TỐI ƯU ==========');
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