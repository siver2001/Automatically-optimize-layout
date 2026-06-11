import { performance } from 'perf_hooks';

// Setup mock board and raster
const bCols = 2140;
const bRows = 3940;
const board = new Uint8Array(bCols * bRows);

// Let's populate the board with some values
for (let i = 0; i < board.length; i += 17) {
  board[i] = 1;
}

const raster = {
  cols: 80,
  rows: 40,
  cells: new Uint8Array(80 * 40),
  activeOffsets: []
};

// Populate raster cells (e.g. 40% filled)
for (let r = 0; r < raster.rows; r++) {
  const rOff = r * raster.cols;
  for (let c = 0; c < raster.cols; c++) {
    if ((r - 20) ** 2 + (c - 40) ** 2 < 15 ** 2) {
      raster.cells[rOff + c] = 1;
      raster.activeOffsets.push({ r, c });
    }
  }
}

// Pre-calculate flat offsets
const bColsTest = bCols;
const flat = new Int32Array(raster.activeOffsets.length);
for (let i = 0; i < raster.activeOffsets.length; i++) {
  flat[i] = raster.activeOffsets[i].r * bColsTest + raster.activeOffsets[i].c;
}
raster.flatOffsetsCache = new Map([[bColsTest, flat]]);

// Old check collision
function _checkCollisionOld(board, bCols, bRows, raster, bx, by) {
  if (bx < 0 || by < 0 || bx + raster.cols > bCols || by + raster.rows > bRows) return true;
  for (let r = 0; r < raster.rows; r++) {
    const bOff = (by + r) * bCols + bx;
    const rOff = r * raster.cols;
    for (let c = 0; c < raster.cols; c++) {
      if (raster.cells[rOff + c] && board[bOff + c]) return true;
    }
  }
  return false;
}

// New check collision
function _checkCollisionNew(board, bCols, bRows, raster, bx, by) {
  if (bx < 0 || by < 0 || bx + raster.cols > bCols || by + raster.rows > bRows) return true;
  const flat = raster.flatOffsetsCache.get(bCols);
  const base = by * bCols + bx;
  const len = flat.length;
  for (let i = 0; i < len; i++) {
    if (board[base + flat[i]]) return true;
  }
  return false;
}

// Run benchmark
const iterations = 5000000;
const bx = 1000;
const by = 2000;

console.log(`Running benchmark with ${iterations.toLocaleString()} iterations...`);

// Test old
const startOld = performance.now();
let countOld = 0;
for (let i = 0; i < iterations; i++) {
  if (_checkCollisionOld(board, bCols, bRows, raster, bx, by)) {
    countOld++;
  }
}
const endOld = performance.now();

// Test new
const startNew = performance.now();
let countNew = 0;
for (let i = 0; i < iterations; i++) {
  if (_checkCollisionNew(board, bCols, bRows, raster, bx, by)) {
    countNew++;
  }
}
const endNew = performance.now();

console.log(`Old Collision Check: ${(endOld - startOld).toFixed(2)} ms (collisions: ${countOld})`);
console.log(`New Collision Check: ${(endNew - startNew).toFixed(2)} ms (collisions: ${countNew})`);
console.log(`Speedup factor: ${( (endOld - startOld) / (endNew - startNew) ).toFixed(2)}x`);
