import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { computeEnvelope } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function run() {
  clearCapacityResultCache();
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size4_5 = shapes.find(shape => (shape.sizeName || shape.name) === '4.5');
  if (!size4_5) {
    console.error('Size 4.5 not found');
    return;
  }

  const runAnalysis = async (width, height) => {
    console.log(`\n=== DETAIL ANALYSIS FOR ${width}x${height} ===`);
    const config = {
      sheetWidth: width,
      sheetHeight: height,
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

    // Monkeypatch _buildCandidate
    const origBuildCandidate = engine._buildCandidate;
    engine._buildCandidate = function(sizeName, foot, pieceArea, placements, metadata, workWidth, workHeight, config) {
      const res = origBuildCandidate.call(this, sizeName, foot, pieceArea, placements, metadata, workWidth, workHeight, config);
      
      const relAngle = Math.abs(metadata.bodyPrimaryAngle - metadata.bodyAlternateAngle);
      // Log candidates that have 56 placements or are close, to see their details
      if (placements.length >= 50 && (metadata.bodyPrimaryAngle === 0 || metadata.bodyAlternateAngle === 180)) {
        console.log(`[Build Candidate] input placements=${placements.length}, relAngle=${relAngle}, bodyCols=${metadata.bodyCols}, bodyRows=${metadata.bodyRows}, bodyDyMm=${metadata.bodyDyMm?.toFixed(2)}, rowShiftXmm=${metadata.rowShiftXmm?.toFixed(2)} -> result=${res ? 'SUCCESS' : 'NULL'}`);
        if (!res) {
          const bounds = computeEnvelope(placements);
          console.log(`  - Reject Reason: bounds.maxX=${bounds.maxX.toFixed(1)} > workWidth=${workWidth} or bounds.maxY=${bounds.maxY.toFixed(1)} > workHeight=${workHeight}`);
        }
      }
      return res;
    };

    // Monkeypatch addRankedCandidate
    const origEvaluateFootCandidateForAngles = engine._evaluateFootCandidateForAngles;
    engine._evaluateFootCandidateForAngles = function(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
      console.log(`[Angles Check] starting evaluation for angles: ${angles}`);
      const best = origEvaluateFootCandidateForAngles.call(this, sizeName, foot, polygon, config, workWidth, workHeight, angles);
      return best;
    };

    await engine.testCapacity([size4_5], config);
  };

  await runAnalysis(1070, 1970);
  await runAnalysis(1080, 1980);
}

run().catch(console.error);
