
export class FastGrid {
    constructor(width, height, cellSize, capacity) {
        this.width = width;
        this.height = height;
        this.cellSize = cellSize;
        this.gridW = Math.ceil(width / cellSize);
        this.gridH = Math.ceil(height / cellSize);

        // Grid Head: Points to the first Node index for each cell
        this.heads = new Int32Array(this.gridW * this.gridH).fill(-1);

        this.maxNodes = capacity * 9;
        this.nodes = new Int32Array(this.maxNodes * 2);
        this.nodeCount = 0;

        // Rect Data: [x, y, w, h]
        this.rects = new Float64Array(capacity * 4);
        this.rectCount = 0;
    }

    add(rect) {
        if (this.rectCount >= this.rects.length / 4) return; // Full

        const rIdx = this.rectCount++;
        this.rects[rIdx * 4 + 0] = rect.x;
        this.rects[rIdx * 4 + 1] = rect.y;
        this.rects[rIdx * 4 + 2] = rect.width;
        this.rects[rIdx * 4 + 3] = rect.length;

        const startX = Math.floor(rect.x / this.cellSize);
        const endX = Math.floor((rect.x + rect.width - 0.1) / this.cellSize);
        const startY = Math.floor(rect.y / this.cellSize);
        const endY = Math.floor((rect.y + rect.length - 0.1) / this.cellSize);

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (x >= 0 && x < this.gridW && y >= 0 && y < this.gridH) {
                    const cellIdx = y * this.gridW + x;

                    // Create new node
                    if (this.nodeCount >= this.maxNodes) return;
                    const nIdx = this.nodeCount++;

                    this.nodes[nIdx * 2 + 0] = rIdx; // Payload: Rect Index
                    this.nodes[nIdx * 2 + 1] = this.heads[cellIdx]; // Next: Current Head
                    this.heads[cellIdx] = nIdx; // Head points to new node
                }
            }
        }
    }

    collides(rect) {
        const startX = Math.floor(rect.x / this.cellSize);
        const endX = Math.floor((rect.x + rect.width - 0.1) / this.cellSize);
        const startY = Math.floor(rect.y / this.cellSize);
        const endY = Math.floor((rect.y + rect.length - 0.1) / this.cellSize);

        const rx = rect.x;
        const ry = rect.y;
        const rw = rect.width;
        const rh = rect.length;

        // Use a set or marker to avoid checking same rect multiple times? 
        // For simple collision, we can just check. Duplicate checks are cheap vs Set overhead.

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (x >= 0 && x < this.gridW && y >= 0 && y < this.gridH) {
                    const cellIdx = y * this.gridW + x;
                    let nIdx = this.heads[cellIdx];

                    while (nIdx !== -1) {
                        const rIdx = this.nodes[nIdx * 2 + 0];
                        const ox = this.rects[rIdx * 4 + 0];
                        const oy = this.rects[rIdx * 4 + 1];
                        const ow = this.rects[rIdx * 4 + 2];
                        const oh = this.rects[rIdx * 4 + 3];

                        if (rx < ox + ow && rx + rw > ox && ry < oy + oh && ry + rh > oy) {
                            return true;
                        }

                        nIdx = this.nodes[nIdx * 2 + 1];
                    }
                }
            }
        }
        return false;
    }
}
