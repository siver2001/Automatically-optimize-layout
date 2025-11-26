// server/algorithms/strategies/FullSizeStrategy.js
import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  // [GIẢI PHÁP 1] Tạo "Hạt giống thông minh" (Seed)
  // Ưu tiên các tấm có kích thước bù trừ tốt với chiều rộng container
  _createSmartSeed(rectangles) {
    const containerWidth = this.container.width;
    // Dùng slice() để tạo bản sao cạn trước khi sort, giữ nguyên phong cách code cũ
    return rectangles.slice().sort((a, b) => {
        // Ưu tiên tấm nào khi ghép vào khổ ván thì phần dư là ít nhất (tròn khổ)
        const remA = containerWidth % a.width;
        const remB = containerWidth % b.width;
        return remA - remB; 
    });
  }

  execute(rectanglesToPack) {
    // Copy đầu vào một lần duy nhất để an toàn
    const rawRects = rectanglesToPack.map(r => ({...r}));
    const countTotal = rawRects.length;

    // --- CẤU HÌNH THUẬT TOÁN ---
    const isLargeDataset = countTotal > 1000;
    const isSuperLarge = countTotal > 5000;

    let POPULATION_SIZE = 40;
    let GENERATIONS = 20;

    if (isSuperLarge) {
        POPULATION_SIZE = 8;  // Cực ít cá thể để đảm bảo tốc độ
        GENERATIONS = 4;      // Ít thế hệ
    } else if (isLargeDataset) {
        POPULATION_SIZE = 20;
        GENERATIONS = 8;
    }

    // --- ĐỊNH NGHĨA CHIẾN THUẬT ---
    const strategies = [];

    // 1. CHIẾN THUẬT CHÍNH: GENETIC ULTIMATE
    strategies.push({
        name: 'Genetic_Hybrid_Chaos', // Đổi tên để thể hiện tính chất mới
        fn: () => {
            let population = [];

            // A. TẠO QUẦN THỂ ĐA DẠNG HƠN
            population.push(this._createSmartSeed(rawRects));
            population.push(this.sortRectanglesByArea(rawRects)); // Lớn trước nhỏ sau
            population.push(this.sortRectanglesBySide(rawRects)); // Cạnh dài nhất trước
            
            // Random Shuffle (Tăng số lượng ngẫu nhiên để tìm cơ hội "mix" size lạ)
            for (let i = 3; i < POPULATION_SIZE; i++) {

                population.push(this.shuffleArray(rawRects.slice())); 
            }

            // B. VÒNG LẶP TIẾN HÓA
            for (let gen = 0; gen < GENERATIONS; gen++) {
                const results = population.map(individual => {
                    // Sử dụng MaxRects Contact Point (Tốt nhất cho việc dính các tấm lại với nhau)
                    const res = this._maxRectsContactPoint(individual); 
                    
                    const usedArea = res.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                    const totalArea = this.container.width * this.container.length;
                    const wasteArea = totalArea - usedArea;
                    
                    const beautyScore = this._calculateAlignmentScore(res.placed);
                    const penalty = res.remaining.length * Number.MAX_SAFE_INTEGER; 

                    // [UPGRADE 2]: CHẾ ĐỘ THÍCH ỨNG (ADAPTIVE WEIGHT)
                    const beautyWeight = 0.3; 

                    const fitnessScore = wasteArea + penalty - (beautyScore * beautyWeight);

                    return { order: individual, score: fitnessScore, result: res };
                });

                // Sắp xếp: Điểm càng THẤP càng TỐT
                results.sort((a, b) => a.score - b.score);

                // Early Exit: Tuyệt đối
                if (results[0].result.remaining.length === 0 && gen > 5) {
                    return results[0].result;
                }

                // C. LAI GHÉP & ĐỘT BIẾN
                const ELITE_COUNT = Math.max(2, Math.floor(POPULATION_SIZE * 0.4));
                const newPopulation = results.slice(0, ELITE_COUNT).map(r => r.order);
                
                while (newPopulation.length < POPULATION_SIZE) {
                    // Tournament Selection nhẹ (chọn ngẫu nhiên trong top 50%)
                    const p1Idx = Math.floor(Math.random() * (POPULATION_SIZE / 2));
                    const p2Idx = Math.floor(Math.random() * (POPULATION_SIZE / 2));
                    
                    const parent1 = results[p1Idx]?.order || newPopulation[0];
                    const parent2 = results[p2Idx]?.order || newPopulation[1];
                    
                    // Crossover (Lai ghép)
                    const cutPoint = Math.floor(parent1.length / 2);
                    const child = parent1.slice(0, cutPoint);
                    const childIds = new Set(child.map(r => r.id));
                    
                    for (const r of parent2) {
                        if (!childIds.has(r.id)) child.push(r);
                    }

                    // Mutation (Đột biến) - [UPGRADE 3]: Tăng tỷ lệ đột biến
                    // Giúp đảo chỗ các tấm nhỏ vào vị trí mới
                    if (Math.random() < 0.4 && child.length > 1) { 
                        const idxA = Math.floor(Math.random() * child.length);
                        const idxB = Math.floor(Math.random() * child.length);
                        [child[idxA], child[idxB]] = [child[idxB], child[idxA]];
                    }
                    newPopulation.push(child);
                }
                population = newPopulation;
            }

            return this._maxRectsContactPoint(population[0]);
        }
    });

    // 2. CÁC CHIẾN THUẬT BỔ TRỢ (CHỈ CHẠY NẾU DỮ LIỆU KHÔNG QUÁ LỚN)
    // [TỐI ƯU]: Chỉ tạo dữ liệu khi cần thiết (Lazy Loading)
    let rectsAreaForFallback = null;

    if (!isSuperLarge) {
        rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
        const rectsShuffled = this.shuffleArray(rawRects.map(r => ({...r}))); // Thử một phương án ngẫu nhiên

        strategies.push(
            { name: 'MaxRects_BSSF_Area', fn: () => this._maxRectsBSSF(rectsAreaForFallback, false) }, // False = Ko ép grid
            { name: 'MaxRects_BSSF_Random', fn: () => this._maxRectsBSSF(rectsShuffled, false) }, // Random giúp lấp lỗ
            { name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsAreaForFallback) }
        );
    } else {
        rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
        strategies.push({ name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsAreaForFallback) });
    }

    // --- PHẦN SO SÁNH GIỮ NGUYÊN ---
    let bestResult = null;

    for (const strat of strategies) {
      const result = strat.fn();
      if (!result) continue;

      const count = result.placed.length;
      const usedArea = result.placed.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
      const alignmentScore = this._calculateAlignmentScore(result.placed);
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      if (result.placed.length > 0) {
        result.placed.forEach(r => {
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.length);
        });
      } else { minX = 0; minY = 0; maxX = 0; maxY = 0; }
      
      const boundingArea = (maxX - minX) * (maxY - minY);
      const compactness = boundingArea > 0 ? (usedArea / boundingArea) : 0;

      const currentResult = {
          placed: result.placed, 
          remaining: result.remaining,
          count, usedArea, alignmentScore, compactness,
          strategyName: strat.name
      };

      if (!bestResult) {
          bestResult = currentResult;
          continue;
      }

      // Tiêu chí chọn lọc:
      // 1. Số lượng là VUA
      if (currentResult.count > bestResult.count) {
          bestResult = currentResult;
      } 
      // 2. Nếu số lượng bằng nhau
      else if (currentResult.count === bestResult.count) {
          // [TỐI ƯU LẠI TIÊU CHÍ]: Nếu chênh lệch alignment không quá lớn, hãy chọn cái nào KHÍT hơn (Compactness cao hơn)
          // Code cũ ưu tiên Alignment quá mức (+50 điểm).
          // Code mới: Ưu tiên Compactness (Độ khít) để các size lẫn lộn tốt hơn.
          if (currentResult.compactness > bestResult.compactness + 0.05) { 
               bestResult = currentResult;
          } else if (currentResult.alignmentScore > bestResult.alignmentScore + 100) {
               bestResult = currentResult;
          }
      }
    }

    if (bestResult) {
        bestResult.strategyName = `FullSize_${bestResult.strategyName}`;
    }
    
    return bestResult;
  }
}

export default FullSizeStrategy;