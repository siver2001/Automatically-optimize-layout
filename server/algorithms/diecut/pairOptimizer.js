
import { 
    getBoundingBox, 
    translate, 
    rotatePolygon, 
    polygonsOverlap, 
    normalizeToOrigin,
    area,
    flipX
} from './polygonUtils.js';

export class PairOptimizer {
    constructor(config = {}) {
        this.spacing = config.spacing || 1;
        this.rotationStep = config.rotationStep || 15; 
        this.translationStep = config.translationStep || 1; 
    }

    /**
     * Tìm tổ hợp tốt nhất cho 2 đa giác bất kỳ
     */
    optimize(poly1, poly2, label1 = 'P1', label2 = 'P2') {
        const base1 = normalizeToOrigin(poly1);
        const base2 = normalizeToOrigin(poly2);

        const results = [];
        const angles = [0, 90, 180, 270];

        for (const angleA of angles) {
            const p1 = normalizeToOrigin(rotatePolygon(base1, angleA * Math.PI / 180));
            const bb1 = getBoundingBox(p1);

            for (const angleB of angles) {
                const p2 = normalizeToOrigin(rotatePolygon(base2, angleB * Math.PI / 180));
                const bb2 = getBoundingBox(p2);

                const result = this._findTightFit(p1, bb1, p2, bb2);
                
                if (result) {
                    results.push({
                        ...result,
                        angle1: angleA,
                        angle2: angleB,
                        polyA: p1,
                        polyB: translate(p2, result.offset.x, result.offset.y),
                        type: `${label1}-${label2}`
                    });
                }
            }
        }

        return results.sort((a, b) => a.area - b.area);
    }


    _findTightFit(polyA, bbA, polyB, bbB) {
        let bestLocal = { area: Infinity, offset: { x: 0, y: 0 } };

        // Chỉ thử các độ lệch Y trong dải hẹp hơn (thường chúng gối lên nhau)
        // Thử dy từ -bbB.height/2 đến bbA.height/2 có lẽ là đủ cho lót giày? 
        // Không, lót giày có thể lệch hẳn. Giữ nguyên start/end nhưng bước lớn hơn.
        const stepY = this.translationStep;
        
        for (let dy = -bbB.height; dy <= bbA.height; dy += stepY) {
            // Dùng profile-based slide để tìm DX nhanh hơn
            // (Tạm thời dùng binary search để tìm x va chạm thay vì trượt tuyến tính)
            let highX = bbA.width + this.spacing;
            let lowX = -bbB.width;
            
            // Nếu ngay tại highX đã va chạm (thường là không), bỏ qua
            if (polygonsOverlap(polyA, polyB, {x:0, y:0}, {x:highX, y:dy}, this.spacing, bbA, bbB)) continue;

            // Binary search để tìm x sát nhất (10 iterations ~ 0.2mm precision)
            let lastSafeX = highX;
            for (let i = 0; i < 10; i++) { 
                let midX = (highX + lowX) / 2;
                if (polygonsOverlap(polyA, polyB, {x:0, y:0}, {x:midX, y:dy}, this.spacing, bbA, bbB)) {
                    lowX = midX;
                } else {
                    lastSafeX = midX;
                    highX = midX;
                }
            }

            const combinedBBox = this._getCombinedBBox(bbA, bbB, lastSafeX, dy);
            const combinedArea = combinedBBox.width * combinedBBox.height;

            if (combinedArea < bestLocal.area) {
                bestLocal = { area: combinedArea, offset: { x: lastSafeX, y: dy }, bbox: combinedBBox };
            }
        }

        return bestLocal.area === Infinity ? null : bestLocal;
    }

    _getCombinedBBox(bbA, bbB, dx, dy) {
        const minX = Math.min(0, dx);
        const minY = Math.min(0, dy);
        const maxX = Math.max(bbA.width, dx + bbB.width);
        const maxY = Math.max(bbA.height, dy + bbB.height);
        return { width: maxX - minX, height: maxY - minY, minX, minY, maxX, maxY };
    }
}
