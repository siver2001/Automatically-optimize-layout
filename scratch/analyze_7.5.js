import fs from 'fs';
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
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Intercept _finalizeCandidate to see how many placements it has before/after alignment
  const originalFinalize = engine._finalizeCandidate;
  engine._finalizeCandidate = function(candidate, config, workWidth, workHeight, fastOnly, validate) {
    if (!candidate || !candidate.placements) return null;
    const initialCount = candidate.placements.length;
    
    // Call align
    let alignedPlacements = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight, candidate.sizeName);
    const alignedCount = alignedPlacements.length;
    
    // Call resolve overlap
    let resolvedPlacements = this._resolveOverlapPlacements(alignedPlacements, config.spacing || 0);
    const resolvedCount = resolvedPlacements.length;
    
    const res = originalFinalize.call(this, candidate, config, workWidth, workHeight, fastOnly, validate);
    
    const countPieces = (placements) => placements.reduce((sum, p) => {
      const f = p.orient?.foot || 'X';
      const isHalf = f.startsWith('split-') || f === 'L' || f === 'R';
      return sum + (isHalf ? 1 : 2);
    }, 0);

    const initialPieces = countPieces(candidate.placements);
    const resolvedPieces = res ? countPieces(res.placements) : 0;

    if (initialPieces >= 90) {
      console.log(`[Debug 7.5] Size: ${candidate.sizeName || 'unknown'} | Placements: ${initialCount} -> ${resolvedCount} | Pieces: ${initialPieces} -> ${resolvedPieces} | Finalized: ${res ? 'SUCCESS' : 'FAILED'}`);
      if (res && resolvedPieces < initialPieces) {
        // Find which placements were lost
        const initialIds = candidate.placements.map(p => p.id);
        const finalIds = res.placements.map(p => p.id);
        const lost = initialIds.filter(id => !finalIds.includes(id));
        console.log(`  -> Lost placements: ${lost.join(', ')}`);
      }
    }
    return res;
  };

  const shape = shapes.find(s => String(s.sizeName || s.name) === '7.5');
  if (!shape) {
    console.error('Size 7.5 not found');
    return;
  }

  console.log('Running test for Size 7.5...');
  const res = await engine.testCapacity([shape], config);
  console.log('Result for Size 7.5:', res.summary[0]);
}

run().catch(console.error);
