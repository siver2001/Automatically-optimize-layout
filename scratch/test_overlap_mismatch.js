import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { validateLocalPlacements, cachedPolygonsOverlap, roundMetric } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size6 = shapes.find(s => s.sizeName === '6');
  
  const config = {
    spacing: 3,
    gridStep: 0.5
  };
  const step = 0.5;

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  const filler90Angle = 90;
  const filler90Orient = engine._decorateOrient('6', 'X', size6.polygon, filler90Angle, config, step);
  
  const dxMm = engine._findUniformDx(filler90Orient, config, step);
  console.log(`_findUniformDx returned dxMm = ${dxMm}`);
  
  const bb = filler90Orient.bb || getBoundingBox(filler90Orient.polygon);
  
  // 1. Coordinates with 2-decimal rounding (default for roundMetric without 2nd arg)
  const x1_2dec = roundMetric(1 * dxMm);
  const x2_2dec = roundMetric(2 * dxMm);
  console.log(`2-decimal rounded: x1 = ${x1_2dec}, x2 = ${x2_2dec}, deltaX = ${x2_2dec - x1_2dec}`);
  
  const overlap_2dec = cachedPolygonsOverlap(
    filler90Orient.polygon,
    filler90Orient.polygon,
    { x: x1_2dec, y: 0 },
    { x: x2_2dec, y: 0 },
    config.spacing,
    bb,
    bb
  );
  console.log(`Overlap check with 2-decimal rounded: ${overlap_2dec}`);

  // 2. Coordinates with 3-decimal rounding
  const x1_3dec = roundMetric(1 * dxMm, 3);
  const x2_3dec = roundMetric(2 * dxMm, 3);
  console.log(`3-decimal rounded: x1 = ${x1_3dec}, x2 = ${x2_3dec}, deltaX = ${x2_3dec - x1_3dec}`);
  
  const overlap_3dec = cachedPolygonsOverlap(
    filler90Orient.polygon,
    filler90Orient.polygon,
    { x: x1_3dec, y: 0 },
    { x: x2_3dec, y: 0 },
    config.spacing,
    bb,
    bb
  );
  console.log(`Overlap check with 3-decimal rounded: ${overlap_3dec}`);
}

run().catch(console.error);
