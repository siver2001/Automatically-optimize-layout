import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { validateLocalPlacements } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size6 = shapes.find(s => s.sizeName === '6');
  
  const config1080 = {
    sheetWidth: 1080,
    sheetHeight: 1980,
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

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config1080);
  
  // Spy inside _evaluateFootCandidateForAngles
  const originalEvaluate = engine._evaluateFootCandidateForAngles;
  engine._evaluateFootCandidateForAngles = function(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    // We will patch _finalizeCandidate inside the scope of this evaluation to log details for angle 0
    const originalFinalize = this._finalizeCandidate;
    this._finalizeCandidate = function(candidate, config, wW, wH, fastOnly, validate) {
      const res = originalFinalize.call(this, candidate, config, wW, wH, fastOnly, validate);
      const primAngle = candidate.bodyPrimaryAngle ?? candidate.patternInfo?.bodyPrimaryAngle;
      const altAngle = candidate.bodyAlternateAngle ?? candidate.patternInfo?.bodyAlternateAngle;
      
      if (primAngle === 0 && altAngle === 0) {
        if (!res) {
          // Find out why it was null
          let alignedPlacements = this._alignMarginSplits(candidate.placements, config, wW, wH, candidate.sizeName);
          alignedPlacements = this._resolveOverlapPlacements(alignedPlacements, config.spacing || 0);
          const bounds = this._alignMarginSplits ? {} : null; // dummy
          
          let boundsOk = true;
          if (alignedPlacements.length > 0) {
            const b = alignedPlacements.reduce((acc, p) => {
              const bb = p.orient?.bb || { minX:0, maxX:0, minY:0, maxY:0 };
              return {
                minX: Math.min(acc.minX, p.x + bb.minX),
                maxX: Math.max(acc.maxX, p.x + bb.maxX),
                minY: Math.min(acc.minY, p.y + bb.minY),
                maxY: Math.max(acc.maxY, p.y + bb.maxY)
              };
            }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
            if (b.minX < -1e-6 || b.minY < -1e-6 || b.maxX > wW + 1e-6 || b.maxY > wH + 1e-6) {
              boundsOk = false;
            }
          }
          let overlapValid = true;
          if (validate && alignedPlacements.length > 1) {
            overlapValid = validateLocalPlacements(alignedPlacements, config.spacing || 0).valid;
          }
          console.log(`[SPY Finalize Fail] placements=${candidate.placements.length}, alignedPlacements=${alignedPlacements.length}, boundsOk=${boundsOk}, overlapValid=${overlapValid}`);
        } else {
          console.log(`[SPY Finalize Success] placements=${candidate.placements.length}, finalizedPairs=${res.actualPairs}`);
        }
      }
      return res;
    };

    const result = originalEvaluate.call(this, sizeName, foot, polygon, config, workWidth, workHeight, angles);
    this._finalizeCandidate = originalFinalize; // restore
    return result;
  };

  const res = await engine.testCapacity([size6], config1080);
  console.log(`\nResult Size 6: ${res.summary[0].pairs} pairs`);
}

run().catch(console.error);
