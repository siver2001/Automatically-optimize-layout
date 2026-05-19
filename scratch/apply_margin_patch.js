import fs from 'fs';
import path from 'path';

const filePath = 'c:\\Users\\long.nh\\Desktop\\Automatically-optimize-layout\\server\\algorithms\\diecut\\strategies\\capacity\\double-contour\\CapacityTestDoubleInsoleDoubleContourPattern.js';

let content = fs.readFileSync(filePath, 'utf8');

const targetFunction = `  _fillMarginHalves(sizeName, polygon, candidate, config, workWidth, workHeight) {
    if (!candidate?.placements?.length) return candidate;



    const step = Math.min(0.1, (config.gridStep || 1) / 2);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    
    const orientVariants = [];
    for (const angle of this._getSplitFillAngles(config)) {
      const halfDefs = buildSplitHalfDefinitions(
        sourceShape?.polygon || polygon,
        sourceShape?.internals?.[0] || []
      );
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }

    orientVariants.sort((left, right) =>
      left.height - right.height
      || left.width - right.width
      || (left.angle || 0) - (right.angle || 0)
    );

    let allPlacements = [...candidate.placements];
    const wholeBounds = this._getWholePlacementBounds(allPlacements);
    if (!wholeBounds) return candidate;

    let marginPlacementsCount = 0;
    let addedAny = true;

    while (addedAny && marginPlacementsCount < 20) {
      addedAny = false;
      let bestOverallCandidate = null;
      let bestOverallOrient = null;
      let bestOverallScore = Infinity;

      // Performance: Build spatial index once per while iteration, not per variant
      const spacing = config.spacing || 0;
      const spatialIndex = this._buildSpatialIndex(allPlacements, workWidth, workHeight, spacing);
      
      for (const orient of orientVariants) {
        const candidatePos = this._findBestMarginSplitPlacement(
          allPlacements,
          orient,
          wholeBounds,
          workWidth,
          workHeight,
          config,
          step,
          spatialIndex
        );
        if (candidatePos) {
          const score = this._scorePreparedEdgePlacementCandidate(
            candidatePos,
            orient,
            workWidth,
            workHeight,
            allPlacements,
            wholeBounds,
            spacing
          );
          if (score < bestOverallScore) {
            bestOverallScore = score;
            bestOverallCandidate = candidatePos;
            bestOverallOrient = orient;
          }
        }
      }

      if (bestOverallCandidate) {
        const placement = {
          id: `margin_fill_${marginPlacementsCount++}`,
          orient: bestOverallOrient,
          x: bestOverallCandidate.x,
          y: bestOverallCandidate.y,
          effectiveArea: bestOverallOrient.areaMm2
        };
        allPlacements.push(placement);
        addedAny = true;
      }
    }

    if (marginPlacementsCount === 0) return candidate;

    const usedAreaMm2 = allPlacements.reduce((sum, p) => sum + (p.effectiveArea || p.orient?.areaMm2 || 0), 0);
    const pairStats = this._getSplitPlacementPairStats(
      allPlacements.filter(p => p.id?.startsWith('split_fill_') || p.id?.startsWith('margin_fill_'))
    );

    const augmented = this._buildCandidate(
      sizeName,
      candidate.selectedFoot ?? candidate.foot ?? 'L',
      candidate.pieceArea,
      allPlacements,
      {
        ...(candidate.patternInfo || {}),
        splitFillUsed: true,
        splitFillCount: (candidate.patternInfo?.splitFillCount || 0) + marginPlacementsCount,
        bodyCount: candidate.bodyCount ?? candidate.dcCount ?? getWholePlacementCount(candidate),
        ...pairStats,
        usedAreaMm2
      },
      workWidth,
      workHeight,
      config
    );

    if (!augmented) return candidate;
    const finalized = this._finalizeCandidate(augmented, config, workWidth, workHeight, false);
    return finalized || candidate;
  }`;

const replacement = `  _findMaxValidYForTopMargin(orient, x, minY, maxY, allPlacements, config, workWidth, workHeight, spatialIndex) {
    let lastValidY = null;
    const step = Math.max(0.5, config.gridStep || 1);
    
    // We scan Y from minY (top edge) downwards.
    for (let y = minY; y <= maxY + 1e-6; y += step) {
      if (this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, false)) {
        lastValidY = y;
      } else {
        // Once we hit a collision when moving downwards, stop.
        break;
      }
    }
    return lastValidY;
  }

  _findMinValidXForRightMargin(orient, y, minX, maxX, allPlacements, config, workWidth, workHeight, spatialIndex) {
    let lastValidX = null;
    const step = Math.max(0.5, config.gridStep || 1);
    
    // We scan X from maxX (right edge) leftwards (decreasing X).
    for (let x = maxX; x >= minX - 1e-6; x -= step) {
      if (this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, false)) {
        lastValidX = x;
      } else {
        // Once we hit a collision when moving leftwards, stop.
        break;
      }
    }
    return lastValidX;
  }

  _fillMarginHalves(sizeName, polygon, candidate, config, workWidth, workHeight) {
    if (!candidate?.placements?.length) return candidate;

    const step = Math.min(0.1, (config.gridStep || 1) / 2);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    
    const orientVariants = [];
    for (const angle of this._getSplitFillAngles(config)) {
      const halfDefs = buildSplitHalfDefinitions(
        sourceShape?.polygon || polygon,
        sourceShape?.internals?.[0] || []
      );
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }

    orientVariants.sort((left, right) =>
      left.height - right.height
      || left.width - right.width
      || (left.angle || 0) - (right.angle || 0)
    );

    let allPlacements = [...candidate.placements];
    const wholeBounds = this._getWholePlacementBounds(allPlacements);
    if (!wholeBounds) return candidate;

    const spacing = config.spacing || 0;
    const gridStep = Math.max(0.5, config.gridStep || 1);

    // --- PHASE 1: TOP MARGIN (Arrow 1: Left-to-Right, Squeezed DOWNWARDS) ---
    const topOrients = orientVariants.filter(o => o.splitOutwardSide === 'top');
    let marginPlacementsCount = 0;
    let addedAny = true;

    while (addedAny && marginPlacementsCount < 30) {
      addedAny = false;
      let bestOverallCandidate = null;
      let bestOverallOrient = null;
      let bestOverallScore = Infinity;

      const spatialIndex = this._buildSpatialIndex(allPlacements, workWidth, workHeight, spacing);

      // Build Top Margin X candidates
      const topXs = [];
      const seenX = new Set();
      const addTopX = (x) => {
        const rounded = roundMetric(x, 3);
        if (rounded < 0 || rounded > workWidth || seenX.has(rounded)) return;
        seenX.add(rounded);
        topXs.push(rounded);
      };

      // Add sheet left edge, right edge, and grid-aligned positions
      addTopX(0);
      addTopX(workWidth);
      
      const scanStepX = Math.max(2.0, gridStep * 2);
      for (let x = 0; x <= workWidth; x += scanStepX) {
        addTopX(x);
      }

      // Add alignment anchors relative to already placed pieces
      for (const p of allPlacements) {
        const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pMinX = p.x + bb.minX;
        const pMaxX = p.x + bb.maxX;
        
        addTopX(pMinX);
        addTopX(pMaxX);
        addTopX(pMaxX + spacing);
        addTopX(pMinX - spacing);
      }

      // Now, for each top-oriented piece and each X candidate:
      for (const orient of topOrients) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        const minY = -bb.minY; // Top edge of the sheet
        const maxScanY = wholeBounds.maxY;

        for (const x of topXs) {
          // Check horizontal bounds
          if (x + bb.minX < -1e-6 || x + bb.maxX > workWidth + 1e-6) continue;

          // Find the maximum valid Y (compaction downwards)
          const validY = this._findMaxValidYForTopMargin(
            orient,
            x,
            minY,
            maxScanY,
            allPlacements,
            config,
            workWidth,
            workHeight,
            spatialIndex
          );

          if (validY !== null) {
            // Arrow 1: Left-to-Right, so smaller x is much better.
            // Squeezed downwards: larger validY is better.
            const score = x * 1000 - validY * 10;
            if (score < bestOverallScore) {
              bestOverallScore = score;
              bestOverallCandidate = { x, y: validY };
              bestOverallOrient = orient;
            }
          }
        }
      }

      if (bestOverallCandidate) {
        const placement = {
          id: \`margin_fill_top_\${marginPlacementsCount++}\`,
          orient: bestOverallOrient,
          x: bestOverallCandidate.x,
          y: bestOverallCandidate.y,
          effectiveArea: bestOverallOrient.areaMm2,
          isSplit: true
        };
        allPlacements.push(placement);
        addedAny = true;
      }
    }

    // --- PHASE 2: RIGHT MARGIN (Arrow 2: Bottom-to-Top, Squeezed LEFTWARDS) ---
    const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
    addedAny = true;

    while (addedAny && marginPlacementsCount < 60) {
      addedAny = false;
      let bestOverallCandidate = null;
      let bestOverallOrient = null;
      let bestOverallScore = Infinity;

      const spatialIndex = this._buildSpatialIndex(allPlacements, workWidth, workHeight, spacing);

      // Build Right Margin Y candidates
      const rightYs = [];
      const seenY = new Set();
      const addRightY = (y) => {
        const rounded = roundMetric(y, 3);
        if (rounded < 0 || rounded > workHeight || seenY.has(rounded)) return;
        seenY.add(rounded);
        rightYs.push(rounded);
      };

      // Add sheet top edge, bottom edge, and grid-aligned positions
      addRightY(0);
      addRightY(workHeight);
      
      const scanStepY = Math.max(2.0, gridStep * 2);
      for (let y = 0; y <= workHeight; y += scanStepY) {
        addRightY(y);
      }

      // Add alignment anchors relative to already placed pieces
      for (const p of allPlacements) {
        const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pMinY = p.y + bb.minY;
        const pMaxY = p.y + bb.maxY;
        
        addRightY(pMinY);
        addRightY(pMaxY);
        addRightY(pMaxY + spacing);
        addRightY(pMinY - spacing);
      }

      // Now, for each right-oriented piece and each Y candidate:
      for (const orient of rightOrients) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        const maxScanX = workWidth - bb.maxX; // Right edge of the sheet

        for (const y of rightYs) {
          // Check vertical bounds
          if (y + bb.minY < -1e-6 || y + bb.maxY > workHeight + 1e-6) continue;

          // Find the leftmost valid X (compaction leftwards)
          const validX = this._findMinValidXForRightMargin(
            orient,
            y,
            wholeBounds.minX,
            maxScanX,
            allPlacements,
            config,
            workWidth,
            workHeight,
            spatialIndex
          );

          if (validX !== null) {
            // Arrow 2: Bottom-to-Top, so larger y is much better (closer to bottom).
            // Squeezed leftwards: smaller validX is better.
            const score = (workHeight - y) * 1000 + validX * 10;
            if (score < bestOverallScore) {
              bestOverallScore = score;
              bestOverallCandidate = { x: validX, y };
              bestOverallOrient = orient;
            }
          }
        }
      }

      if (bestOverallCandidate) {
        const placement = {
          id: \`margin_fill_right_\${marginPlacementsCount++}\`,
          orient: bestOverallOrient,
          x: bestOverallCandidate.x,
          y: bestOverallCandidate.y,
          effectiveArea: bestOverallOrient.areaMm2,
          isSplit: true
        };
        allPlacements.push(placement);
        addedAny = true;
      }
    }

    if (marginPlacementsCount === 0) return candidate;

    const usedAreaMm2 = allPlacements.reduce((sum, p) => sum + (p.effectiveArea || p.orient?.areaMm2 || 0), 0);
    const pairStats = this._getSplitPlacementPairStats(
      allPlacements.filter(p => p.id?.startsWith('margin_fill_') || p.isSplit)
    );

    const augmented = this._buildCandidate(
      sizeName,
      candidate.selectedFoot ?? candidate.foot ?? 'L',
      candidate.pieceArea,
      allPlacements,
      {
        ...(candidate.patternInfo || {}),
        splitFillUsed: true,
        splitFillCount: (candidate.patternInfo?.splitFillCount || 0) + marginPlacementsCount,
        bodyCount: candidate.bodyCount ?? candidate.dcCount ?? getWholePlacementCount(candidate),
        ...pairStats,
        usedAreaMm2
      },
      workWidth,
      workHeight,
      config
    );

    if (!augmented) return candidate;
    const finalized = this._finalizeCandidate(augmented, config, workWidth, workHeight, false);
    return finalized || candidate;
  }`;

// Standardize newlines to LF for clean comparison
const cleanText = (str) => str.replace(/\r\n/g, '\n').trim();

const cleanContent = cleanText(content);
const cleanTarget = cleanText(targetFunction);
const cleanReplacement = cleanText(replacement);

if (cleanContent.includes(cleanTarget)) {
  const index = cleanContent.indexOf(cleanTarget);
  // Re-read original, but perform the replacement on the original string with LF or CRLF
  // To be safe, we replace it in the string directly
  let updatedContent = content.replace(/\r\n/g, '\n').replace(cleanTarget, cleanReplacement);
  // Write back
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  console.log("Successfully patched _fillMarginHalves!");
} else {
  console.error("Target function _fillMarginHalves not found in file content!");
}
