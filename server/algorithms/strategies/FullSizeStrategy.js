// server/algorithms/strategies/FullSizeStrategy.js
import BaseStrategy from './BaseStrategy.js';

class FullSizeStrategy extends BaseStrategy {
  constructor(container) {
    super(container);
  }

  // =========================================================================
  // PHẦN 1: CÁC HÀM HELPER (CÔNG CỤ HỖ TRỢ)
  // =========================================================================

  // [HELPER 1] Tạo "Hạt giống thông minh" (Smart Seed)
  // Ưu tiên các tấm có kích thước bù trừ tốt với chiều rộng container
  _createSmartSeed(rectangles) {
    const containerWidth = this.container.width;
    return rectangles.slice().sort((a, b) => {
        const remA = containerWidth % a.width;
        const remB = containerWidth % b.width;
        return remA - remB; 
    });
  }

  // [HELPER 2] TẠO SUPER-RECTANGLES (GỘP CÁC TẤM NHỎ THÀNH KHỐI LỚN)
  _createSuperRectangles(originalRects) {
    // 1. Clone dữ liệu để không ảnh hưởng mảng gốc
    let pool = originalRects.map(r => ({...r}));
    let superRects = [];
    
    // Giới hạn ghép: Không ghép quá lớn để tránh không nhét vừa container
    const MAX_MERGE_SIZE = Math.max(this.container.width, this.container.length); 

    // Sắp xếp: Ưu tiên xử lý các tấm nhỏ/hẹp trước để ghép chúng vào nhau
    // Logic: Diện tích nhỏ xử lý trước
    pool.sort((a, b) => (a.width * a.length) - (b.width * b.length));

    while (pool.length > 0) {
        let current = pool.pop(); // Lấy 1 tấm ra
        let merged = false;

        // Tìm "người tình" phù hợp trong pool
        for (let i = pool.length - 1; i >= 0; i--) {
            let candidate = pool[i];
            
            // CASE A: Ghép Chồng (Cùng chiều Rộng) -> Tăng chiều Dài (Vertical Merge)
            // Chỉ ghép nếu độ lệch kích thước < 1mm
            if (Math.abs(current.width - candidate.width) < 1) {
                 const newLength = current.length + candidate.length;
                 if (newLength <= MAX_MERGE_SIZE) {
                     let newRect = {
                         ...current,
                         id: `super_${current.id}_${candidate.id}`,
                         length: newLength,
                         // Lưu trữ cấu trúc con để sau này bung ra
                         subRects: [
                             ...(current.subRects || [{...current, relX: 0, relY: 0}]), 
                             // Tấm thứ 2 nằm dưới tấm thứ 1 (Y tăng)
                             ...(candidate.subRects || [{...candidate, relX: 0, relY: 0}]).map(r => ({...r, relY: r.relY + current.length}))
                         ]
                     };
                     pool.splice(i, 1); // Xóa candidate khỏi pool
                     pool.push(newRect); // Đẩy tấm mới ghép vào pool để thử ghép tiếp
                     merged = true;
                     break;
                 }
            }

            // CASE B: Ghép Ngang (Cùng chiều Dài) -> Tăng chiều Rộng (Horizontal Merge)
            else if (Math.abs(current.length - candidate.length) < 1) {
                const newWidth = current.width + candidate.width;
                if (newWidth <= MAX_MERGE_SIZE) {
                    let newRect = {
                         ...current,
                         id: `super_${current.id}_${candidate.id}`,
                         width: newWidth,
                         subRects: [
                             ...(current.subRects || [{...current, relX: 0, relY: 0}]),
                             // Tấm thứ 2 nằm bên phải tấm thứ 1 (X tăng)
                             ...(candidate.subRects || [{...candidate, relX: 0, relY: 0}]).map(r => ({...r, relX: r.relX + current.width}))
                         ]
                     };
                     pool.splice(i, 1);
                     pool.push(newRect);
                     merged = true;
                     break;
                }
            }
        }

        // Nếu không ghép được với ai, đưa vào danh sách chốt
        if (!merged) {
            superRects.push(current);
        }
    }
    
    // Sắp xếp lại danh sách kết quả (Lớn trước) để chuẩn bị cho MaxRects
    return this.sortRectanglesByArea(superRects);
  }

  // [HELPER 3] BUNG SUPER-RECTANGLES RA (EXPLODE)
  // Chuyển đổi tọa độ của khối gộp thành tọa độ của từng tấm con
  _flattenSuperRectsResult(placedSuperRects, remainingSuperRects) {
      const finalPlaced = [];
      const finalRemaining = [];

      // 1. Bung danh sách đã xếp
      placedSuperRects.forEach(superRect => {
          if (superRect.subRects) {
              superRect.subRects.forEach(sub => {
                  let finalX, finalY, finalW, finalL, finalRotated;

                  if (superRect.rotated) {
                      // Nếu Super Rect bị xoay 90 độ
                      finalW = sub.length; // Con cũng bị xoay theo kích thước
                      finalL = sub.width;
                      finalRotated = !sub.rotated; // Đảo trạng thái xoay của con
                      
                      // Tọa độ: X gốc + Y tương đối (đã xoay), Y gốc + X tương đối (đã xoay)
                      finalX = superRect.x + sub.relY; 
                      finalY = superRect.y + sub.relX;
                  } else {
                      // Nếu Super Rect đứng thẳng
                      finalW = sub.width;
                      finalL = sub.length;
                      finalRotated = sub.rotated;
                      
                      finalX = superRect.x + sub.relX;
                      finalY = superRect.y + sub.relY;
                  }

                  finalPlaced.push({
                      ...sub,
                      x: finalX,
                      y: finalY,
                      width: finalW,
                      length: finalL,
                      rotated: finalRotated,
                      layer: superRect.layer || 0,
                      relX: undefined, relY: undefined, subRects: undefined 
                  });
              });
          } else {
              finalPlaced.push(superRect);
          }
      });

      // 2. Bung danh sách còn lại (Remaining)
      remainingSuperRects.forEach(superRect => {
          if (superRect.subRects) {
               superRect.subRects.forEach(sub => {
                   finalRemaining.push({ ...sub, relX: undefined, relY: undefined });
               });
          } else {
               finalRemaining.push(superRect);
          }
      });

      return { placed: finalPlaced, remaining: finalRemaining };
  }

  // =========================================================================
  // PHẦN 2: HÀM EXECUTE (QUẢN LÝ CHIẾN THUẬT)
  // =========================================================================

  execute(rectanglesToPack) {
    // Copy đầu vào một lần duy nhất để an toàn
    const rawRects = rectanglesToPack.map(r => ({...r}));
    const countTotal = rawRects.length;

    // --- CẤU HÌNH TÀI NGUYÊN ---
    const isLargeDataset = countTotal > 1000;
    const isSuperLarge = countTotal > 5000;

    let POPULATION_SIZE = 40;
    let GENERATIONS = 20;

    if (isSuperLarge) {
        POPULATION_SIZE = 10; 
        GENERATIONS = 5;
    } else if (isLargeDataset) {
        POPULATION_SIZE = 25;
        GENERATIONS = 10;
    }

    // --- ĐỊNH NGHĨA DANH SÁCH CHIẾN THUẬT (ĐẤU TRƯỜNG) ---
    const strategies = [];

    // -----------------------------------------------------------------------
    // CHIẾN THUẬT 1: SUPER CLUSTERING MODE (Siêu Gộp - Tốc độ cao)
    // -----------------------------------------------------------------------
    strategies.push({
        name: 'Super_Clustering_Mode',
        fn: () => {
            // Bước 1: Gộp
            const superRects = this._createSuperRectangles(rawRects);
            // Bước 2: Xếp (Dùng BSSF vì nó tốt cho các khối vuông)
            const packResult = this._maxRectsBSSF(superRects, false); 
            // Bước 3: Bung
            return this._flattenSuperRectsResult(packResult.placed, packResult.remaining);
        }
    });

    // -----------------------------------------------------------------------
    // CHIẾN THUẬT 2: GENETIC HYBRID CHAOS (Di truyền thuần túy)
    // -----------------------------------------------------------------------
    strategies.push({
        name: 'Genetic_Hybrid_Chaos_V2', 
        fn: () => {
            let population = [];

            // A. TẠO QUẦN THỂ ĐA DẠNG
            population.push(this.sortRectanglesByArea(rawRects));          // Lớn -> Nhỏ
            population.push(this.sortRectanglesByAreaAscending(rawRects)); // Nhỏ -> Lớn (Mới)
            population.push(this.sortRectanglesInterleaved(rawRects));     // Xen kẽ (Mới)
            population.push(this._createSmartSeed(rawRects));              // Smart Seed

            // Random Shuffle
            const randomCount = POPULATION_SIZE - population.length;
            for (let i = 0; i < randomCount; i++) {
                population.push(this.shuffleArray(rawRects.slice())); 
            }

            // B. VÒNG LẶP TIẾN HÓA
            for (let gen = 0; gen < GENERATIONS; gen++) {
                const results = population.map(individual => {
                    const res = this._maxRectsContactPoint(individual); 
                    
                    const usedArea = res.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                    const totalArea = this.container.width * this.container.length;
                    const wasteArea = totalArea - usedArea;
                    
                    const beautyScore = this._calculateAlignmentScore(res.placed);
                    const penalty = res.remaining.length * 1000000000;
                    const beautyWeight = 0.2; 
                    const fitnessScore = wasteArea + penalty - (beautyScore * beautyWeight);

                    return { order: individual, score: fitnessScore, result: res };
                });

                results.sort((a, b) => a.score - b.score);

                // Early Exit nếu hoàn hảo
                if (results[0].result.remaining.length === 0 && results[0].score < 0) {
                    return results[0].result;
                }

                // C. LAI GHÉP & ĐỘT BIẾN
                const ELITE_COUNT = Math.max(2, Math.floor(POPULATION_SIZE * 0.4));
                const newPopulation = results.slice(0, ELITE_COUNT).map(r => r.order);
                
                while (newPopulation.length < POPULATION_SIZE) {
                    const p1Idx = Math.floor(Math.random() * ELITE_COUNT); 
                    const p2Idx = Math.floor(Math.random() * ELITE_COUNT);
                    const parent1 = newPopulation[p1Idx];
                    const parent2 = newPopulation[p2Idx];
                    
                    const cutPoint = Math.floor(parent1.length / 2);
                    const child = parent1.slice(0, cutPoint);
                    const childIds = new Set(child.map(r => r.id));
                    
                    for (const r of parent2) {
                        if (!childIds.has(r.id)) child.push(r);
                    }

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

    // -----------------------------------------------------------------------
    // CHIẾN THUẬT 3: GENETIC SUPER CLUSTERING (Kết hợp cả 2 - Siêu Chiến Binh)
    // -----------------------------------------------------------------------
    strategies.push({
        name: 'Genetic_Super_Clustering',
        fn: () => {
            // Bước 1: Gộp thành khối
            const superRects = this._createSuperRectangles(rawRects);
            
            // Nếu việc gộp không làm giảm số lượng đáng kể (tức là ít cặp khớp nhau)
            // thì bỏ qua chiến thuật này để đỡ tốn thời gian tính toán
            if (superRects.length > rawRects.length * 0.9) return null;

            // Bước 2: Chạy Genetic trên các khối Super Rects
            let population = [];
            // Giảm quy mô quần thể chút vì xử lý khối lớn dễ hơn
            const HYBRID_POP_SIZE = Math.max(10, Math.floor(POPULATION_SIZE * 0.6)); 
            const HYBRID_GEN = Math.max(5, Math.floor(GENERATIONS * 0.6));

            population.push(this.sortRectanglesByArea(superRects));
            population.push(this.sortRectanglesByAreaAscending(superRects));
            population.push(this.shuffleArray(superRects.slice()));
            population.push(this.shuffleArray(superRects.slice()));

            while (population.length < HYBRID_POP_SIZE) {
                 population.push(this.shuffleArray(superRects.slice()));
            }

            for (let gen = 0; gen < HYBRID_GEN; gen++) {
                const results = population.map(individual => {
                    const res = this._maxRectsContactPoint(individual); // Dùng ContactPoint để xếp khối
                    
                    const usedArea = res.placed.reduce((sum, r) => sum + r.width*r.length, 0);
                    const totalArea = this.container.width * this.container.length;
                    const waste = totalArea - usedArea;
                    const beauty = this._calculateAlignmentScore(res.placed);
                    const penalty = res.remaining.length * 1000000000;
                    
                    const score = waste + penalty - (beauty * 0.5);
                    return { order: individual, score, result: res };
                });

                results.sort((a, b) => a.score - b.score);

                // Nếu tìm thấy kết quả hoàn hảo
                if (results[0].result.remaining.length === 0 && results[0].score < 0) {
                     return this._flattenSuperRectsResult(results[0].result.placed, results[0].result.remaining);
                }

                // Lai ghép đơn giản cho Hybrid
                const ELITE = 3;
                const newPop = results.slice(0, ELITE).map(r => r.order);
                while(newPop.length < HYBRID_POP_SIZE) {
                    const p1 = newPop[Math.floor(Math.random() * ELITE)];
                    const p2 = newPop[Math.floor(Math.random() * ELITE)];
                    const cut = Math.floor(p1.length / 2);
                    const child = p1.slice(0, cut);
                    const childIds = new Set(child.map(r => r.id));
                    for(const r of p2) if(!childIds.has(r.id)) child.push(r);
                    if(Math.random() < 0.3) {
                         const i1 = Math.floor(Math.random() * child.length);
                         const i2 = Math.floor(Math.random() * child.length);
                         [child[i1], child[i2]] = [child[i2], child[i1]];
                    }
                    newPop.push(child);
                }
                population = newPop;
            }

            // Lấy kết quả tốt nhất của Hybrid
            const bestOrder = population[0];
            const finalPack = this._maxRectsContactPoint(bestOrder);
            
            // Bước 3: Bung kết quả
            return this._flattenSuperRectsResult(finalPack.placed, finalPack.remaining);
        }
    });

    // -----------------------------------------------------------------------
    // CÁC CHIẾN THUẬT DỰ PHÒNG (FALLBACK)
    // -----------------------------------------------------------------------
    let rectsAreaForFallback = null;
    if (!isSuperLarge) {
        rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
        const rectsShuffled = this.shuffleArray(rawRects.map(r => ({...r})));

        strategies.push(
            { name: 'MaxRects_BSSF_Area', fn: () => this._maxRectsBSSF(rectsAreaForFallback, false) },
            { name: 'MaxRects_BSSF_Random', fn: () => this._maxRectsBSSF(rectsShuffled, false) },
            { name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsAreaForFallback) }
        );
    } else {
        rectsAreaForFallback = this.sortRectanglesByArea(rawRects);
        strategies.push({ name: 'BottomLeftFill_Area', fn: () => this._bottomLeftFill(rectsAreaForFallback) });
    }

    // =======================================================================
    // PHẦN 3: ĐẤU TRƯỜNG - SO SÁNH VÀ CHỌN NGƯỜI CHIẾN THẮNG
    // =======================================================================
    
    let bestResult = null;
    
    for (const strat of strategies) {
      const result = strat.fn();
      if (!result) continue; // Nếu chiến thuật trả về null (do bỏ qua), thì next

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

      // Logic so sánh: Số lượng > Độ nén > Độ đẹp
      if (currentResult.count > bestResult.count) {
          bestResult = currentResult;
      } else if (currentResult.count === bestResult.count) {
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