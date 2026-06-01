import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    preparedSplitFillDeep: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Patch spacing check and axis candidates limit
  const originalCanPlace = engine._canPlaceSplitOrient;
  engine._canPlaceSplitOrient = function(occupiedPlacements, orient, x, y, conf, ...args) {
    const paddedConfig = { ...conf, spacing: (conf.spacing || 0) + 0.01 };
    return originalCanPlace.call(this, occupiedPlacements, orient, x, y, paddedConfig, ...args);
  };

  const originalAlign = engine._alignMarginSplits;
  engine._alignMarginSplits = function(placements, conf, ...args) {
    const paddedConfig = { ...conf, spacing: (conf.spacing || 0) + 0.01 };
    return originalAlign.call(this, placements, paddedConfig, ...args);
  };

  engine._buildPreparedRectPlacementCandidates = function(rect, orient, step) {
    const getBoundingBox = (poly) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    };
    
    // We import buildAxisCandidates from utils
    const buildAxisCandidates = (minValue, maxValue, step, pieceDim = 0, limit = 15) => {
      const clampedMax = Math.max(minValue, maxValue);
      const span = Math.max(0, clampedMax - minValue);
      const safeStep = Math.max(0.5, step || 1);
      const values = new Set([minValue, clampedMax]);
      const targetStep = pieceDim > 0 ? Math.max(safeStep, pieceDim / 4) : safeStep * 10;
      const sampleCount = Math.min(limit, Math.ceil(span / targetStep) + 1);

      const quantize = (val) => {
        const q = Math.round(val / safeStep) * safeStep;
        return Math.max(0, Math.min(clampedMax, q));
      };

      if (sampleCount > 2) {
        for (let i = 1; i < sampleCount; i++) {
          const ratio = i / sampleCount;
          values.add(quantize(minValue + span * ratio));
        }
      }
      return [...values].sort((a, b) => a - b);
    };

    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = rect.x - bb.minX;
    const minY = rect.y - bb.minY;
    const maxX = rect.x + rect.width - bb.maxX;
    const maxY = rect.y + rect.height - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    // Snap to borders/center (limit = 3)
    const xs = buildAxisCandidates(minX, maxX, step, orient.width, 3);
    const ys = buildAxisCandidates(minY, maxY, step, orient.height, 3);

    return [...new Set(xs.flatMap((x) => ys.map((y) => `${x}|${y}`)))]
      .map((key) => {
        const [x, y] = key.split('|').map(Number);
        return { x, y };
      });
  };

  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  })).sort((a, b) => parseFloat(a.sizeName) - parseFloat(b.sizeName));

  console.log(`Running benchmark on ${testSizes.length} sizes...`);
  const start = performance.now();
  const res = await engine.testCapacity(testSizes, config);
  const end = performance.now();
  console.log(`Time taken: ${((end - start) / 1000).toFixed(2)}s`);

  console.log("\n=== BENCHMARK RESULTS ===");
  for (const item of (res.summary || [])) {
    console.log(`Size: ${item.sizeName.padEnd(5)} | Pairs: ${String(item.pairs).padEnd(5)} | Efficiency: ${item.efficiency.toFixed(1)}%`);
  }
}

run().catch(console.error);
