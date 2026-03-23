// =========================================================
// File: pairOptimizer.js
// =========================================================

import {
  getBoundingBox,
  translate,
  rotatePolygon,
  polygonsOverlap,
  normalizeToOrigin
} from './polygonUtils.js';

export class PairOptimizer {
  constructor(config = {}) {
    this.spacing = config.spacing ?? 3;
    this.translationStep = Math.max(0.5, config.translationStep ?? 1);
    this.rotationAngles = Array.isArray(config.rotationAngles) && config.rotationAngles.length
      ? [...new Set(config.rotationAngles)]
      : [0, 90, 180];
    this.binaryIterations = Math.max(8, config.binaryIterations ?? 12);
    this.repeatCount = Math.max(3, config.repeatCount ?? 4);
  }

  optimize(poly1, poly2, label1 = 'L', label2 = 'R') {
    const base1 = normalizeToOrigin(poly1);
    const base2 = normalizeToOrigin(poly2);
    
    // Lưu Cache góc xoay để loại bỏ phép biến đổi ma trận thừa
    const cachedP1 = this.rotationAngles.map(angle => {
      const p = normalizeToOrigin(rotatePolygon(base1, angle * Math.PI / 180));
      return { angle, poly: p, bb: getBoundingBox(p) };
    });
    
    const cachedP2 = this.rotationAngles.map(angle => {
      const p = normalizeToOrigin(rotatePolygon(base2, angle * Math.PI / 180));
      return { angle, poly: p, bb: getBoundingBox(p) };
    });

    const results = [];

    for (const item1 of cachedP1) {
      for (const item2 of cachedP2) {
        const fit = this._findTightFit(item1.poly, item1.bb, item2.poly, item2.bb);
        if (!fit) continue;

        const scored = this._scoreCandidate({
          type: `${label1}-${label2}`,
          angle1: item1.angle,
          angle2: item2.angle,
          offset: fit.offset,
          bbox: fit.bbox,
          area: fit.area,
          polyA: item1.poly,
          polyB: translate(item2.poly, fit.offset.x, fit.offset.y)
        });
        results.push(scored);
      }
    }

    return results.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.area - b.area;
    });
  }

  _scoreCandidate(candidate) {
    const w = Math.max(1e-6, candidate.bbox.width);
    const h = Math.max(1e-6, candidate.bbox.height);
    const area = Math.max(1e-6, candidate.area);

    const compactScore = 1 / area;
    const rowHeightScore = 1 / h;
    const horizontalScore = w / h;
    const alignmentScore = 1 / (1 + Math.abs(candidate.offset.y));
    const repeatScore = this._simulateRowRepeat(candidate, this.repeatCount);
    const gapScore = this._estimateGapFriendliness(candidate);

    const rowScore = rowHeightScore * 0.60 + horizontalScore * 0.25 + alignmentScore * 0.15;
    const totalScore =
      compactScore * 0.18 +
      rowScore * 0.34 +
      repeatScore * 0.30 +
      gapScore * 0.10 +
      alignmentScore * 0.08;

    return {
      ...candidate,
      compactScore,
      rowScore,
      repeatScore,
      gapScore,
      alignmentScore,
      totalScore
    };
  }

  _simulateRowRepeat(candidate, count = 4) {
    const w = Math.max(1e-6, candidate.bbox.width);
    const h = Math.max(1e-6, candidate.bbox.height);
    const rowW = w * count;
    const rowH = h;
    const density = (count * 2) / Math.max(1e-6, rowW * rowH);
    const straightness = 1 / h;
    const staggerPenalty = Math.max(0, Math.abs(candidate.offset.y) - h * 0.15);
    const staggerScore = 1 / (1 + staggerPenalty);
    return density * 0.45 + straightness * 0.30 + staggerScore * 0.25;
  }

  _estimateGapFriendliness(candidate) {
    const w = Math.max(1e-6, candidate.bbox.width);
    const h = Math.max(1e-6, candidate.bbox.height);
    const offsetY = Math.abs(candidate.offset.y);
    const lowProfile = 1 / h;
    const horizontalBias = w / h;
    const offsetScore = 1 / (1 + offsetY);
    return lowProfile * 0.40 + horizontalBias * 0.30 + offsetScore * 0.30;
  }

  _findTightFit(polyA, bbA, polyB, bbB) {
    let best = null;
    const minY = -bbB.height;
    const maxY = bbA.height;

    for (let dy = minY; dy <= maxY; dy += this.translationStep) {
      const safeX = bbA.width + this.spacing + this.translationStep;
      if (polygonsOverlap(polyA, polyB, { x: 0, y: 0 }, { x: safeX, y: dy }, this.spacing, bbA, bbB)) {
        continue;
      }

      let low = -bbB.width - this.spacing;
      let high = safeX;
      let bestSafeX = safeX;

      for (let i = 0; i < this.binaryIterations; i++) {
        // Early Exit: Độ chênh < 0.25mm sẽ bị nuốt bởi GridStep >= 1mm, không cần lặp thêm
        if (high - low < 0.25) break;
        
        const mid = (low + high) / 2;
        if (polygonsOverlap(polyA, polyB, { x: 0, y: 0 }, { x: mid, y: dy }, this.spacing, bbA, bbB)) {
          low = mid;
        } else {
          bestSafeX = mid;
          high = mid;
        }
      }

      const bbox = this._getCombinedBBox(bbA, bbB, bestSafeX, dy);
      const area = bbox.width * bbox.height;
      if (!best || area < best.area) {
        best = {
          offset: { x: bestSafeX, y: dy },
          bbox,
          area
        };
      }
    }

    return best;
  }

  _getCombinedBBox(bbA, bbB, dx, dy) {
    const minX = Math.min(0, dx);
    const minY = Math.min(0, dy);
    const maxX = Math.max(bbA.width, dx + bbB.width);
    const maxY = Math.max(bbA.height, dy + bbB.height);
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }
}

export default PairOptimizer;
