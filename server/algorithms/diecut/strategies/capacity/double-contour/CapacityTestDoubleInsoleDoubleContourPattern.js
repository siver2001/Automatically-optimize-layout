import { CapacityTestPrePairedSameSidePattern } from '../CapacityTestPrePairedSameSidePattern.js';
import { CapacityTestSameSidePattern, findMinimalContinuousValue } from '../CapacityTestSameSidePattern.js';
import { DOUBLE_CONTOUR_ALGORITHM_VERSION } from '../capacityVersion.js';
import { buildSplitHalfDefinitions } from '../splittingUtils.js';
import {
  getBoundingBox,
  normalizeToOrigin,
  area as polygonArea,
  rotatePolygon,
  translate
} from '../../../core/polygonUtils.js';
import {
  cachedPolygonsOverlap,
  computeEnvelope,
  getOrientBounds,
  roundMetric,
  validateLocalPlacements
} from '../patternCapacityUtils.js';
import {
  buildCapacityResultCacheKey,
  getCachedCapacityResult,
  setCachedCapacityResult
} from '../capacityResultCache.js';
import {
  orderTasksByEstimatedWeight,
  resolveAdaptiveParallelWorkerCount
} from '../parallelCapacityUtils.js';

import {
  DEFAULT_DOUBLE_CONTOUR_FINE_ROTATE_OFFSETS,
  getWholePairsPlaced,
  computeLeftoverMetricsFromBounds,
  attachLeftoverMetrics,
  compareDoubleInsoleCandidates,
  buildShiftCandidates,
  extractInternalGapShiftCandidates,
  selectPrimaryRowShiftCandidates,
  addRankedCandidate,
  buildFillerRowCountChoices,
  shouldTryFillerRowCombination,
  rankDoubleContourVariant,
  buildRowShiftPairs,
  buildAxisCandidates,
  buildDenseAxisCandidates,
  rotateVector,
  resolveAxisSideFromVector,
  normalizeAngleDegrees,
  getPlacementsTop,
  getPlacementsBottom,
  getPlacementsLeft,
  getPlacementsRight,
  getAveragePitchX,
  getWholePlacementCount,
  shouldUseParallelDoubleContourCapacity,
  executeDoubleContourTasksInParallel
} from "./utils.js";

export class CapacityTestDoubleInsoleDoubleContourPattern extends CapacityTestPrePairedSameSidePattern {
  _getDoubleContourFineRotateOffsets(config = {}) {
    return [0];
  }

  _getDoubleContourPreferredAngles() {
    // As requested: Only 0 and 90 degrees.
    return [0, 90];
  }

  _buildShiftedUniformNeighborhood(orient, dxMm, rowPitchMm, rowShiftXmm = 0, rowShiftYmm = 0) {
    const placements = [];
    const sampleRows = 3;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < sampleCols; col++) {
        placements.push({
          id: `double_insole_shift_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm + shiftX, 3),
          y: roundMetric(row * rowPitchMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _findShiftedUniformDy(orient, dxMm, rowShiftXmm, rowShiftYmm, config, step) {
    // Balanced precision for performance and "khít" (tightness)
    const precision = 0.02;
    const upper = Math.max(
      step,
      orient.height * 2 + Math.abs(rowShiftYmm) + config.spacing + step * 10
    );

    const spacing = config.spacing || 0;
    const bb = orient.bb || getOrientBounds(orient);

    const validatePitch = (dy) => {
      // Smart Neighborhood: 3 rows and 5 columns is sufficient to detect 
      // all local interlocking for uniform staggered grids.
      const neighborhood = [];
      const rows = 3; 
      const cols = 5; 
      
      for (let r = 0; r < rows; r++) {
        const isOddRow = (r % 2 === 1);
        const shiftX = isOddRow ? rowShiftXmm : 0;
        const shiftY = isOddRow ? rowShiftYmm : 0;
        const baseY = r * dy + shiftY;
        
        for (let c = 0; c < cols; c++) {
          neighborhood.push({
            x: roundMetric(c * dxMm + shiftX, 3),
            y: roundMetric(baseY, 3),
            orient: orient,
            bb: bb
          });
        }
      }
      
      return validateLocalPlacements(neighborhood, spacing).valid;
    };

    const res = findMinimalContinuousValue(step, upper, precision, validatePitch);
    return res;
  }

  _findShiftedRowPitch(rowPlacements, rowShiftXmm, rowShiftYmm, config, step) {
    if (!rowPlacements.length) return null;
    const spacing = config.spacing || 0;
    const precision = 0.02;
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const minDeltaY = step;
    const upper = Math.max(
      step,
      rowBottom - rowTop + Math.abs(rowShiftYmm) + spacing + step * 10
    );

    const validatePitch = (dy) => {
      const neighborhood = [];
      const rows = 3; 
      for (let r = 0; r < rows; r++) {
        const isOddRow = (r % 2 === 1);
        const shiftX = isOddRow ? rowShiftXmm : 0;
        const shiftY = isOddRow ? rowShiftYmm : 0;
        const rowBaseY = r * dy + shiftY;
        
        for (const p of rowPlacements) {
          neighborhood.push({
            ...p,
            x: roundMetric(p.x + shiftX, 3),
            y: roundMetric(p.y + rowBaseY, 3),
            orient: p.orient,
            bb: p.orient.bb || getOrientBounds(p.orient)
          });
        }
      }
      return validateLocalPlacements(neighborhood, spacing).valid;
    };

    const res = findMinimalContinuousValue(minDeltaY, upper, precision, validatePitch);
    return res;
  }



  _buildShiftedUniformPlacements(orient, cols, rows, dxMm, dyMm, rowShiftXmm = 0, rowShiftYmm = 0, startY = 0, alternateOrient = null, config = {}) {
    const placements = [];
    const baseX = rowShiftXmm < 0 ? -rowShiftXmm : 0;
    const baseY = startY - Math.min(0, rowShiftYmm);

    // Track the "bottom boundary" of the previous row for adaptive dropping

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < cols; col++) {
        const isOddCol = col % 2 === 1;
        const currentOrient = (isOddCol && alternateOrient) ? alternateOrient : orient;
        const x = roundMetric(baseX + col * dxMm + shiftX, 3);
        const y = roundMetric(baseY + row * dyMm + shiftY, 3);
        
        placements.push({
          id: `double_insole_${row}_${col}`,
          orient: currentOrient,
          x,
          y
        });
      }
    }

    return placements;
  }

  _buildRepeatedBodyPlacements(rowPlacements, rows, dyMm, startY = 0, rowShiftXmm = 0, rowShiftYmm = 0, startX = 0) {
    const placements = [];
    const baseX = startX;
    const baseY = startY;

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (const p of rowPlacements) {
        placements.push({
          ...p,
          id: `double_insole_${row}_${p.id}`,
          x: roundMetric(baseX + p.x + shiftX, 3),
          y: roundMetric(baseY + row * dyMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _buildUniformPlacementsAtX(orient, cols, rows, dxMm, dyMm, startX = 0, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(startX + col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _decorateSplitHalfOrient(sizeName, halfDef, angle, config, step) {
    const orient = this._getOrient(
      {
        sizeName,
        foot: halfDef.key,
        polygon: halfDef.polygon
      },
      angle,
      step,
      config.spacing
    );
    const rawRotatedHalf = rotatePolygon(halfDef.polygon, angle * Math.PI / 180);
    const rawHalfBounds = getBoundingBox(rawRotatedHalf);
    const splitOutwardVector = rotateVector(halfDef.splitOutwardVector || { x: 1, y: 0 }, angle);

    return {
      ...orient,
      foot: halfDef.key,
      bb: orient.bb || getBoundingBox(orient.polygon),
      width: orient.bb?.width ?? getBoundingBox(orient.polygon).width,
      height: orient.bb?.height ?? getBoundingBox(orient.polygon).height,
      areaMm2: halfDef.areaMm2,
      splitPairAngleFamily: normalizeAngleDegrees(angle) % 180,
      splitOutwardVector,
      splitOutwardSide: resolveAxisSideFromVector(splitOutwardVector),
      cycPolygon: translate(
        rotatePolygon(halfDef.cycSourcePolygon, angle * Math.PI / 180),
        -rawHalfBounds.minX,
        -rawHalfBounds.minY
      )
      };
    }

  _squeezePlacements(placements, config, workWidth, workHeight) {
    if (!placements.length) return [];
    const spacing = config.spacing || 0;
    const step = config.gridStep || 1;
    
    // Sort by Y then X to squeeze towards the bottom-left corner
    const sorted = [...placements].sort((a, b) => a.y - b.y || a.x - b.x);
    const squeezed = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      let currentX = item.x;
      let currentY = item.y;
      
      // Build spatialIndex ONCE for this piece because the `squeezed` array is static during the binary search of this piece!
      const spatialIndex = this._buildSpatialIndex(squeezed, workWidth, workHeight, spacing);
      
      const isSplit = item.isSplit || item.id?.includes('split') || item.id?.startsWith('margin_fill_');
      const isRightSplit = isSplit && (item.id?.includes('right') || item.orient?.splitOutwardSide === 'right');
      const isLeftSplit = isSplit && (item.id?.includes('left') || item.orient?.splitOutwardSide === 'left');
      const isTopSplit = isSplit && (item.id?.includes('top') || item.orient?.splitOutwardSide === 'top');
      const isBottomSplit = isSplit && (item.id?.includes('bottom') || item.orient?.splitOutwardSide === 'bottom');

      // Binary search for the minimum valid X
      let lowX = 0;
      let highX = currentX;
      let lastValidX = currentX;
      
      // Do not squeeze X if it's a top or bottom split (they should remain snapped to their columns)
      if (!isTopSplit && !isBottomSplit) {
        while (lowX <= highX) {
          const midX = roundMetric((lowX + highX) / 2, 3);
          if (this._canPlaceSplitOrient(squeezed, item.orient, midX, currentY, config, workWidth, workHeight, spatialIndex, true)) {
            lastValidX = midX;
            highX = midX - step;
          } else {
            lowX = midX + step;
          }
        }
      }
      currentX = lastValidX;
      
      // Binary search for the minimum valid Y
      let lowY = 0;
      let highY = currentY;
      let lastValidY = currentY;
      
      // Do not squeeze Y if it's a left or right split (they should remain snapped to their rows)
      if (!isRightSplit && !isLeftSplit) {
        while (lowY <= highY) {
          const midY = roundMetric((lowY + highY) / 2, 3);
          if (this._canPlaceSplitOrient(squeezed, item.orient, currentX, midY, config, workWidth, workHeight, spatialIndex, true)) {
            lastValidY = midY;
            highY = midY - step;
          } else {
            lowY = midY + step;
          }
        }
      }
      currentY = lastValidY;
      
      squeezed.push({
        ...item,
        x: roundMetric(currentX, 3),
        y: roundMetric(currentY, 3)
      });
    }
    
    return this._alignMarginSplits(squeezed, config, workWidth, workHeight);
  }

  _findBestAlignedX(placements, rightSplits, workWidth, workHeight, config) {
    if (!rightSplits.length) return null;
    
    let minX = Infinity;
    let maxX = -Infinity;
    for (const item of rightSplits) {
      if (item.p.x < minX) minX = item.p.x;
      if (item.p.x > maxX) maxX = item.p.x;
    }
    
    if (maxX - minX < 1e-3) return minX;
    
    // Instead of random steps, test exactly the current X coordinates of the splits to snap them to a single straight column
    const candidates = [...new Set(rightSplits.map(rs => roundMetric(rs.p.x, 3)))];
    let bestX = null;
    
    for (const targetX of candidates) {
      const testPlacements = placements.map(p => {
        const isTarget = rightSplits.some(rs => rs.p === p);
        if (isTarget) {
          return { ...p, x: targetX };
        }
        return p;
      });
      
      const bounds = computeEnvelope(testPlacements);
      if (
        bounds.minX < -1e-6 ||
        bounds.minY < -1e-6 ||
        bounds.maxX > workWidth + 1e-6 ||
        bounds.maxY > workHeight + 1e-6
      ) {
        continue;
      }
      
      const validation = validateLocalPlacements(testPlacements, config.spacing || 0);
      if (validation.valid) {
        if (bestX === null || targetX < bestX) {
          bestX = targetX;
        }
      }
    }
    
    return bestX;
  }

  _findBestAlignedY(placements, bottomSplits, workWidth, workHeight, config) {
    if (!bottomSplits.length) return null;
    
    let minY = Infinity;
    let maxY = -Infinity;
    for (const item of bottomSplits) {
      if (item.p.y < minY) minY = item.p.y;
      if (item.p.y > maxY) maxY = item.p.y;
    }
    
    if (maxY - minY < 1e-3) return minY;
    
    // Test exact current Y coordinates to snap them to a single straight row
    const candidates = [...new Set(bottomSplits.map(bs => roundMetric(bs.p.y, 3)))];
    let bestY = null;
    
    for (const targetY of candidates) {
      const testPlacements = placements.map(p => {
        const isTarget = bottomSplits.some(bs => bs.p === p);
        if (isTarget) {
          return { ...p, y: targetY };
        }
        return p;
      });
      
      const bounds = computeEnvelope(testPlacements);
      if (
        bounds.minX < -1e-6 ||
        bounds.minY < -1e-6 ||
        bounds.maxX > workWidth + 1e-6 ||
        bounds.maxY > workHeight + 1e-6
      ) {
        continue;
      }
      
      const validation = validateLocalPlacements(testPlacements, config.spacing || 0);
      if (validation.valid) {
        if (bestY === null || targetY < bestY) {
          bestY = targetY;
        }
      }
    }
    
    return bestY;
  }

  _alignMarginSplits(placements, config, workWidth, workHeight) {
    if (!placements.length) return placements;
    
    const rightMarginSplits = [];
    const bottomMarginSplits = [];
    const gridStep = config.gridStep || 0.5;
    
    for (const p of placements) {
      if (!this._isSplitFillPlacement(p)) continue;
      
      const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
      const isRightMargin = p.x + bb.maxX > workWidth - 350;
      const isBottomMargin = p.y + bb.maxY > workHeight - 350;
      const isVertical = bb.height > bb.width;
      const isHorizontal = bb.width > bb.height;
      
      if (isRightMargin && isVertical) {
        rightMarginSplits.push({ p, bb });
      } else if (isBottomMargin && isHorizontal) {
        bottomMarginSplits.push({ p, bb });
      }
    }
    
    let currentPlacements = [...placements];
    
    // ==========================================
    // STEP 1: RIGHT-MARGIN COLUMN COMPACTION (SQUEEZE LEFT)
    // ==========================================
    const bestAlignedX = rightMarginSplits.length > 1
      ? this._findBestAlignedX(currentPlacements, rightMarginSplits, workWidth, workHeight, config)
      : null;
      
    let finalAlignedX = bestAlignedX;
    if (finalAlignedX === null && rightMarginSplits.length === 1) {
      finalAlignedX = rightMarginSplits[0].p.x;
    }
    
    if (finalAlignedX !== null && rightMarginSplits.length > 0) {
      let lowX = Math.max(0, finalAlignedX - 150); // Squeeze leftwards by at most 150mm
      let highX = finalAlignedX;
      let lastValidX = finalAlignedX;
      
      while (lowX <= highX) {
        const midX = roundMetric((lowX + highX) / 2, 3);
        
        const testPlacements = currentPlacements.map(p => {
          const isTarget = rightMarginSplits.some(rs => rs.p.id === p.id);
          if (isTarget) {
            return { ...p, x: midX };
          }
          return p;
        });
        
        const bounds = computeEnvelope(testPlacements);
        const inBounds = bounds.minX >= -1e-6 && bounds.maxX <= workWidth + 1e-6 &&
                         bounds.minY >= -1e-6 && bounds.maxY <= workHeight + 1e-6;
                         
        if (inBounds && validateLocalPlacements(testPlacements, config.spacing || 0).valid) {
          lastValidX = midX;
          highX = midX - gridStep; // Try to squeeze tighter leftwards
        } else {
          lowX = midX + gridStep;
        }
      }
      finalAlignedX = lastValidX;
      
      // Update state for right splits to feed into bottom row compaction
      currentPlacements = currentPlacements.map(p => {
        const isTarget = rightMarginSplits.some(rs => rs.p.id === p.id);
        if (isTarget) {
          return { ...p, x: finalAlignedX };
        }
        return p;
      });
      
      console.log(`[AlignMarginSplits] Right-margin column squeezed from ${bestAlignedX !== null ? bestAlignedX.toFixed(2) : 'NONE'} to ${finalAlignedX.toFixed(2)}`);
    }

    // ==========================================
    // STEP 2: BOTTOM-MARGIN ROW COMPACTION (SQUEEZE UP)
    // ==========================================
    const bestAlignedY = bottomMarginSplits.length > 1
      ? this._findBestAlignedY(currentPlacements, bottomMarginSplits, workWidth, workHeight, config)
      : null;
      
    let finalAlignedY = bestAlignedY;
    if (finalAlignedY === null && bottomMarginSplits.length === 1) {
      finalAlignedY = bottomMarginSplits[0].p.y;
    }
    
    if (finalAlignedY !== null && bottomMarginSplits.length > 0) {
      let lowY = Math.max(0, finalAlignedY - 150); // Squeeze upwards by at most 150mm
      let highY = finalAlignedY;
      let lastValidY = finalAlignedY;
      
      while (lowY <= highY) {
        const midY = roundMetric((lowY + highY) / 2, 3);
        
        const testPlacements = currentPlacements.map(p => {
          const isTarget = bottomMarginSplits.some(bs => bs.p.id === p.id);
          if (isTarget) {
            return { ...p, y: midY };
          }
          return p;
        });
        
        const bounds = computeEnvelope(testPlacements);
        const inBounds = bounds.minX >= -1e-6 && bounds.maxX <= workWidth + 1e-6 &&
                         bounds.minY >= -1e-6 && bounds.maxY <= workHeight + 1e-6;
                         
        if (inBounds && validateLocalPlacements(testPlacements, config.spacing || 0).valid) {
          lastValidY = midY;
          highY = midY - gridStep; // Try to squeeze tighter upwards
        } else {
          lowY = midY + gridStep;
        }
      }
      finalAlignedY = lastValidY;
      
      // Update state for bottom splits
      currentPlacements = currentPlacements.map(p => {
        const isTarget = bottomMarginSplits.some(bs => bs.p.id === p.id);
        if (isTarget) {
          return { ...p, y: finalAlignedY };
        }
        return p;
      });
      
      console.log(`[AlignMarginSplits] Bottom-margin row squeezed from ${bestAlignedY !== null ? bestAlignedY.toFixed(2) : 'NONE'} to ${finalAlignedY.toFixed(2)}`);
    }
    
    return currentPlacements;
  }






  _filterPlacementsInBounds(placements, workWidth, workHeight) {
    return placements.filter((p) => {
      const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
      return p.x + bb.minX >= -1e-6 &&
        p.x + bb.maxX <= workWidth + 1e-6 &&
        p.y + bb.minY >= -1e-6 &&
        p.y + bb.maxY <= workHeight + 1e-6;
    });
  }

  _getSplitFillAngles(config = {}) {
    if (Array.isArray(config.preparedSplitFillAngles) && config.preparedSplitFillAngles.length) {
      return [...new Set(
        config.preparedSplitFillAngles
          .map((angle) => Number(angle))
          .filter((angle) => Number.isFinite(angle))
          .map((angle) => normalizeAngleDegrees(angle))
      )];
    }

    // Half pieces are directional, so 180/270 can unlock gaps that the base layout does not need.
    const baseAngles = config.allowRotate90 === false
      ? [0, 180]
      : [0, 90, 180, 270];
    const offsets = this._getDoubleContourFineRotateOffsets(config);
    const angles = [];

    for (const baseAngle of baseAngles) {
      for (const offset of offsets) {
        angles.push(normalizeAngleDegrees(baseAngle + offset));
      }
    }

    return [...new Set(angles)];
  }

  _getPlacementBounds(placement) {
    const bb = placement?.orient?.bb || getBoundingBox(placement?.orient?.polygon || []);
    return {
      minX: roundMetric(placement.x + bb.minX, 3),
      minY: roundMetric(placement.y + bb.minY, 3),
      maxX: roundMetric(placement.x + bb.maxX, 3),
      maxY: roundMetric(placement.y + bb.maxY, 3),
      width: roundMetric(bb.width, 3),
      height: roundMetric(bb.height, 3)
    };
  }

  _splitPreparedFreeRect(rect, bounds, spacing = 0) {
    if (!rect || !bounds) return [];

    const rectMaxX = rect.x + rect.width;
    const rectMaxY = rect.y + rect.height;
    const occupiedMinX = Math.max(rect.x, bounds.minX - spacing);
    const occupiedMinY = Math.max(rect.y, bounds.minY - spacing);
    const occupiedMaxX = Math.min(rectMaxX, bounds.maxX + spacing);
    const occupiedMaxY = Math.min(rectMaxY, bounds.maxY + spacing);

    if (occupiedMinX >= occupiedMaxX || occupiedMinY >= occupiedMaxY) {
      return [rect];
    }

    const candidates = [
      { x: rect.x, y: rect.y, width: occupiedMinX - rect.x, height: rect.height },
      { x: occupiedMaxX, y: rect.y, width: rectMaxX - occupiedMaxX, height: rect.height },
      { x: rect.x, y: rect.y, width: rect.width, height: occupiedMinY - rect.y },
      { x: rect.x, y: occupiedMaxY, width: rect.width, height: rectMaxY - occupiedMaxY }
    ];

    return candidates
      .map((candidate) => ({
        x: roundMetric(candidate.x, 3),
        y: roundMetric(candidate.y, 3),
        width: roundMetric(candidate.width, 3),
        height: roundMetric(candidate.height, 3)
      }))
      .filter((candidate) =>
        candidate.width > 5 && candidate.height > 5
      );
  }

  _normalizePreparedFreeRects(freeRects = []) {
    // Adaptive Threshold: Ignore rectangles too small to fit even a fragment of the piece
    const minSize = 10; 
    const normalized = freeRects
      .filter((rect) => rect.width > minSize && rect.height > minSize)
      .sort((left, right) =>
        right.width * right.height - left.width * left.height
        || left.y - right.y
        || left.x - right.x
      );

    const unique = [];
    // Dynamic Limit: More rectangles for complex layouts, fewer for simple ones
    const maxRects = 64; 
    for (const rect of normalized) {
      const contained = unique.some((other) =>
        rect.x >= other.x - 1e-6 &&
        rect.y >= other.y - 1e-6 &&
        rect.x + rect.width <= other.x + other.width + 1e-6 &&
        rect.y + rect.height <= other.y + other.height + 1e-6
      );
      if (!contained) unique.push(rect);
      if (unique.length >= maxRects) break;
    }

    return unique;
  }

  _buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, spacing = 0) {
    let freeRects = [{
      x: 0,
      y: 0,
      width: workWidth,
      height: workHeight
    }];

    const occupiedBounds = occupiedPlacements
      .map((placement) => this._getPlacementBounds(placement))
      .sort((left, right) =>
        (right.width * right.height) - (left.width * left.height)
        || left.minY - right.minY
        || left.minX - right.minX
      );

    for (const bounds of occupiedBounds) {
      const nextRects = [];
      for (const rect of freeRects) {
        nextRects.push(...this._splitPreparedFreeRect(rect, bounds, spacing));
      }
      freeRects = this._normalizePreparedFreeRects(nextRects);
      if (!freeRects.length) break;
    }

    return freeRects;
  }

  _buildPreparedRectPlacementCandidates(rect, orient, step) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = rect.x - bb.minX;
    const minY = rect.y - bb.minY;
    const maxX = rect.x + rect.width - bb.maxX;
    const maxY = rect.y + rect.height - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const xs = buildAxisCandidates(minX, maxX, step, orient.width);
    const ys = buildAxisCandidates(minY, maxY, step, orient.height);

    return [...new Set(xs.flatMap((x) => ys.map((y) => `${x}|${y}`)))]
      .map((key) => {
        const [x, y] = key.split('|').map(Number);
        return { x, y };
      });
  }



  _isSplitFillPlacement(placement) {
    const id = placement?.id || '';
    const foot = placement?.orient?.foot || placement?.foot || '';
    return id.startsWith('split_fill_')
      || id.startsWith('margin_fill_')
      || foot.startsWith('split-')
      || placement?.isSplit === true;
  }

  _getWholePlacementBounds(placements) {
    const wholePlacements = (placements || []).filter((placement) =>
      !this._isSplitFillPlacement(placement)
    );
    return wholePlacements.length ? computeEnvelope(wholePlacements) : null;
  }

  _getMarginSideForBounds(bounds, wholeBounds, spacing = 0) {
    if (!bounds || !wholeBounds) return null;
    const tolerance = Math.max(1, spacing + 12);
    const overlapsWholeX = bounds.maxX > wholeBounds.minX - tolerance
      && bounds.minX < wholeBounds.maxX + tolerance;
    const overlapsWholeY = bounds.maxY > wholeBounds.minY - tolerance
      && bounds.minY < wholeBounds.maxY + tolerance;

    if (overlapsWholeX && (
      bounds.maxY <= wholeBounds.minY + tolerance ||
      bounds.minY <= wholeBounds.minY + tolerance
    )) {
      return 'top';
    }
    if (overlapsWholeY && bounds.minX >= wholeBounds.maxX - tolerance) {
      return 'right';
    }
    return null;
  }

  _scorePreparedEdgePlacementCandidate(candidate, orient, workWidth, workHeight, existingPlacements = [], wholeBounds = null, spacing = 0) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = candidate.x + bb.minX;
    const minY = candidate.y + bb.minY;
    const maxX = candidate.x + bb.maxX;
    const maxY = candidate.y + bb.maxY;

    if (wholeBounds) {
      const bounds = { minX, minY, maxX, maxY };
      const side = this._getMarginSideForBounds(bounds, wholeBounds, spacing);
      if (!side) return Infinity;

      const bodyGap = side === 'top'
        ? Math.max(0, wholeBounds.minY - maxY)
        : Math.max(0, minX - wholeBounds.maxX);
      const sideOrder = side === 'top' ? 0 : 1;
      const arrowOrder = side === 'top'
        ? minX
        : -maxY;

      let splitGap = 1000;
      for (const other of existingPlacements.slice(-40)) {
        if (!this._isSplitFillPlacement(other)) continue;
        const otherBounds = this._getPlacementBounds(other);
        const horizontalGap = Math.max(0, otherBounds.minX - maxX, minX - otherBounds.maxX);
        const verticalGap = Math.max(0, otherBounds.minY - maxY, minY - otherBounds.maxY);
        splitGap = Math.min(splitGap, Math.sqrt(horizontalGap * horizontalGap + verticalGap * verticalGap));
      }

      return bodyGap * 10000
        + sideOrder * 1000
        + splitGap * 4
        + arrowOrder * 0.05
        + (side === 'right' ? Math.abs(maxY - wholeBounds.maxY) * 0.01 : 0);
    }
    
    const preferredSide = orient?.splitOutwardSide || null;
    const sideDistances = {
      left: Math.abs(minX),
      right: Math.abs(workWidth - maxX),
      top: Math.abs(minY),
      bottom: Math.abs(workHeight - maxY)
    };
    
    const preferredDistance = preferredSide ? sideDistances[preferredSide] ?? 0 : 0;
    const nearestEdgeDistance = Math.min(
      sideDistances.left,
      sideDistances.right,
      sideDistances.top,
      sideDistances.bottom
    );

    // Stronger proximity scoring to encourage tight clustering of split pieces
    let proximityBonus = 0;
    if (existingPlacements && existingPlacements.length > 0) {
      let minGap = 1000;
      let minSplitGap = 1000;
      
      // Sample existing placements
      const sampleCount = Math.min(20, existingPlacements.length);
      for (let i = 0; i < sampleCount; i++) {
        const other = existingPlacements[existingPlacements.length - 1 - i];
        const dx = candidate.x - other.x;
        const dy = candidate.y - other.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < minGap) minGap = dist;
        // Extra bonus for being near another split piece
        if (other.id?.startsWith('split_fill') || other.id?.startsWith('margin_fill')) {
          if (dist < minSplitGap) minSplitGap = dist;
        }
      }
      
      proximityBonus = (minGap * 0.2) + (minSplitGap * 0.4);
    } else {
      // If first piece, prefer corners
      proximityBonus = (minX + minY) * 0.1;
    }
        let finalScore = (
      preferredDistance * 0.4 +
      nearestEdgeDistance * 0.3 +
      proximityBonus * 1.5 + 
      candidate.y * 0.01 +   
      candidate.x * 0.005    
    );

    if (orient.isSplit || orient.foot?.startsWith('split')) {
      if (preferredSide === 'top') {
        // Top margin: Deep valleys (larger Y) are heavily prioritized (lower score is better)
        finalScore = -candidate.y * 1000 + candidate.x * 0.1;
      } else if (preferredSide === 'right') {
        // Right margin: Deep valleys leftwards (smaller X) are heavily prioritized
        finalScore = candidate.x * 1000 + (workHeight - candidate.y) * 0.1;
      }
    }

    return finalScore;
  }

  _findUniformDx(orient, config, step) {

    const spacing = config.spacing || 0;
    const precision = 0.02;
    const upper = Math.max(step, orient.width * 2 + spacing + step * 8);

    const result = findMinimalContinuousValue(step, upper, precision, (dxMm) => {
      const neighborhood = [];
      const bb = orient.bb || getOrientBounds(orient);
      for (let col = 0; col < 6; col++) {
        neighborhood.push({
          x: roundMetric(col * dxMm, 3),
          y: 0,
          orient: orient,
          bb: bb
        });
      }
      const res = validateLocalPlacements(neighborhood, spacing).valid;
      return res;
    });
    return result;
  }

  _findUniformDy(orient, dxMm, config, step) {
    const spacing = config.spacing || 0;
    const precision = 0.02;
    const upper = Math.max(step, orient.height * 2 + spacing + step * 8);

    return findMinimalContinuousValue(step, upper, precision, (dyMm) => {
      const neighborhood = this._buildUniformNeighborhood(orient, dxMm, dyMm);
      return validateLocalPlacements(neighborhood, spacing).valid;
    });
  }

  _findSequentialRowPitch(rowPlacements, config, step) {
    if (!rowPlacements.length) return null;
    const spacing = config.spacing || 0;
    const precision = 0.02;
    const rowBottom = getPlacementsBottom(rowPlacements);
    const rowTop = getPlacementsTop(rowPlacements);
    const upper = Math.max(step, (rowBottom - rowTop) * 2 + spacing + step * 8);

    return findMinimalContinuousValue(step, upper, precision, (deltaY) => {
      const neighborhood = [];
      // 3 rows is sufficient for sequential pitch
      for (let r = 0; r < 3; r++) {
        for (const p of rowPlacements) {
          neighborhood.push({
            ...p,
            id: `r${r}_${p.id}`,
            y: roundMetric(p.y + r * deltaY, 3)
          });
        }
      }
      return validateLocalPlacements(neighborhood, spacing).valid;
    });
  }

  _findAlignedBodyDx(primaryOrient, alternateOrient, config, step) {
    const sizeVal = parseFloat(primaryOrient.sizeName || primaryOrient.name || 0);
    const spacing = config.spacing || 0;
    const precision = 0.02;
    const upper = Math.max(
      step,
      Math.max(primaryOrient.width, alternateOrient.width) * 2 + spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) => {
      const neighborhood = [];
      const testCols = (sizeVal >= 10.5) ? 8 : 6;
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < testCols; col++) {
          const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, 'rows', row, col);
          neighborhood.push({
            x: roundMetric(col * dxMm, 3),
            y: roundMetric(row * (primaryOrient.height + spacing), 3), 
            orient: orient,
            bb: orient.bb || getOrientBounds(orient)
          });
        }
      }
      return validateLocalPlacements(neighborhood, spacing).valid;
    });
  }

  _findBestPreparedSplitPlacement(occupiedPlacements, orient, workWidth, workHeight, config, step, providedSpatialIndex = null) {
    const spacing = config.spacing || 0;
    const spatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    
    let bestCandidate = null;
    let minScore = Infinity;

    // 1. Try Rect-based candidates (Area seeking)
    const freeRects = this._buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, spacing);
    for (const rect of freeRects) {
      const candidates = this._buildPreparedRectPlacementCandidates(rect, orient, step);
      for (const candidate of candidates) {
        if (this._canPlaceSplitOrient(occupiedPlacements, orient, candidate.x, candidate.y, config, workWidth, workHeight, spatialIndex, false)) {
          const score = this._scorePreparedEdgePlacementCandidate(candidate, orient, workWidth, workHeight, occupiedPlacements);
          if (score < minScore) {
            minScore = score;
            bestCandidate = candidate;
          }
        }
      }
    }

    // 2. Try Geometric Anchors (Gap seeking)
    const anchors = this._buildGeometricVertexAnchors(occupiedPlacements, orient, workWidth, workHeight, spacing);
    for (const anchor of anchors) {
        if (this._canPlaceSplitOrient(occupiedPlacements, orient, anchor.x, anchor.y, config, workWidth, workHeight, spatialIndex, false)) {
            const score = this._scorePreparedEdgePlacementCandidate(anchor, orient, workWidth, workHeight, occupiedPlacements);
            if (score < minScore) {
                minScore = score;
                bestCandidate = anchor;
            }
        }
    }

    return bestCandidate;
  }

  _buildMarginPlacementCandidates(occupiedPlacements, orient, wholeBounds, workWidth, workHeight, config, step) {
    if (!wholeBounds) return [];

    const spacing = config.spacing || 0;
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const candidates = [];
    const seen = new Set();
    const addCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX - 1e-6 || x > maxX + 1e-6 || y < minY - 1e-6 || y > maxY + 1e-6) return;
      const roundedX = roundMetric(x, 3);
      const roundedY = roundMetric(y, 3);
      const key = `${roundedX}|${roundedY}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ x: roundedX, y: roundedY });
    };

    const axisStep = Math.max(2, step || 1, Math.min(orient.width, orient.height) / 8);
    const topY = wholeBounds.minY - spacing - bb.maxY;
    const topEdgeY = minY;
    if (topY >= minY - 1e-6 || topEdgeY <= maxY + 1e-6) {
      const topXs = [
        minX,
        wholeBounds.minX - bb.minX,
        wholeBounds.maxX - bb.maxX,
        ...buildDenseAxisCandidates(minX, maxX, axisStep, 48)
      ];
      for (const placement of occupiedPlacements) {
        if (!this._isSplitFillPlacement(placement)) continue;
        const bounds = this._getPlacementBounds(placement);
        if (bounds.maxY > wholeBounds.minY + spacing * 2 + 1) continue;
        topXs.push(bounds.maxX + spacing - bb.minX);
        topXs.push(bounds.minX - spacing - bb.maxX);
      }
      if (topY >= minY - 1e-6) {
        for (const x of topXs) addCandidate(x, topY);
      }
      for (const x of topXs) addCandidate(x, topEdgeY);
    }

    const rightX = wholeBounds.maxX + spacing - bb.minX;
    const rightEdgeX = maxX;
    if (rightX <= maxX + 1e-6 || rightEdgeX >= minX - 1e-6) {
      const rightYs = [
        maxY,
        wholeBounds.maxY - bb.maxY,
        wholeBounds.minY - bb.minY,
        ...buildDenseAxisCandidates(minY, maxY, axisStep, 48)
      ];
      for (const placement of occupiedPlacements) {
        if (!this._isSplitFillPlacement(placement)) continue;
        const bounds = this._getPlacementBounds(placement);
        if (bounds.minX < wholeBounds.maxX - spacing * 2 - 1) continue;
        rightYs.push(bounds.minY - spacing - bb.maxY);
        rightYs.push(bounds.maxY + spacing - bb.minY);
      }
      if (rightX <= maxX + 1e-6) {
        for (const y of rightYs) addCandidate(rightX, y);
      }
      for (const y of rightYs) addCandidate(rightEdgeX, y);
    }

    return candidates;
  }

  _findBestMarginSplitPlacement(occupiedPlacements, orient, wholeBounds, workWidth, workHeight, config, step, providedSpatialIndex = null) {
    const spacing = config.spacing || 0;
    const spatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    let bestCandidate = null;
    let bestScore = Infinity;

    const candidates = this._buildMarginPlacementCandidates(
      occupiedPlacements,
      orient,
      wholeBounds,
      workWidth,
      workHeight,
      config,
      step
    );

    for (const candidate of candidates) {
      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        orient,
        candidate.x,
        candidate.y,
        config,
        workWidth,
        workHeight,
        spatialIndex,
        true
      )) {
        continue;
      }

      const score = this._scorePreparedEdgePlacementCandidate(
        candidate,
        orient,
        workWidth,
        workHeight,
        occupiedPlacements,
        wholeBounds,
        spacing
      );
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  _buildGeometricVertexAnchors(occupiedPlacements, orient, workWidth, workHeight, spacing) {
      const bb = orient.bb || getBoundingBox(orient.polygon);
      const anchors = [];
      const seen = new Set();
      
    const addAnchor = (x, y) => {
      if (x < -bb.minX || x > workWidth - bb.maxX || y < -bb.minY || y > workHeight - bb.maxY) return;
      // High Precision for yield recovery
      const snap = 1.0; 
      const key = `${Math.round(x/snap)}|${Math.round(y/snap)}`;
      if (seen.has(key)) return;
      seen.add(key);
      anchors.push({ x, y });
    };

      // Add sheet corners
      addAnchor(-bb.minX, -bb.minY);
      addAnchor(workWidth - bb.maxX, -bb.minY);
      addAnchor(-bb.minX, workHeight - bb.maxY);
      addAnchor(workWidth - bb.maxX, workHeight - bb.maxY);

      // Ultra-Fast: Focus search only on the very last few placements to find gaps quickly.
      const activeLimit = 15; 
      const recentPlacements = occupiedPlacements.slice(-activeLimit);

      for (const p of recentPlacements) {
          const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
          const pMinX = p.x + pbb.minX;
          const pMaxX = p.x + pbb.maxX;
          const pMinY = p.y + pbb.minY;
          const pMaxY = p.y + pbb.maxY;

          // Try aligning our piece's bounds with existing piece's bounds + spacing
          const nudge = spacing;
          addAnchor(pMaxX + nudge - bb.minX, p.y);
          addAnchor(pMinX - nudge - bb.maxX, p.y);
          addAnchor(p.x, pMaxY + nudge - bb.minY);
          addAnchor(p.x, pMinY - nudge - bb.maxY);
          
          // Diagonal/Corner alignments
          addAnchor(pMaxX + nudge - bb.minX, pMaxY + nudge - bb.minY);
          addAnchor(pMinX - nudge - bb.maxX, pMinY - nudge - bb.maxY);
      }

      return anchors;
  }



  _buildPreparedBoundaryPlacementCandidates(orient, workWidth, workHeight, step) {
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const boundaryStep = Math.max(1, (step || 1) * 2);
    const xs = buildDenseAxisCandidates(minX, maxX, boundaryStep);
    const ys = buildDenseAxisCandidates(minY, maxY, boundaryStep);
    const preferredSide = orient?.splitOutwardSide || null;
    const sideSpecs = [
      { side: 'right', x: maxX, ys },
      { side: 'left', x: minX, ys },
      { side: 'top', y: minY, xs },
      { side: 'bottom', y: maxY, xs }
    ].sort((left, right) =>
      (right.side === preferredSide ? 1 : 0) - (left.side === preferredSide ? 1 : 0)
    );

    const keys = new Set();
    const candidates = [];
    for (const spec of sideSpecs) {
      if (spec.x != null) {
        for (const y of spec.ys) {
          const key = `${spec.x}|${y}`;
          if (keys.has(key)) continue;
          keys.add(key);
          candidates.push({ x: spec.x, y });
        }
      } else {
        for (const x of spec.xs) {
          const key = `${x}|${spec.y}`;
          if (keys.has(key)) continue;
          keys.add(key);
          candidates.push({ x, y: spec.y });
        }
      }
    }
    return candidates;
  }

  _canPlaceSplitOrient(occupiedPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex = null, skipOutwardCheck = false) {
    const spacing = config.spacing || 0;
    const bb2 = orient.bb || getBoundingBox(orient.polygon);
    const minX2 = x + bb2.minX - spacing;
    const maxX2 = x + bb2.maxX + spacing;
    const minY2 = y + bb2.minY - spacing;
    const maxY2 = y + bb2.maxY + spacing;

    // Fast bounds check against sheet
    if (
      x + bb2.minX < -1e-6 ||
      y + bb2.minY < -1e-6 ||
      x + bb2.maxX > workWidth + 1e-6 ||
      y + bb2.maxY > workHeight + 1e-6
    ) {
      return false;
    }

    if (spatialIndex && spatialIndex.grid) {
      const { grid, cellSize } = spatialIndex;
      const x1 = Math.floor((minX2 - spacing) / cellSize);
      const x2 = Math.floor((maxX2 + spacing) / cellSize);
      const y1 = Math.floor((minY2 - spacing) / cellSize);
      const y2 = Math.floor((maxY2 + spacing) / cellSize);
      
      const queryId = (spatialIndex.queryCount = (spatialIndex.queryCount || 0) + 1);

      for (let cy = y1; cy <= y2; cy++) {
        for (let cx = x1; cx <= x2; cx++) {
          const cell = grid.get(`${cx},${cy}`);
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const entry = cell[i];
            if (entry.lastQueryId === queryId) continue;
            entry.lastQueryId = queryId;

            if (entry.maxX < minX2 || entry.minX > maxX2 || entry.maxY < minY2 || entry.minY > maxY2) continue;

            if (cachedPolygonsOverlap(
              entry.p.orient.polygon,
              orient.polygon,
              { x: entry.p.x, y: entry.p.y },
              { x, y },
              spacing,
              entry.bb,
              bb2
            )) {
              return false;
            }
          }
        }
      }
    } else if (spatialIndex && spatialIndex.sortedByMaxX) {
      const { sortedByMaxX } = spatialIndex;
      for (let i = sortedByMaxX.length - 1; i >= 0; i--) {
        const entry = sortedByMaxX[i];
        if (entry.maxX < minX2) break;
        if (entry.minX > maxX2) continue;
        if (entry.maxY < minY2 || entry.minY > maxY2) continue;

        if (cachedPolygonsOverlap(
          entry.p.orient.polygon,
          orient.polygon,
          { x: entry.p.x, y: entry.p.y },
          { x, y },
          spacing,
          entry.bb,
          bb2
        )) {
          return false;
        }
      }
    }

    // CRITICAL: Check against placements that are NOT in the spatial index yet (newly added in beam search)
    // These are always at the end of the array because beam search appends them.
    if (spatialIndex && spatialIndex.indexed && occupiedPlacements.length > spatialIndex.indexed.length) {
      for (let i = occupiedPlacements.length - 1; i >= spatialIndex.indexed.length; i--) {
        const p1 = occupiedPlacements[i];
        const bb1 = p1.orient.bb || getBoundingBox(p1.orient.polygon);
        
        if (
          p1.x + bb1.maxX < minX2 ||
          p1.x + bb1.minX > maxX2 ||
          p1.y + bb1.maxY < minY2 ||
          p1.y + bb1.minY > maxY2
        ) {
          continue;
        }

        if (cachedPolygonsOverlap(
          p1.orient.polygon,
          orient.polygon,
          { x: p1.x, y: p1.y },
          { x, y },
          spacing,
          bb1,
          bb2
        )) {
          return false;
        }
      }
    }

    if (!skipOutwardCheck && !this._isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex)) {
      return false;
    }

    return true;
  }

  _isSplitLineFacingOutward(orient, x, y, occupiedPlacements, workWidth, workHeight, spatialIndex = null) {
    const splitSide = orient?.splitOutwardSide;
    if (!splitSide) return true;

    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minX = x + bb.minX;
    const minY = y + bb.minY;
    const maxX = x + bb.maxX;
    const maxY = y + bb.maxY;
    const centerX = x + (bb.minX + bb.maxX) / 2;
    const centerY = y + (bb.minY + bb.maxY) / 2;
    
    // Strict boundary proximity check: ensure the piece is actually placed at its designated boundary
    const boundaryTolerance = 350; // mm tolerance for margin alignment (increased from 250 to allow tight compaction)
    if (splitSide === 'left' && minX > boundaryTolerance) {
      return false;
    }
    if (splitSide === 'right' && maxX < workWidth - boundaryTolerance) {
      return false;
    }
    if (splitSide === 'top' && minY > boundaryTolerance) {
      return false;
    }
    if (splitSide === 'bottom' && maxY < workHeight - boundaryTolerance) {
      return false;
    }

    let corridor = null;

    if (splitSide === 'left' && minX > 1e-6) {
      corridor = { minX: 0, maxX: minX, minY, maxY };
    } else if (splitSide === 'right' && maxX < workWidth - 1e-6) {
      corridor = { minX: maxX, maxX: workWidth, minY, maxY };
    } else if (splitSide === 'top' && minY > 1e-6) {
      corridor = { minX, maxX, minY: 0, maxY: minY };
    } else if (splitSide === 'bottom' && maxY < workHeight - 1e-6) {
      corridor = { minX, maxX, minY: maxY, maxY: workHeight };
    }

    if (!corridor) return true;

    const isBlocking = (placement) => {
      // A split piece does not block another split piece in the same margin
      if (placement.isSplit || placement.id?.includes('split') || placement.id?.startsWith('margin_fill_')) {
        return false;
      }

      const pbb = placement.orient?.bb || getBoundingBox(placement.orient?.polygon || []);
      const pMinX = placement.x + pbb.minX;
      const pMaxX = placement.x + pbb.maxX;
      const pMinY = placement.y + pbb.minY;
      const pMaxY = placement.y + pbb.maxY;

      // Check if it overlaps corridor bounds
      const overlapsCorridor = !(
        pMaxX <= corridor.minX + 1e-6 ||
        pMinX >= corridor.maxX - 1e-6 ||
        pMaxY <= corridor.minY + 1e-6 ||
        pMinY >= corridor.maxY - 1e-6
      );
      if (!overlapsCorridor) return false;

      // Check if the placement belongs to a different column/row.
      // If it belongs to a different column/row, it does not block the corridor.
      const pCenterX = placement.x + (pbb.minX + pbb.maxX) / 2;
      const pCenterY = placement.y + (pbb.minY + pbb.maxY) / 2;

      if (splitSide === 'top' || splitSide === 'bottom') {
        const dist = Math.abs(pCenterX - centerX);
        const refWidth = Math.min(orient.width || bb.width, placement.orient?.width || pbb.width || 100);
        if (dist >= refWidth * 0.3) {
          return false; // Different columns, not blocking!
        }
      } else if (splitSide === 'left' || splitSide === 'right') {
        const dist = Math.abs(pCenterY - centerY);
        const refHeight = Math.min(orient.height || bb.height, placement.orient?.height || pbb.height || 100);
        if (dist >= refHeight * 0.3) {
          return false; // Different rows, not blocking!
        }
      }

      return true; // Blocks the corridor!
    };

    if (spatialIndex && spatialIndex.grid) {
      const { grid, cellSize } = spatialIndex;
      const x1 = Math.floor(corridor.minX / cellSize);
      const x2 = Math.floor(corridor.maxX / cellSize);
      const y1 = Math.floor(corridor.minY / cellSize);
      const y2 = Math.floor(corridor.maxY / cellSize);
      const queried = new Set();

      for (let cy = y1; cy <= y2; cy++) {
        for (let cx = x1; cx <= x2; cx++) {
          const cell = grid.get(`${cx},${cy}`);
          if (!cell) continue;
          for (const entry of cell) {
            if (queried.has(entry.p)) continue;
            queried.add(entry.p);
            if (isBlocking(entry.p)) return false;
          }
        }
      }
    } else if (spatialIndex && spatialIndex.sortedByMaxX) {
      const { sortedByMaxX } = spatialIndex;
      for (let i = sortedByMaxX.length - 1; i >= 0; i--) {
        const entry = sortedByMaxX[i];
        if (entry.maxX <= corridor.minX + 1e-6) break;
        if (isBlocking(entry.p)) return false;
      }
    } else {
      for (const placement of occupiedPlacements) {
        if (isBlocking(placement)) return false;
      }
    }

    return true;
  }

  _buildSpatialIndex(placements, workWidth, workHeight, spacing = 0, existingIndex = null) {
    if (existingIndex && existingIndex.grid && placements.length === existingIndex.indexed.length + 1) {
      // Incremental Update - MUST CLONE Map and affected Cells to avoid cross-branch mutation
      const newPlacement = placements[placements.length - 1];
      const bb = newPlacement.orient.bb || getBoundingBox(newPlacement.orient.polygon);
      const item = {
        p: newPlacement,
        bb,
        minX: newPlacement.x + bb.minX,
        maxX: newPlacement.x + bb.maxX,
        minY: newPlacement.y + bb.minY,
        maxY: newPlacement.y + bb.maxY
      };
      
      const { cellSize } = existingIndex;
      const grid = new Map(existingIndex.grid); // Shallow clone Map
      const x1 = Math.floor(item.minX / cellSize);
      const x2 = Math.floor(item.maxX / cellSize);
      const y1 = Math.floor(item.minY / cellSize);
      const y2 = Math.floor(item.maxY / cellSize);

      for (let cy = y1; cy <= y2; cy++) {
        for (let cx = x1; cx <= x2; cx++) {
          const key = `${cx},${cy}`;
          const cell = grid.get(key);
          if (!cell) {
            grid.set(key, [item]);
          } else {
            // Clone cell array to avoid mutating other branches sharing this cell
            grid.set(key, [...cell, item]);
          }
        }
      }
      return {
        ...existingIndex,
        grid,
        indexed: [...existingIndex.indexed, item]
      };
    }

    const indexed = placements.map(p => {
      const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
      return {
        p,
        bb,
        minX: p.x + bb.minX,
        maxX: p.x + bb.maxX,
        minY: p.y + bb.minY,
        maxY: p.y + bb.maxY
      };
    });

    if (indexed.length > 10 && workWidth && workHeight) {
      const avgWidth = indexed.reduce((sum, item) => sum + (item.maxX - item.minX), 0) / indexed.length;
      const avgHeight = indexed.reduce((sum, item) => sum + (item.maxY - item.minY), 0) / indexed.length;
      const cellSize = Math.max(20, Math.max(avgWidth, avgHeight) + spacing);
      const grid = new Map();

      for (const item of indexed) {
        const x1 = Math.floor(item.minX / cellSize);
        const x2 = Math.floor(item.maxX / cellSize);
        const y1 = Math.floor(item.minY / cellSize);
        const y2 = Math.floor(item.maxY / cellSize);

        for (let cy = y1; cy <= y2; cy++) {
          for (let cx = x1; cx <= x2; cx++) {
            const key = `${cx},${cy}`;
            let cell = grid.get(key);
            if (!cell) {
              cell = [];
              grid.set(key, cell);
            }
            cell.push(item);
          }
        }
      }

      return {
        grid,
        cellSize,
        indexed,
        queryCount: 0
      };
    }

    return {
      sortedByMaxX: indexed.sort((a, b) => a.maxX - b.maxX),
      indexed
    };
  }

  _getSplitPartnerDirection(lastPlacement, partnerOrient) {
    const lastSide = lastPlacement?.orient?.splitOutwardSide;
    const partnerSide = partnerOrient?.splitOutwardSide;
    const validPair = (
      (lastSide === 'right' && partnerSide === 'left') ||
      (lastSide === 'left' && partnerSide === 'right') ||
      (lastSide === 'bottom' && partnerSide === 'top') ||
      (lastSide === 'top' && partnerSide === 'bottom')
    );
    if (!validPair) return null;

    if (lastSide === 'right') return { axis: 'x', sign: 1 };
    if (lastSide === 'left') return { axis: 'x', sign: -1 };
    if (lastSide === 'bottom') return { axis: 'y', sign: 1 };
    if (lastSide === 'top') return { axis: 'y', sign: -1 };
    return null;
  }

  _buildSplitPartnerNearCandidates(lastPlacement, partnerOrient, workWidth, workHeight, step) {
    if (!lastPlacement || !partnerOrient) return [];

    const direction = this._getSplitPartnerDirection(lastPlacement, partnerOrient);
    if (!direction) return [];

    const lastBounds = this._getPlacementBounds(lastPlacement);
    const partnerBounds = partnerOrient.bb || getBoundingBox(partnerOrient.polygon);
    const minX = -partnerBounds.minX;
    const maxX = workWidth - partnerBounds.maxX;
    const minY = -partnerBounds.minY;
    const maxY = workHeight - partnerBounds.maxY;
    if (maxX < minX - 1e-6 || maxY < minY - 1e-6) return [];

    const safeStep = Math.max(0.5, step || 1);
    const candidates = [];
    const seen = new Set();
    const addCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const clampedX = roundMetric(Math.max(minX, Math.min(maxX, x)), 3);
      const clampedY = roundMetric(Math.max(minY, Math.min(maxY, y)), 3);
      const key = `${clampedX}|${clampedY}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ x: clampedX, y: clampedY });
    };

    const lastCenterX = (lastBounds.minX + lastBounds.maxX) / 2;
    const lastCenterY = (lastBounds.minY + lastBounds.maxY) / 2;
    const partnerCenterX = (partnerBounds.minX + partnerBounds.maxX) / 2;
    const partnerCenterY = (partnerBounds.minY + partnerBounds.maxY) / 2;

    if (direction.axis === 'x') {
      const baseX = direction.sign > 0
        ? lastBounds.maxX - partnerBounds.minX
        : lastBounds.minX - partnerBounds.maxX;
      const yAnchors = [
        lastCenterY - partnerCenterY,
        lastBounds.minY - partnerBounds.minY,
        lastBounds.maxY - partnerBounds.maxY,
        lastBounds.minY - partnerBounds.maxY,
        lastBounds.maxY - partnerBounds.minY
      ];

      for (const yAnchor of yAnchors) {
        for (let unit = -8; unit <= 8; unit++) {
          addCandidate(baseX, yAnchor + unit * safeStep);
        }
      }
    } else {
      const baseY = direction.sign > 0
        ? lastBounds.maxY - partnerBounds.minY
        : lastBounds.minY - partnerBounds.maxY;
      const xAnchors = [
        lastCenterX - partnerCenterX,
        lastBounds.minX - partnerBounds.minX,
        lastBounds.maxX - partnerBounds.maxX,
        lastBounds.minX - partnerBounds.maxX,
        lastBounds.maxX - partnerBounds.minX
      ];

      for (const xAnchor of xAnchors) {
        for (let unit = -8; unit <= 8; unit++) {
          addCandidate(xAnchor + unit * safeStep, baseY);
        }
      }
    }

    return candidates
      .sort((left, right) => {
        const leftBounds = {
          minX: left.x + partnerBounds.minX,
          minY: left.y + partnerBounds.minY,
          maxX: left.x + partnerBounds.maxX,
          maxY: left.y + partnerBounds.maxY
        };
        const rightBounds = {
          minX: right.x + partnerBounds.minX,
          minY: right.y + partnerBounds.minY,
          maxX: right.x + partnerBounds.maxX,
          maxY: right.y + partnerBounds.maxY
        };
        const leftGap = direction.axis === 'x'
          ? Math.max(0, direction.sign > 0 ? leftBounds.minX - lastBounds.maxX : lastBounds.minX - leftBounds.maxX)
          : Math.max(0, direction.sign > 0 ? leftBounds.minY - lastBounds.maxY : lastBounds.minY - leftBounds.maxY);
        const rightGap = direction.axis === 'x'
          ? Math.max(0, direction.sign > 0 ? rightBounds.minX - lastBounds.maxX : lastBounds.minX - rightBounds.maxX)
          : Math.max(0, direction.sign > 0 ? rightBounds.minY - lastBounds.maxY : rightBounds.minY - leftBounds.maxY);
        const leftCrossOffset = direction.axis === 'x'
          ? Math.abs(((leftBounds.minY + leftBounds.maxY) / 2) - lastCenterY)
          : Math.abs(((leftBounds.minX + leftBounds.maxX) / 2) - lastCenterX);
        const rightCrossOffset = direction.axis === 'x'
          ? Math.abs(((rightBounds.minY + rightBounds.maxY) / 2) - lastCenterY)
          : Math.abs(((rightBounds.minX + rightBounds.maxX) / 2) - lastCenterX);

        return leftGap - rightGap
          || leftCrossOffset - rightCrossOffset
          || left.y - right.y
          || left.x - right.x;
      })
      .slice(0, 120); // Dynamic limit for partner candidates
  }

  _alignSplitPlacementWithWholePieces(candidate, orient, occupiedPlacements, config) {
    if (!orient || !candidate) return candidate;
    
    // Only apply to split pieces
    const isSplit = orient.isSplit || orient.foot?.startsWith('split');
    if (!isSplit) return candidate;
    
    const preferredSide = orient.splitOutwardSide;
    if (!preferredSide) return candidate;
    
    // Get all whole pieces
    const wholePlacements = (occupiedPlacements || []).filter(p => !this._isSplitFillPlacement(p));
    if (!wholePlacements.length) return candidate;
    
    const bb = orient.bb || getBoundingBox(orient.polygon);
    
    if (preferredSide === 'top') {
      const candidateCenterX = candidate.x + (bb.minX + bb.maxX) / 2;
      // Find closest whole piece column
      let bestP = null;
      let minDiffX = Infinity;
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterX = p.x + (pbb.minX + pbb.maxX) / 2;
        const diffX = Math.abs(candidateCenterX - pCenterX);
        if (diffX < minDiffX) {
          minDiffX = diffX;
          bestP = p;
        }
      }
      
      if (bestP && minDiffX < 150) {
        const pbb = bestP.orient.bb || getBoundingBox(bestP.orient.polygon);
        const pCenterX = bestP.x + (pbb.minX + pbb.maxX) / 2;
        const snappedX = roundMetric(pCenterX - (bb.minX + bb.maxX) / 2, 3);
        return { ...candidate, x: snappedX };
      }
    } else if (preferredSide === 'right') {
      const candidateCenterY = candidate.y + (bb.minY + bb.maxY) / 2;
      // Find closest whole piece row
      let bestP = null;
      let minDiffY = Infinity;
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
        const diffY = Math.abs(candidateCenterY - pCenterY);
        if (diffY < minDiffY) {
          minDiffY = diffY;
          bestP = p;
        }
      }
      
      if (bestP && minDiffY < 150) {
        const pbb = bestP.orient.bb || getBoundingBox(bestP.orient.polygon);
        const pCenterY = bestP.y + (pbb.minY + pbb.maxY) / 2;
        const snappedY = roundMetric(pCenterY - (bb.minY + bb.maxY) / 2, 3);
        return { ...candidate, y: snappedY };
      }
    }
    
    return candidate;
  }

  _compactSplitFillCandidatePlacement(candidate, orient, occupiedPlacements, config, workWidth, workHeight, providedSpatialIndex = null) {
    // Snap candidate to column/row center of whole pieces before compacting
    candidate = this._alignSplitPlacementWithWholePieces(candidate, orient, occupiedPlacements, config);
    const step = Math.max(0.1, (config.gridStep || 1) / 4);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    
    const minX = -bb.minX;
    const maxX = workWidth - bb.maxX;
    const minY = -bb.minY;
    const maxY = workHeight - bb.maxY;

    let currentX = candidate.x;
    let currentY = candidate.y;

    const spacing = config.spacing || 0;
    const spatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    const isSafe = (cx, cy) => {
      return this._canPlaceSplitOrient(
        occupiedPlacements,
        orient,
        cx,
        cy,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
    };

    if (!isSafe(currentX, currentY)) return candidate;

    let directions = [
      { axis: 'x', sign: -1, id: 'left' },
      { axis: 'x', sign: 1, id: 'right' },
      { axis: 'y', sign: -1, id: 'top' },
      { axis: 'y', sign: 1, id: 'bottom' }
    ];

    const preferredSide = orient?.splitOutwardSide;
    if (preferredSide) {
      const opposite = {
        'left': 'right',
        'right': 'left',
        'top': 'bottom',
        'bottom': 'top'
      }[preferredSide];

      // Restrict axes of compaction to avoid drifting across columns or rows
      if (preferredSide === 'top' || preferredSide === 'bottom') {
        directions = directions.filter(d => d.axis === 'y');
      } else if (preferredSide === 'left' || preferredSide === 'right') {
        directions = directions.filter(d => d.axis === 'x');
      }

      directions.sort((a, b) => {
        // Squeeze against the whole pieces first: prioritize pushing towards opposite of preferredSide
        if (a.id === opposite) return -1;
        if (b.id === opposite) return 1;
        if (a.id === preferredSide) return 1;
        if (b.id === preferredSide) return -1;
        return 0;
      });
    }

    let moved = true;
    let passes = 0;
    while (moved && passes < 3) {
      moved = false;
      passes++;

      for (const dir of directions) {
        const currentValue = dir.axis === 'x' ? currentX : currentY;
        const limitValue = dir.sign < 0
          ? (dir.axis === 'x' ? minX : minY)
          : (dir.axis === 'x' ? maxX : maxY);

        let low = 0;
        let high = Math.abs(limitValue - currentValue);
        let bestSafeOffset = 0;

        while (high - low > step) {
          const mid = (low + high) / 2;
          const testValue = currentValue + dir.sign * mid;
          const testX = dir.axis === 'x' ? testValue : currentX;
          const testY = dir.axis === 'y' ? testValue : currentY;

          if (isSafe(testX, testY)) {
            bestSafeOffset = mid;
            low = mid;
          } else {
            high = mid;
          }
        }

        if (bestSafeOffset > 1e-3) {
          const finalValue = currentValue + dir.sign * bestSafeOffset;
          const roundedX = dir.axis === 'x' ? roundMetric(finalValue, 3) : currentX;
          const roundedY = dir.axis === 'y' ? roundMetric(finalValue, 3) : currentY;

          if (Math.abs(roundedX - currentX) > 1e-3 || Math.abs(roundedY - currentY) > 1e-3) {
            if (isSafe(roundedX, roundedY)) {
              currentX = roundedX;
              currentY = roundedY;
              moved = true;
            } else {
              const fallbackX = dir.axis === 'x' ? roundMetric(roundedX - dir.sign * 0.001, 3) : currentX;
              const fallbackY = dir.axis === 'y' ? roundMetric(roundedY - dir.sign * 0.001, 3) : currentY;
              if (isSafe(fallbackX, fallbackY)) {
                currentX = fallbackX;
                currentY = fallbackY;
                moved = true;
              }
            }
          }
        }
      }
    }

    return { x: currentX, y: currentY };
  }

  _compactSplitPartnerPlacement(candidate, orient, lastPlacement, occupiedPlacements, config, workWidth, workHeight, providedSpatialIndex = null) {
    const direction = this._getSplitPartnerDirection(lastPlacement, orient);
    if (!direction) return candidate;

    const step = Math.max(0.25, (config.gridStep || 1) / 2);
    const bb = orient.bb || getBoundingBox(orient.polygon);
    const minStart = direction.axis === 'x' ? -bb.minX : -bb.minY;
    const maxStart = direction.axis === 'x' ? workWidth - bb.maxX : workHeight - bb.maxY;
    const startValue = direction.axis === 'x' ? candidate.x : candidate.y;
    const spacing = config.spacing || 0;
    const spatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    const isSafe = (value) => {
      const x = direction.axis === 'x' ? value : candidate.x;
      const y = direction.axis === 'y' ? value : candidate.y;
      return this._canPlaceSplitOrient(
        occupiedPlacements,
        orient,
        x,
        y,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
    };

    let best = isSafe(startValue) ? startValue : null;
    const sign = direction.sign;
    for (
      let value = startValue - sign * step;
      value >= minStart - 1e-6 && value <= maxStart + 1e-6;
      value -= sign * step
    ) {
      const rounded = roundMetric(value, 3);
      if (!isSafe(rounded)) break;
      best = rounded;
    }

    if (best == null) return null;
    return {
      x: direction.axis === 'x' ? roundMetric(best, 3) : candidate.x,
      y: direction.axis === 'y' ? roundMetric(best, 3) : candidate.y
    };
  }


  _scoreSplitPlacementOption(option, workWidth, workHeight, partnerPlacement = null) {
    if (!option?.orient) return Infinity;
    const baseScore = this._scorePreparedEdgePlacementCandidate(option, option.orient, workWidth, workHeight);
    if (!partnerPlacement) return baseScore;

    const optionBounds = this._getPlacementBounds(option);
    const partnerBounds = this._getPlacementBounds(partnerPlacement);
    const optionCenterX = (optionBounds.minX + optionBounds.maxX) / 2;
    const optionCenterY = (optionBounds.minY + optionBounds.maxY) / 2;
    const partnerCenterX = (partnerBounds.minX + partnerBounds.maxX) / 2;
    const partnerCenterY = (partnerBounds.minY + partnerBounds.maxY) / 2;
    const direction = this._getSplitPartnerDirection(partnerPlacement, option.orient);
    const facingGap = direction?.axis === 'x'
      ? Math.max(
        0,
        direction.sign > 0
          ? optionBounds.minX - partnerBounds.maxX
          : partnerBounds.minX - optionBounds.maxX
      )
      : Math.max(
        0,
        direction?.sign > 0
          ? optionBounds.minY - partnerBounds.maxY
          : partnerBounds.minY - optionBounds.maxY
      );
    const crossOffset = direction?.axis === 'x'
      ? Math.abs(optionCenterY - partnerCenterY)
      : Math.abs(optionCenterX - partnerCenterX);

    return facingGap * 10 + crossOffset * 0.8 + baseScore * 0.05;
  }

  _pushSplitPlacementOption(options, seen, placement, workWidth, workHeight, partnerPlacement = null) {
    if (!placement?.orient) return;
    const key = `${placement.orient.foot}|${placement.orient.angle}|${roundMetric(placement.x, 3)}|${roundMetric(placement.y, 3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      ...placement,
      x: roundMetric(placement.x, 3),
      y: roundMetric(placement.y, 3),
      _splitOptionScore: this._scoreSplitPlacementOption(placement, workWidth, workHeight, partnerPlacement)
    });
  }

  _findSplitPartnerNearPlacementOptions(
    lastPlacement,
    orientVariants,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    filterFn = null,
    maxOptions = 35,
    providedSpatialIndex = null
  ) {
    const options = [];
    const seen = new Set();

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const nearCandidates = this._buildSplitPartnerNearCandidates(
        lastPlacement,
        orient,
        workWidth,
        workHeight,
        step
      );

      for (const candidate of nearCandidates) {
        const compacted = this._compactSplitPartnerPlacement(
          candidate,
          orient,
          lastPlacement,
          occupiedPlacements,
          config,
          workWidth,
          workHeight,
          providedSpatialIndex
        );
        if (!compacted) continue;

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: compacted.x,
          y: compacted.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight, lastPlacement);
        orientOptions++;
        if (orientOptions >= maxOptions * 2) break;
      }
    }

    const topOptions = options
      .sort((left, right) => left._splitOptionScore - right._splitOptionScore)
      .slice(0, Math.max(1, maxOptions));

    const compactedOptions = [];
    const finalSeen = new Set();
    const spacing = config.spacing || 0;
    const spatialIndex = this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);
    for (const option of topOptions) {
      const fineCompacted = this._compactSplitFillCandidatePlacement(
        option,
        option.orient,
        occupiedPlacements,
        config,
        workWidth,
        workHeight
      );

      const finalX = roundMetric(fineCompacted.x, 3);
      const finalY = roundMetric(fineCompacted.y, 3);

      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        option.orient,
        finalX,
        finalY,
        config,
        workWidth,
        workHeight,
        spatialIndex
      )) {
        continue;
      }

      const key = `${option.orient.foot}|${option.orient.angle}|${finalX}|${finalY}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: finalX,
        y: finalY
      });
    }

    return compactedOptions;
  }

  _getSplitPartnerFoot(foot) {
    if (foot === 'split-left') return 'split-right';
    if (foot === 'split-right') return 'split-left';
    return null;
  }

  _getSplitPairPartnerFoot(foot) {
    if (foot === 'split-left') return 'split-right';
    if (foot === 'split-right') return 'split-left';
    return null;
  }

  _getSplitPlacementPairStats(placements = []) {
    let leftCount = 0;
    let rightCount = 0;
    let dcCount = 0;
    for (const placement of placements) {
      if (placement?.orient?.foot === 'split-left' || placement?.orient?.foot === 'L') leftCount += 1;
      else if (placement?.orient?.foot === 'split-right' || placement?.orient?.foot === 'R') rightCount += 1;
      else if (placement?.orient?.foot === 'X' || placement?.orient?.foot === 'DC') dcCount += 1;
    }

    const splitPairCount = dcCount + Math.min(leftCount, rightCount);
    const splitUnpairedCount = Math.abs(leftCount - rightCount);
    const pieceCount = dcCount * 2 + leftCount + rightCount;
    return {
      splitLeftCount: leftCount,
      splitRightCount: rightCount,
      dcCount,
      pieceCount,
      splitPairCount,
      splitUnpairedCount
    };
  }

  _balanceSplitFillPlacementsForPairs(placements = []) {
    if (placements.length <= 1) return placements;

    const originalPlacements = [...placements];
    const balanced = [...placements];
    const counts = new Map();
    const applyDelta = (foot, delta) => {
      counts.set(foot, (counts.get(foot) || 0) + delta);
    };

    for (const placement of balanced) {
      applyDelta(placement?.orient?.foot, 1);
    }

    const isPairReady = () => {
      const leftCount = counts.get('split-left') || 0;
      const rightCount = counts.get('split-right') || 0;
      return leftCount === rightCount && balanced.length % 2 === 0;
    };

    while (balanced.length > 1 && !isPairReady()) {
      const removed = balanced.pop();
      applyDelta(removed?.orient?.foot, -1);
    }

    if (balanced.length < originalPlacements.length) {
      return originalPlacements;
    }

    return balanced;
  }


  _findNextSplitFillPlacementOptions(
    sizeName,
    orientVariants,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    filterFn = null,
    maxOptions = 100,
    providedSpatialIndex = null
  ) {
    // Dynamically adjust limit based on current piece count
    const adaptiveMax = occupiedPlacements.length > 80 ? 50 : 35;
    const finalMax = Math.max(maxOptions, adaptiveMax);
    const freeRects = this._buildPreparedSplitFreeRects(
      occupiedPlacements,
      workWidth,
      workHeight,
      config.spacing
    );
    const options = [];
    const seen = new Set();

    const spacing = config.spacing || 0;
    const spatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);

    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      let orientOptions = 0;
      const compatibleRects = freeRects.filter((rect) =>
        rect.width + 1e-6 >= orient.width &&
        rect.height + 1e-6 >= orient.height
      );

      for (const rect of compatibleRects) {
        const placementCandidates = this._buildPreparedRectPlacementCandidates(rect, orient, step);
        for (const candidate of placementCandidates) {
          if (!this._canPlaceSplitOrient(
            occupiedPlacements,
            orient,
            candidate.x,
            candidate.y,
            config,
            workWidth,
            workHeight,
            spatialIndex
          )) {
            continue;
          }

          this._pushSplitPlacementOption(options, seen, {
            orient,
            x: candidate.x,
            y: candidate.y,
            effectiveArea: orient.areaMm2
          }, workWidth, workHeight);
          orientOptions++;
          if (orientOptions >= finalMax * 1.5) break;
        }
        if (orientOptions >= finalMax * 1.5) break;
      }
    }

    // Removed redundant Grid Scan loop for performance. 
    // We now rely solely on Geometric Vertex Anchors for ultra-fast nesting.


    for (const orient of orientVariants) {
      if (filterFn && !filterFn(orient)) continue;
      
      const spacing = config.spacing || 0;
      const edgeCandidates = this._buildGeometricVertexAnchors(
        occupiedPlacements,
        orient,
        workWidth,
        workHeight,
        spacing
      );

      let foundForOrient = 0;
      for (let i = 0; i < edgeCandidates.length; i++) {
        const candidate = edgeCandidates[i];
        
        // Removed aggressive edge-only pruning to allow deep interlocking in the sheet center,
        // which is required for high-yield nesting (e.g. 64 pairs for small sizes).
        const margin = 100; // Minimal safety margin
        const isOutside = candidate.x < -margin || candidate.x > (workWidth + margin) || candidate.y < -margin || candidate.y > (workHeight + margin);
        if (isOutside) continue;
        if (!this._canPlaceSplitOrient(
          occupiedPlacements,
          orient,
          candidate.x,
          candidate.y,
          config,
          workWidth,
          workHeight,
          spatialIndex
        )) {
          continue;
        }

        this._pushSplitPlacementOption(options, seen, {
          orient,
          x: candidate.x,
          y: candidate.y,
          effectiveArea: orient.areaMm2
        }, workWidth, workHeight);
        
        foundForOrient++;
        // Intelligent Variety: Adapt search breadth based on piece size.
        const foundLimit = orient.area < 10000 ? 25 : 12; 
        if (foundForOrient >= foundLimit) break;
      }
    }

    const topOptions = options
      .sort((left, right) => left._splitOptionScore - right._splitOptionScore)
      .slice(0, Math.max(1, maxOptions));

    const compactedOptions = [];
    const finalSeen = new Set();
    for (const option of topOptions) {
      const fineCompacted = this._compactSplitFillCandidatePlacement(
        option,
        option.orient,
        occupiedPlacements,
        config,
        workWidth,
        workHeight,
        spatialIndex
      );
      
      const finalX = roundMetric(fineCompacted.x, 3);
      const finalY = roundMetric(fineCompacted.y, 3);

      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        option.orient,
        finalX,
        finalY,
        config,
        workWidth,
        workHeight,
        spatialIndex
      )) {
        continue;
      }

      const key = `${option.orient.foot}|${option.orient.angle}|${finalX}|${finalY}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      compactedOptions.push({
        ...option,
        x: finalX,
        y: finalY
      });
    }

    return compactedOptions;
  }

  _rankSplitFillState(state) {
    const pairStats = this._getSplitPlacementPairStats(state.extraPlacements);
    const bounds = computeEnvelope(state.occupiedPlacements);
    
    // Get average piece area for relative weighting
    const pieceArea = state.extraPlacements[0]?.orient?.areaMm2 || 10000;
    
    const usedAreaMm2 = state.occupiedPlacements.reduce((sum, placement) =>
      sum + (placement.effectiveArea || placement.orient?.areaMm2 || 0),
    0);
    const leftover = computeLeftoverMetricsFromBounds(bounds, state.workWidth, state.workHeight, usedAreaMm2);
    
    // Adaptive Penalties & Rewards
    // 1. Imbalance penalty scales with piece size to ensure consistent behavior across shoe sizes
    const imbalancePenalty = pairStats.splitUnpairedCount * (pieceArea * 0.9);
    
    // 2. Face Outward Reward scales with proximity to edge
    const faceOutwardReward = this._calculateFaceOutwardReward(state, pieceArea);
    
    return {
      count: pairStats.pieceCount,
      pairs: pairStats.splitPairCount,
      dcCount: pairStats.dcCount,
      unpaired: pairStats.splitUnpairedCount,
      imbalancePenalty,
      faceOutwardReward,
      leftoverAreaMm2: leftover.leftoverAreaMm2,
      openSheetAreaMm2: leftover.openSheetAreaMm2,
      height: bounds.height,
      width: bounds.width,
      waste: bounds.width * bounds.height
    };
  }
  
  _calculateFaceOutwardReward(state, pieceArea) {
    if (!state.extraPlacements.length) return 0;
    let totalReward = 0;
    const config = state.config || {};
    const workWidth = state.workWidth || (config.sheetWidth ? config.sheetWidth - 2 * (config.marginX || 0) : 1100);
    const workHeight = state.workHeight || (config.sheetHeight ? config.sheetHeight - 2 * (config.marginY || 0) : 2000);
    
    // Active zone for orientation reward (15% of sheet dimensions)
    const activeThresholdX = workWidth * 0.15;
    const activeThresholdY = workHeight * 0.15;
    
    for (const p of state.extraPlacements) {
      const v = p.orient?.splitOutwardVector;
      if (!v) continue;
      
      const bb = p.orient.bb || getBoundingBox(p.orient.polygon);
      const centerX = p.x + (bb.minX + bb.maxX) / 2;
      const centerY = p.y + (bb.minY + bb.maxY) / 2;
      
      const distL = centerX;
      const distR = workWidth - centerX;
      const distT = centerY;
      const distB = workHeight - centerY;
      
      const minDist = Math.min(distL, distR, distT, distB);
      
      // Determine if piece is near a specific edge and vector points OUT
      let pointsOut = false;
      let threshold = 0;
      
      if (minDist === distL) { pointsOut = v.x < -0.5; threshold = activeThresholdX; }
      else if (minDist === distR) { pointsOut = v.x > 0.5; threshold = activeThresholdX; }
      else if (minDist === distT) { pointsOut = v.y < -0.5; threshold = activeThresholdY; }
      else if (minDist === distB) { pointsOut = v.y > 0.5; threshold = activeThresholdY; }
      
      if (pointsOut && minDist < threshold) {
        // Linear decay: pieces closer to the edge get higher reward
        // Max reward is 1.5x piece area to strongly influence orientation over small placement gaps
        const weight = 1.0 - (minDist / threshold);
        totalReward += pieceArea * 1.5 * weight;
      }
    }
    return totalReward;
  }

  _compareSplitFillStates(left, right) {
    const leftRank = this._rankSplitFillState(left);
    const rightRank = this._rankSplitFillState(right);
    return (leftRank.imbalancePenalty - rightRank.imbalancePenalty)
      || (rightRank.faceOutwardReward - leftRank.faceOutwardReward)
      || rightRank.dcCount - leftRank.dcCount
      || rightRank.pairs - leftRank.pairs
      || rightRank.count - leftRank.count
      || rightRank.leftoverAreaMm2 - leftRank.leftoverAreaMm2
      || rightRank.openSheetAreaMm2 - leftRank.openSheetAreaMm2
      || leftRank.height - rightRank.height
      || leftRank.width - rightRank.width
      || leftRank.waste - rightRank.waste;
  }

  _dedupeSplitFillStates(states) {
    if (!states.length) return [];
    
    // Calculate best score to perform relative pruning
    const stateRanks = states.map(s => ({ state: s, rank: this._rankSplitFillState(s) }));
    stateRanks.sort((a, b) => this._compareSplitFillStates(a.state, b.state));
    
    const bestRank = stateRanks[0].rank;
    const bestScore = bestRank.pairs * 10000 + bestRank.count;

    const unique = [];
    const seen = new Set();
    
    for (const item of stateRanks) {
      const state = item.state;
      const key = state.extraPlacements
        .map((placement) => `${placement.orient.foot}:${placement.orient.angle}:${roundMetric(placement.x, 1)}:${roundMetric(placement.y, 1)}`)
        .join('|');
      
      if (seen.has(key)) continue;
      
      // Relative Pruning: Only keep states that are within 98% of the best score (tighter filter)
      const currentScore = item.rank.pairs * 10000 + item.rank.count;
      if (unique.length > 0 && currentScore < bestScore * 0.98) continue;

      seen.add(key);
      unique.push(state);
      
      // Hard cap: 6 states per level for maximum performance
      if (unique.length >= 6) break;
    }
    
    return unique;
    return unique;
  }

  _buildTightSplitPairTemplate(firstOrient, secondOrient, config, step) {
    const direction = this._getSplitPartnerDirection({ orient: firstOrient }, secondOrient);
    if (!direction) return null;

    const spacing = config.spacing || 0;
    const safeStep = Math.max(0.5, step || 1);
    const firstBounds = firstOrient.bb || getBoundingBox(firstOrient.polygon);
    const secondBounds = secondOrient.bb || getBoundingBox(secondOrient.polygon);
    const firstBase = {
      orient: firstOrient,
      x: -firstBounds.minX,
      y: -firstBounds.minY,
      effectiveArea: firstOrient.areaMm2
    };
    const firstWorldBounds = this._getPlacementBounds(firstBase);
    const firstCenterX = (firstWorldBounds.minX + firstWorldBounds.maxX) / 2;
    const firstCenterY = (firstWorldBounds.minY + firstWorldBounds.maxY) / 2;
    const secondCenterX = (secondBounds.minX + secondBounds.maxX) / 2;
    const secondCenterY = (secondBounds.minY + secondBounds.maxY) / 2;
    const crossAnchors = direction.axis === 'x'
      ? [
          firstCenterY - secondCenterY,
          firstWorldBounds.minY - secondBounds.minY,
          firstWorldBounds.maxY - secondBounds.maxY
        ]
      : [
          firstCenterX - secondCenterX,
          firstWorldBounds.minX - secondBounds.minX,
          firstWorldBounds.maxX - secondBounds.maxX
        ];

    // Optimization: Coarser search for templates to find candidates faster, 
    // we refine with compaction later anyway.
    const searchStep = Math.max(2.0, safeStep * 2);
    const crossRange = 8; // Reduce search range from 10 to 8
    const gapRange = 30;  // Reduce gap range from 40 to 30

    let bestTemplate = null;
    for (const crossAnchor of crossAnchors) {
      for (let crossUnit = -crossRange; crossUnit <= crossRange; crossUnit++) {
        const crossValue = crossAnchor + crossUnit * searchStep;
        for (let gapUnit = 0; gapUnit <= gapRange; gapUnit++) {
          const gap = gapUnit * searchStep;
          let secondX;
          let secondY;
          if (direction.axis === 'x') {
            secondX = direction.sign > 0
              ? firstWorldBounds.maxX + gap - secondBounds.minX
              : firstWorldBounds.minX - gap - secondBounds.maxX;
            secondY = crossValue;
          } else {
            secondX = crossValue;
            secondY = direction.sign > 0
              ? firstWorldBounds.maxY + gap - secondBounds.minY
              : firstWorldBounds.minY - gap - secondBounds.maxY;
          }

          const secondBase = {
            orient: secondOrient,
            x: roundMetric(secondX, 3),
            y: roundMetric(secondY, 3),
            effectiveArea: secondOrient.areaMm2
          };
          const localValidation = validateLocalPlacements([firstBase, secondBase], spacing);
          if (!localValidation.valid) continue;

          const bounds = computeEnvelope([firstBase, secondBase]);
          const placements = [firstBase, secondBase].map((placement) => ({
            ...placement,
            x: roundMetric(placement.x - bounds.minX, 3),
            y: roundMetric(placement.y - bounds.minY, 3)
          }));
          const rebasedBounds = computeEnvelope(placements);
          const template = {
            placements,
            width: rebasedBounds.width,
            height: rebasedBounds.height,
            gap,
            crossOffset: Math.abs(crossUnit * searchStep),
            score: gap * 10 + Math.abs(crossUnit * searchStep) + rebasedBounds.width * rebasedBounds.height * 0.000001
          };

          if (!bestTemplate || template.score < bestTemplate.score) {
            bestTemplate = template;
          }
          break;
        }
      }
    }

    return bestTemplate;
  }

  _buildSplitPairTemplates(orientVariants, config, step) {
    const templates = [];
    const seen = new Set();
    for (const orient of orientVariants) {
      const partnerFoot = this._getSplitPairPartnerFoot(orient?.foot);
      
      // If it's a whole piece (X), add it as a single-piece template
      if (!partnerFoot && (orient.foot === 'X' || orient.foot === 'whole')) {
        const key = `whole:${orient.angle}`;
        if (!seen.has(key)) {
          seen.add(key);
          templates.push({
            placements: [{ x: 0, y: 0, orient }],
            width: orient.width,
            height: orient.height,
            score: 0.1, // Priority: lower score is better. Whole pieces get 0.1
            key
          });
        }
        continue;
      }

      if (!partnerFoot) continue;

      for (const secondOrient of orientVariants) {
        if (secondOrient?.foot !== partnerFoot) continue;
        if (secondOrient?.splitPairAngleFamily !== orient.splitPairAngleFamily) continue;
        const key = `${orient.foot}:${orient.angle}|${secondOrient.foot}:${secondOrient.angle}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const template = this._buildTightSplitPairTemplate(orient, secondOrient, config, step);
        if (!template) continue;
        templates.push({
          ...template,
          score: (template.score || 1.0) + 1.0, // Pairs get higher score (lower priority) than whole pieces
          key
        });
      }
    }

    return templates
      .sort((left, right) =>
        left.score - right.score
        || left.height - right.height
        || left.width - right.width
      )
      .slice(0, 25); // Limit pair templates to top 25 quality matches
  }

  _canPlaceSplitPairTemplate(template, originX, originY, occupiedPlacements, config, workWidth, workHeight, providedSpatialIndex = null) {
    const placed = template.placements.map((placement) => ({
      ...placement,
      x: roundMetric(originX + placement.x, 3),
      y: roundMetric(originY + placement.y, 3)
    }));

    const spacing = config.spacing || 0;
    let currentSpatialIndex = providedSpatialIndex || this._buildSpatialIndex(occupiedPlacements, workWidth, workHeight, spacing);

    for (let index = 0; index < placed.length; index++) {
      if (!this._canPlaceSplitOrient(
        occupiedPlacements,
        placed[index].orient,
        placed[index].x,
        placed[index].y,
        config,
        workWidth,
        workHeight,
        currentSpatialIndex
      )) {
        return null;
      }
      // Incrementally update spatial index for the next piece in the template
      currentSpatialIndex = this._buildSpatialIndex(
        [...occupiedPlacements, placed[index]], 
        workWidth, 
        workHeight, 
        spacing, 
        currentSpatialIndex
      );
    }

    return placed;
  }

  _buildSplitPairGroupOrigins(template, occupiedPlacements, workWidth, workHeight, step, providedFreeRects = null) {
    if (!template || template.width > workWidth + 1e-6 || template.height > workHeight + 1e-6) return [];

    const safeStep = Math.max(1, (step || 1) * 2);
    const maxX = workWidth - template.width;
    const maxY = workHeight - template.height;
    const origins = [];
    const seen = new Set();
    const addOrigin = (x, y) => {
      const originX = roundMetric(Math.max(0, Math.min(maxX, x)), 3);
      const originY = roundMetric(Math.max(0, Math.min(maxY, y)), 3);
      const key = `${originX}|${originY}`;
      if (seen.has(key)) return;
      seen.add(key);
      origins.push({ x: originX, y: originY });
    };

    const xs = buildDenseAxisCandidates(0, maxX, safeStep, 24);
    const ys = buildDenseAxisCandidates(0, maxY, safeStep, 24);
    for (const x of xs) {
      addOrigin(x, 0);
      addOrigin(x, maxY);
    }
    for (const y of ys) {
      addOrigin(0, y);
      addOrigin(maxX, y);
    }

    const freeRects = providedFreeRects || this._buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, 0);
    
    const intersectsFreeSpace = (minX, minY, maxX, maxY) => {
      for (const rect of freeRects) {
        if (maxX > rect.x && minX < rect.x + rect.width &&
            maxY > rect.y && minY < rect.y + rect.height) {
          return true;
        }
      }
      return false;
    };

    for (const placement of occupiedPlacements) {
      const bounds = this._getPlacementBounds(placement);
      
      if (!intersectsFreeSpace(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)) {
        continue;
      }

      const candidateOrigins = [
        { x: bounds.minX - template.width, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.minY - template.height },
        { x: bounds.minX, y: bounds.maxY }
      ];
      for (const origin of candidateOrigins) {
        for (const dx of [-safeStep, 0, safeStep]) {
          for (const dy of [-safeStep, 0, safeStep]) {
            const ox = origin.x + dx;
            const oy = origin.y + dy;
            
            if (intersectsFreeSpace(ox, oy, ox + template.width, oy + template.height)) {
              addOrigin(ox, oy);
            }
          }
        }
      }
    }

    return origins.sort((left, right) => {
      const leftEdge = Math.min(left.x, maxX - left.x, left.y, maxY - left.y);
      const rightEdge = Math.min(right.x, maxX - right.x, right.y, maxY - right.y);
      return leftEdge - rightEdge || left.y - right.y || left.x - right.x;
    });
  }

  _findSplitPairGroupPlacementOptions(
    pairTemplates,
    occupiedPlacements,
    config,
    workWidth,
    workHeight,
    step,
    maxOptions = 20,
    providedSpatialIndex = null
  ) {
    const freeRects = this._buildPreparedSplitFreeRects(occupiedPlacements, workWidth, workHeight, 0);
    const options = [];
    const seen = new Set();
    for (const template of pairTemplates) {
      const origins = this._buildSplitPairGroupOrigins(template, occupiedPlacements, workWidth, workHeight, step, freeRects);
      for (const origin of origins) {
        const placedGroup = this._canPlaceSplitPairTemplate(
          template,
          origin.x,
          origin.y,
          occupiedPlacements,
          config,
          workWidth,
          workHeight,
          providedSpatialIndex
        );
        if (!placedGroup) continue;

        const key = placedGroup
          .map((placement) => `${placement.orient.foot}:${placement.orient.angle}:${roundMetric(placement.x, 3)}:${roundMetric(placement.y, 3)}`)
          .join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          placements: placedGroup,
          score: template.score + origin.y * 0.001 + origin.x * 0.0005
        });
        if (options.length >= maxOptions * 2) break;
      }
      if (options.length >= maxOptions * 2) break;
    }

    return options
      .sort((left, right) => left.score - right.score)
      .slice(0, Math.max(1, maxOptions));
  }

  _findSplitFillPlacements(sizeName, polygon, baseCandidate, config, workWidth, workHeight) {
    // All sizes are now treated as critical for maximum yield, using smart-skip for speed
    if (config.preparedSplitFillEnabled !== true) {
      return [];
    }

    const step = Math.max(0.5, config.gridStep || 1);
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const halfDefs = buildSplitHalfDefinitions(
      sourceShape?.polygon || polygon,
      sourceShape?.internals?.[0] || []
    );
    if (!halfDefs.length || !baseCandidate?.placements?.length) return [];

    const minHalfArea = Math.max(
      1,
      Math.min(...halfDefs.map((halfDef) => halfDef.areaMm2 || Infinity))
    );
    const usedAreaMm2 = baseCandidate.usedAreaMm2
      ?? baseCandidate.placements.reduce((sum, placement) =>
        sum + (placement.effectiveArea || placement.orient?.areaMm2 || 0),
      0);
    const remainingAreaMm2 = Math.max(0, workWidth * workHeight - usedAreaMm2);
    const physicalSafetyLimit = Math.max(
      1,
      Math.ceil((remainingAreaMm2 / minHalfArea) * 1.2)
    );
    const maxExtraFillers = Number.isFinite(config.preparedSplitFillMaxPieces)
      ? Math.max(1, config.preparedSplitFillMaxPieces)
      : Math.min(8, physicalSafetyLimit);

    const orientVariants = [];
    const fullPolygon = sourceShape?.polygon || polygon;
    for (const angle of this._getSplitFillAngles(config)) {
      orientVariants.push(this._decorateOrient(sizeName, 'X', fullPolygon, angle, config, step));
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }

    orientVariants.sort((left, right) =>
      left.height - right.height
      || left.width - right.width
      || (left.angle || 0) - (right.angle || 0)
    );
    const pairTemplates = this._buildSplitPairTemplates(orientVariants, config, step);

    let states = [{
      occupiedPlacements: [...baseCandidate.placements],
      extraPlacements: [],
        spatialIndex: this._buildSpatialIndex([...baseCandidate.placements], workWidth, workHeight, config.spacing || 0)
    }];
    let bestState = states[0];
    const startTime = Date.now();
    const timeLimitMs = Number.isFinite(config.preparedSplitFillTimeLimitMs)
      ? Math.max(250, config.preparedSplitFillTimeLimitMs)
      : 2500;

    for (let depth = 0; depth < maxExtraFillers; depth++) {
      if (Date.now() - startTime > timeLimitMs) break;
      const expandedStates = [];
      const currentBatchLimit = Date.now() - startTime > (timeLimitMs * 0.8) ? 2 : states.length;
      const statesToExpand = states.slice(0, currentBatchLimit);
      
      for (const state of statesToExpand) {
        if (Date.now() - startTime > (timeLimitMs * 0.9)) break; // Early exit if close to limit

        // Optimization: If we have many pieces, switch to greedy mode for speed.
        // BFS with 120 depth is mathematically impossible within reasonable time.
        if (depth > 15 && states.length > 1) {
            // This already processed the best state first, so we just limit future expansions
        }
        if (state.extraPlacements.length + 1 < maxExtraFillers && pairTemplates.length) {
          const groupOptions = this._findSplitPairGroupPlacementOptions(
            pairTemplates,
            state.occupiedPlacements,
            config,
            workWidth,
            workHeight,
            step,
            depth > 10 ? 5 : 15, // Adaptive limit for group options
            state.spatialIndex
          );

          const filteredGroupOptions = groupOptions.filter(groupOption => {
            return groupOption.placements.every(p => {
              const pbb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
              return p.x + pbb.maxX <= workWidth;
            });
          });

          for (const groupOption of filteredGroupOptions) {
            const nextGroupPlacements = groupOption.placements.map((placement, index) => ({
              ...placement,
              id: `split_fill_${state.extraPlacements.length + index}`
            }));
            
            // Build new spatial index for the next state (incremental)
            let nextSpatialIndex = state.spatialIndex;
            for (const p of nextGroupPlacements) {
                nextSpatialIndex = this._buildSpatialIndex([...state.occupiedPlacements, p], workWidth, workHeight, config.spacing || 0, nextSpatialIndex);
            }

            expandedStates.push({
              occupiedPlacements: [...state.occupiedPlacements, ...nextGroupPlacements],
              extraPlacements: [...state.extraPlacements, ...nextGroupPlacements],
              workWidth,
              workHeight,
              spatialIndex: nextSpatialIndex
            });
          }

          if (groupOptions.length > 0 && depth > 5) {
            // If we found a group (pair/template), we prioritize it and don't look for single pieces
            // this speeds up small sizes significantly.
            continue;
          }
        }

        let options = [];
        if (config.preparedSplitFillPreferPairs !== false && state.extraPlacements.length > 0) {
          const lastPlacement = state.extraPlacements[state.extraPlacements.length - 1];
          const partnerFoot = this._getSplitPairPartnerFoot(lastPlacement?.orient?.foot);
          const partnerAngleFamily = lastPlacement?.orient?.splitPairAngleFamily;
          if (partnerFoot) {
            const partnerFilter = (orient) =>
              orient?.foot === partnerFoot
              && orient?.splitPairAngleFamily === partnerAngleFamily;

            options = this._findSplitPartnerNearPlacementOptions(
              lastPlacement,
              orientVariants,
              state.occupiedPlacements,
              config,
              workWidth,
              workHeight,
              step,
              partnerFilter,
              depth > 10 ? 10 : 25,
              state.spatialIndex
            );

            if (!options.length) {
              options = this._findNextSplitFillPlacementOptions(
                sizeName,
                orientVariants,
                state.occupiedPlacements,
                config,
                workWidth,
                workHeight,
                step,
                partnerFilter,
                depth > 10 ? 15 : 40,
                state.spatialIndex
              );
            }
          }
        }

        const genericOptions = this._findNextSplitFillPlacementOptions(
          sizeName,
          orientVariants,
          state.occupiedPlacements,
          config,
          workWidth,
          workHeight,
          step,
          null,
          depth > 10 ? 10 : 20,
          state.spatialIndex
        );

        let mergedOptions = [...options];
        const seenOptions = new Set(mergedOptions.map((option) =>
          `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`
        ));

        for (const option of genericOptions) {
          const key = `${option.orient.foot}|${option.orient.angle}|${roundMetric(option.x, 3)}|${roundMetric(option.y, 3)}`;
          if (seenOptions.has(key)) continue;
          seenOptions.add(key);
          mergedOptions.push(option);
        }

        const avgArea = orientVariants[0]?.area || 1;
        const currentUtilization = (state.occupiedPlacements.length * avgArea) / (workWidth * workHeight);
        
        if (currentUtilization > 0.94) {
            break; 
        }

        const isSmall = avgArea < 15000;
        // ADAPTIVE BRANCHING: scales with depth and remaining space
        const remainingRatio = Math.max(0.01, 1.0 - currentUtilization);
        let fillLimit = 1;
        if (depth < 6) {
          fillLimit = Math.max(1, Math.round(remainingRatio * (isSmall ? 30 : 15)));
        } else if (depth < 20) {
          fillLimit = Math.max(1, Math.round(remainingRatio * (isSmall ? 8 : 4)));
        } else {
          fillLimit = 1;
        }
        fillLimit = Math.min(fillLimit, isSmall ? 10 : 6);

        const filteredMergedOptions = mergedOptions.filter(option => {
          const pbb = option.orient?.bb || getBoundingBox(option.orient?.polygon || []);
          return option.x + pbb.maxX <= workWidth;
        });
        options = filteredMergedOptions.slice(0, fillLimit);

        for (const option of options) {
          const nextPlacement = {
            ...option,
            id: `split_fill_${state.extraPlacements.length}`
          };
          
          // Incremental spatial index update
          const nextSpatialIndex = this._buildSpatialIndex(
            [...state.occupiedPlacements, nextPlacement], 
            workWidth, 
            workHeight, 
            config.spacing || 0, 
            state.spatialIndex
          );

          expandedStates.push({
            occupiedPlacements: [...state.occupiedPlacements, nextPlacement],
            extraPlacements: [...state.extraPlacements, nextPlacement],
            workWidth,
            workHeight,
            spatialIndex: nextSpatialIndex
          });
        }
      }

      if (!expandedStates.length) break;
      states = this._dedupeSplitFillStates(expandedStates);
      if (this._compareSplitFillStates(states[0], bestState) < 0) {
        bestState = states[0];
      }
    }

    const extraPlacements = bestState.extraPlacements;
    if (sizeName === '9.5') {
      const marginThreshold = 120;
      return extraPlacements.filter(p => {
        const pbb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
        const isRightMargin = p.x + pbb.maxX > workWidth - marginThreshold;
        const isBottomMargin = p.y + pbb.maxY > workHeight - marginThreshold;
        const isTopMargin = p.y + pbb.minY < marginThreshold;
        return !isRightMargin && !isBottomMargin && !isTopMargin;
      });
    }
    return extraPlacements;
  }

  _augmentCandidateWithSplitFillers(sizeName, polygon, candidate, config, workWidth, workHeight) {
    if (!config.preparedSplitFillEnabled) return candidate;
    const sizeVal = parseFloat(sizeName);

    let maxX = 0;
    let maxY = 0;
    for (const p of candidate.placements) {
      const bb = p.orient?.bb || getBoundingBox(p.orient?.polygon || []);
      maxX = Math.max(maxX, p.x + bb.maxX);
      maxY = Math.max(maxY, p.y + bb.maxY);
    }

    const remainingX = Math.max(0, workWidth - maxX);
    const remainingY = Math.max(0, workHeight - maxY);
    const pieceArea = polygonArea(polygon) || 1;
    const isCritical = true;
    
    // Geometric Pruning: Almost disabled for Size 6.0 to find every single potential filler
    const pruningFactor = isCritical ? 0.1 : 0.8;
    if ((remainingX * workHeight + remainingY * workWidth) < pieceArea * pruningFactor) {
       return attachLeftoverMetrics(candidate, workWidth, workHeight);
    }
    
    // Smart Shifting: Calculate ONE optimal shift based on remaining space, don't loop.
    const shiftVariants = [{ dx: 0, dy: 0 }];
    if (sizeVal <= 7.0 && (remainingX > 15 || remainingY > 15)) {
       // Only shift if there is significant "useless" space at the edges
       shiftVariants.push({ dx: remainingX * 0.5, dy: remainingY * 0.5 });
    }

    const {
      ...candidateMetadata
    } = candidate;

    let bestAugmentedCandidate = attachLeftoverMetrics(candidate, workWidth, workHeight);

    for (const shift of shiftVariants) {
      const shiftedPlacements = candidate.placements.map(p => ({
        ...p,
        x: roundMetric(p.x + shift.dx, 3),
        y: roundMetric(p.y + shift.dy, 3)
      }));
      
      const squeezedPlacements = shiftedPlacements;
      
      const testCandidate = {
        ...candidate,
        placements: squeezedPlacements
      };
      
      const extraPlacements = this._findSplitFillPlacements(
        sizeName,
        polygon,
        testCandidate,
        config,
        workWidth,
        workHeight
      );
      if (!extraPlacements || !extraPlacements.length) continue;

      const usableExtraCount = extraPlacements.length;
      const pairStats = this._getSplitPlacementPairStats(extraPlacements);
      const usedAreaMm2 = (testCandidate.usedAreaMm2 ?? testCandidate.placedCount * testCandidate.pieceArea)
        + extraPlacements.reduce((sum, placement) => sum + (placement.effectiveArea || 0), 0);

      const augmentedCandidate = this._buildCandidate(
        sizeName,
        testCandidate.selectedFoot ?? testCandidate.foot ?? testCandidate.placements?.[0]?.orient?.foot ?? 'L',
        testCandidate.pieceArea,
        [...testCandidate.placements, ...extraPlacements],
        {
          ...candidateMetadata,
          splitFillUsed: true,
          splitFillCount: usableExtraCount,
          ...pairStats,
          usedAreaMm2
        },
        workWidth,
        workHeight,
        config
      );

      const finalized = augmentedCandidate ? this._finalizeCandidate(augmentedCandidate, config, workWidth, workHeight) : null;
      if (finalized) {
        // With 500s budget: purely density-driven, no leftover guard
        const cmp = compareDoubleInsoleCandidates(finalized, bestAugmentedCandidate);
        if (cmp < 0) {
          bestAugmentedCandidate = finalized;
        }
      }
    }

    // Phase 2: Margin fill — greedy place half-pieces in bottom/right margins
    bestAugmentedCandidate = this._fillMarginHalves(
      sizeName, polygon, bestAugmentedCandidate, config, workWidth, workHeight
    );

    // Smart Alignment Verification
    // We no longer hit hard targets, we search for every possible pair.

    return bestAugmentedCandidate;
  }

  _findMaxValidYForTopMargin(orient, x, minY, maxY, allPlacements, config, workWidth, workHeight, spatialIndex) {
    let lastValidY = null;
    const step = Math.max(0.5, config.gridStep || 1);
    
    // We scan Y from minY (top edge) downwards.
    // Restrict scan depth to avoid checking too deep in the sheet (margin is thin)
    const scanDepthLimit = 80;
    const limitY = Math.min(maxY, minY + scanDepthLimit);

    for (let y = minY; y <= limitY + 1e-6; y += step) {
      if (this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, true)) {
        lastValidY = y;
      }
    }
    return lastValidY;
  }

  _findMinValidXForRightMargin(orient, y, minX, maxX, allPlacements, config, workWidth, workHeight, spatialIndex) {
    let lastValidX = null;
    const step = Math.max(0.5, config.gridStep || 1);
    
    // We scan X from maxX (right edge) leftwards (decreasing X).
    // Restrict scan depth to avoid checking too deep in the sheet (margin is thin)
    const scanDepthLimit = 80;
    const limitX = Math.max(minX, maxX - scanDepthLimit);

    for (let x = maxX; x >= limitX - 1e-6; x -= step) {
      if (this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, true)) {
        lastValidX = x;
      }
    }
    return lastValidX;
  }

  _findMinValidYForBottomMargin(orient, x, minY, maxY, allPlacements, config, workWidth, workHeight, spatialIndex) {
    let lastValidY = null;
    const step = Math.max(0.5, config.gridStep || 1);
    const scanDepthLimit = 80;
    const limitY = Math.max(minY, maxY - scanDepthLimit);

    // Scan upwards from the bottom edge of the sheet (maxY) towards the center (decreasing Y)
    for (let y = maxY; y >= limitY - 1e-6; y -= step) {
      if (this._canPlaceSplitOrient(allPlacements, orient, x, y, config, workWidth, workHeight, spatialIndex, true)) {
        lastValidY = y;
      }
    }
    return lastValidY;
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
    let marginPlacementsCount = 0;

    // --- PHASE 1: TOP MARGIN ---
    const topOrients = orientVariants.filter(o => o.splitOutwardSide === 'top');
    const topPlacements = this._optimizeMarginDFS(
      sizeName, allPlacements, topOrients, 'top', config, workWidth, workHeight
    );
    for (const p of topPlacements) {
      allPlacements.push({
        ...p,
        id: `margin_fill_top_${marginPlacementsCount++}`
      });
    }

    // --- PHASE 2: RIGHT MARGIN ---
    const rightOrients = orientVariants.filter(o => o.splitOutwardSide === 'right');
    const rightPlacements = this._optimizeMarginDFS(
      sizeName, allPlacements, rightOrients, 'right', config, workWidth, workHeight
    );
    for (const p of rightPlacements) {
      allPlacements.push({
        ...p,
        id: `margin_fill_right_${marginPlacementsCount++}`
      });
    }

    // --- PHASE 3: BOTTOM MARGIN ---
    const bottomOrients = orientVariants.filter(o => o.splitOutwardSide === 'bottom');
    const bottomPlacements = this._optimizeMarginDFS(
      sizeName, allPlacements, bottomOrients, 'bottom', config, workWidth, workHeight
    );
    for (const p of bottomPlacements) {
      allPlacements.push({
        ...p,
        id: `margin_fill_bottom_${marginPlacementsCount++}`
      });
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
  }

  _optimizeMarginDFS(sizeName, basePlacements, orientVariants, marginType, config, workWidth, workHeight) {
    if (!orientVariants.length) return [];
    
    const spacing = config.spacing || 0;
    const isYBased = (marginType === 'right' || marginType === 'left');
    
    // Step 1: Generate candidates and cluster them
    const clusters = [];
    const allCandVals = [];
    for (const orient of orientVariants) {
      const bb = orient.bb || getBoundingBox(orient.polygon);
      const snappedVals = [];
      const seen = new Set();
      
      const addSnappedVal = (val) => {
        const rounded = roundMetric(val, 3);
        if (isYBased) {
          if (rounded + bb.minY < -1e-6 || rounded + bb.maxY > workHeight + 1e-6 || seen.has(rounded)) return;
        } else {
          if (rounded + bb.minX < -1e-6 || rounded + bb.maxX > workWidth + 1e-6 || seen.has(rounded)) return;
        }
        seen.add(rounded);
        snappedVals.push(rounded);
      };
      
      const wholePlacements = basePlacements.filter(p => !this._isSplitFillPlacement(p));
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        if (isYBased) {
          const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
          const snappedY = pCenterY - (bb.minY + bb.maxY) / 2;
          addSnappedVal(snappedY);
        } else {
          const pCenterX = p.x + (pbb.minX + pbb.maxX) / 2;
          const snappedX = pCenterX - (bb.minX + bb.maxX) / 2;
          addSnappedVal(snappedX);
        }
      }
      
      if (isYBased) {
        addSnappedVal(-bb.minY);
        addSnappedVal(workHeight - bb.maxY);
      } else {
        addSnappedVal(-bb.minX);
        addSnappedVal(workWidth - bb.maxX);
      }
      
      for (const baseVal of snappedVals) {
        for (const offset of [0, -3, 3, -6, 6]) {
          const rounded = roundMetric(baseVal + offset, 3);
          if (isYBased) {
            if (rounded + bb.minY >= -1e-6 && rounded + bb.maxY <= workHeight + 1e-6) {
              allCandVals.push(rounded);
            }
          } else {
            if (rounded + bb.minX >= -1e-6 && rounded + bb.maxX <= workWidth + 1e-6) {
              allCandVals.push(rounded);
            }
          }
        }
      }
    }
    
    const sortedVals = [...new Set(allCandVals)].sort((a, b) => a - b);
    if (sortedVals.length > 0) {
      let currentCluster = [sortedVals[0]];
      for (let i = 1; i < sortedVals.length; i++) {
        const val = sortedVals[i];
        const lastVal = currentCluster[currentCluster.length - 1];
        if (val - lastVal < 25) {
          currentCluster.push(val);
        } else {
          clusters.push(currentCluster);
          currentCluster = [val];
        }
      }
      clusters.push(currentCluster);
    }
    
    if (isYBased) {
      clusters.sort((a, b) => b[0] - a[0]); // bottom-to-top (descending Y)
    } else {
      clusters.sort((a, b) => a[0] - b[0]); // left-to-right (ascending X)
    }
    
    let bestState = {
      placements: [],
      score: -Infinity,
      pairs: 0,
      totalCount: 0
    };
    
    const currentPlacements = [...basePlacements];
    const self = this;
    
    function search(clusterIndex) {
      const splits = currentPlacements.slice(basePlacements.length);
      const numL = splits.filter(p => p.orient.foot === 'split-left').length;
      const numR = splits.filter(p => p.orient.foot === 'split-right').length;
      const pairs = Math.min(numL, numR);
      const totalCount = splits.length;
      
      // Prune
      const remaining = clusters.length - clusterIndex;
      const maxPossiblePairs = Math.floor((totalCount + remaining) / 2);
      if (maxPossiblePairs < bestState.pairs) {
        return;
      }
      if (maxPossiblePairs === bestState.pairs && totalCount + remaining < bestState.totalCount) {
        return;
      }
      
      if (clusterIndex === clusters.length) {
        let sumCoord = 0;
        let altBonus = 0;
        
        if (marginType === 'right') {
          sumCoord = splits.reduce((sum, p) => sum + p.x, 0);
        } else if (marginType === 'top') {
          sumCoord = splits.reduce((sum, p) => sum - p.y, 0);
        } else if (marginType === 'bottom') {
          sumCoord = splits.reduce((sum, p) => sum + p.y, 0);
        }
        
        const sorted = [...splits].sort((a, b) => {
          return isYBased ? a.y - b.y : a.x - b.x;
        });
        
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].orient.foot !== sorted[i + 1].orient.foot) {
            altBonus += 1000;
          }
        }
        
        const score = pairs * 10000000 + totalCount * 100000 + altBonus - sumCoord;
        
        if (score > bestState.score) {
          bestState = {
            placements: [...currentPlacements],
            score,
            pairs,
            totalCount
          };
        }
        return;
      }
      
      const cluster = clusters[clusterIndex];
      
      // Option 1: Place nothing in this cluster
      search(clusterIndex + 1);
      
      // Option 2 & 3: Try to place each orientVariant
      const spatialIndex = self._buildSpatialIndex(currentPlacements, workWidth, workHeight, spacing);
      
      for (const orient of orientVariants) {
        const bb = orient.bb || getBoundingBox(orient.polygon);
        
        let bestCoord = null;
        let bestSweepVal = null;
        
        for (const sweepVal of cluster) {
          if (isYBased) {
            let validX = null;
            if (marginType === 'right') {
              validX = self._findMinValidXForRightMargin(
                orient, sweepVal, 0, workWidth - bb.maxX, currentPlacements, config, workWidth, workHeight, spatialIndex
              );
            }
            if (validX !== null) {
              if (bestCoord === null || validX < bestCoord) {
                bestCoord = validX;
                bestSweepVal = sweepVal;
              }
            }
          } else {
            let validY = null;
            if (marginType === 'top') {
              validY = self._findMaxValidYForTopMargin(
                orient, sweepVal, -bb.minY, workHeight - bb.maxY, currentPlacements, config, workWidth, workHeight, spatialIndex
              );
            } else if (marginType === 'bottom') {
              validY = self._findMinValidYForBottomMargin(
                orient, sweepVal, 0, workHeight - bb.maxY, currentPlacements, config, workWidth, workHeight, spatialIndex
              );
            }
            
            if (validY !== null) {
              if (marginType === 'top') {
                if (bestCoord === null || validY > bestCoord) {
                  bestCoord = validY;
                  bestSweepVal = sweepVal;
                }
              } else {
                if (bestCoord === null || validY < bestCoord) {
                  bestCoord = validY;
                  bestSweepVal = sweepVal;
                }
              }
            }
          }
        }
        
        if (bestCoord !== null) {
          const placement = {
            id: `dfs_${marginType}_${clusterIndex}_${orient.foot}`,
            orient,
            x: isYBased ? bestCoord : bestSweepVal,
            y: isYBased ? bestSweepVal : bestCoord,
            effectiveArea: orient.areaMm2,
            isSplit: true
          };
          currentPlacements.push(placement);
          search(clusterIndex + 1);
          currentPlacements.pop();
        }
      }
    }
    
    search(0);
    return bestState.placements.slice(basePlacements.length);
  }

  _rankCandidateForSplitFill(candidate, workWidth, workHeight) {
    if (!candidate?.placements?.length) {
      return {
        wholeCount: 0,
        marginScore: 0,
        actualPairs: 0
      };
    }

    const bounds = candidate.bounds || computeEnvelope(candidate.placements);
    const wholeCount = getWholePlacementCount(candidate);
    const rightGap = Math.max(0, workWidth - bounds.maxX);
    const topGap = Math.max(0, bounds.minY);
    const bottomGap = Math.max(0, workHeight - bounds.maxY);
    return {
      wholeCount,
      marginScore: Math.max(rightGap, topGap, bottomGap) + rightGap * 0.5 + topGap * 0.25,
      actualPairs: candidate.actualPairs ?? candidate.pairs ?? 0
    };
  }


  _countRowsWithTrailingBlock(maxHeight, dyMm, workHeight, trailingOffsetMm = 0, trailingBlockHeightMm = 0) {
    let rows = 0;
    while (true) {
      const y = rows * dyMm;
      if (y + maxHeight + trailingOffsetMm + trailingBlockHeightMm > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _buildDoubleContourVariants(orient, dxMm, workWidth, workHeight, config, step, pairedOrient = null) {
    if (!this._dyCache) this._dyCache = new Map();
    const variants = [];
    const isCritical = true;
    const fastMode = config.doubleContourDeepSearch !== true;
    const maxCols = this._countCols(orient.width, dxMm, workWidth);
    const colChoices = [maxCols + 2, maxCols + 1, maxCols, maxCols - 1, maxCols - 2];
    const filteredColChoices = colChoices.filter(c => c > 0);
    if (filteredColChoices.length === 0) filteredColChoices.push(maxCols);
    

    const rowShiftRange = orient.width * 1.0; 
    let geometricShiftCandidates = extractInternalGapShiftCandidates(orient, step);
    
    // High-precision shifts to find the absolute best interlocking
    for (let s = 0; s <= rowShiftRange; s += 1.0) {
       geometricShiftCandidates.push({ dx: s, dy: 0 });
    }
    
    const manualStagger = Number(config.staggerSpacing);
    const pieceWidth = orient.bb ? (orient.bb.maxX - orient.bb.minX) : 100;
    const maxShiftX = Math.max(pieceWidth * 0.8, 50);
    const adaptiveShiftCandidates = Math.min(15, Math.max(4, Math.floor(pieceWidth / 10)));
    const baseShiftCandidates = buildShiftCandidates(maxShiftX, step, adaptiveShiftCandidates);
    if (Number.isFinite(manualStagger) && Math.abs(manualStagger) < rowShiftRange) {
      baseShiftCandidates.push(manualStagger);
      baseShiftCandidates.push(-manualStagger);
    }

    // Adaptive search depth based on piece size relative to sheet
    const sheetArea = (config.sheetWidth || 1000) * (config.sheetHeight || 2000);
    const pieceArea = orient.areaMm2 || 10000;
    const areaRatio = sheetArea / pieceArea;
    
    // Smaller pieces (high areaRatio) need deeper search for high-density interlock
    const shiftLimit = fastMode
      ? Math.max(32, Math.min(96, Math.floor(areaRatio * 1.1)))
      : Math.max(128, Math.min(384, Math.floor(areaRatio * 3)));

    const rowShiftCandidates = selectPrimaryRowShiftCandidates(
      geometricShiftCandidates,
      baseShiftCandidates,
      shiftLimit
    );
    // Add half-dx shift for brick-laying pattern (critical for figure-8 shapes)
    const halfDx = roundMetric(dxMm / 2, 3);
    if (!rowShiftCandidates.includes(halfDx) && halfDx > 0) rowShiftCandidates.push(halfDx);
    if (!rowShiftCandidates.includes(-halfDx) && halfDx > 0) rowShiftCandidates.push(-halfDx);
    
    // For small sizes, add more fractional shifts
    [1/3, 2/3, 1/4, 3/4].forEach(ratio => {
      const s = roundMetric(dxMm * ratio, 3);
      if (!rowShiftCandidates.includes(s)) rowShiftCandidates.push(s);
    });
    const rowShiftPairs = buildRowShiftPairs(orient, step, rowShiftCandidates);

    const dxCandidates = [dxMm];
    // Dynamic DX steps: proportional to piece width (coarse for large, fine for small)
    const dxStep = Math.max(0.5, roundMetric(orient.width * 0.01, 1));
    for (let offset = dxStep; offset <= dxStep * 3; offset += dxStep) {
      dxCandidates.push(roundMetric(dxMm + offset, 3));
    }
    
    // Explicitly try dx values that enable extra columns
    for (const extra of [1, 2, 3, 4, 5]) {
      const targetCols = maxCols + extra;
      const requiredDx = roundMetric((workWidth - 1) / targetCols, 3);
      if (requiredDx > orient.width * 0.55 && requiredDx < dxMm) {
        dxCandidates.push(requiredDx);
      }
    }

    // Try tighter dx values with adaptive steps
    const tighterStep = Math.max(1.0, roundMetric(orient.width * 0.05, 1));
    for (let offset = tighterStep; offset <= tighterStep * 5; offset += tighterStep) {
      const tighterDx = roundMetric(dxMm - offset, 3);
      if (tighterDx > orient.width * 0.65) {
        dxCandidates.push(tighterDx);
      }
    }

    // Adaptive variant limit: more variations for smaller, high-yield pieces
    const variantLimit = fastMode
      ? Math.max(36, Math.min(120, Math.floor(areaRatio * 1.2)))
      : Math.max(100, Math.min(400, Math.floor(areaRatio * 2)));

    for (const currentDx of dxCandidates) {
      // Pre-calculate Dy for all shifts for this DX (Dy does NOT depend on bodyCols)
      const shiftResults = [];
      
      // Pre-calculate a sample row with alternating orients for correct pitch detection
      const sampleRow = [
         { id: 's0', x: 0, y: 0, orient: orient },
         { id: 's1', x: currentDx, y: 0, orient: pairedOrient }
      ];

      // 1. Uniform (no shift)
      const alignedDyMm = this._findShiftedRowPitch(sampleRow, 0, 0, config, step);
      if (alignedDyMm != null) {
        shiftResults.push({ rowShiftXmm: 0, rowShiftYmm: 0, dy: alignedDyMm, mode: 'uniform-pitch-grid' });
      }

      // 2. Staggered shifts - SMART TIERED SEARCH
      let candidatePairs = rowShiftPairs;
      if (rowShiftPairs.length > (fastMode ? 12 : 20)) {
        // Stage 1: Fast Coarse Scan to find promising zones
        const coarseResults = [];
        const coarseStep = Math.max(1, Math.floor(rowShiftPairs.length / (fastMode ? 8 : 15))); 
        for (let i = 0; i < rowShiftPairs.length; i += coarseStep) {
          const { rowShiftXmm, rowShiftYmm } = rowShiftPairs[i];
          const dy = this._findShiftedRowPitch(sampleRow, rowShiftXmm, rowShiftYmm, config, step * 2);
          if (dy) coarseResults.push({ rowShiftXmm, rowShiftYmm, dy, index: i });
        }
        
        // Stage 2: Pick top 10% promising zones and scan neighbors
        coarseResults.sort((a, b) => a.dy - b.dy);
        const topZones = coarseResults.slice(0, Math.max(1, Math.ceil(coarseResults.length * (fastMode ? 0.08 : 0.10))));
        const finePool = new Set();
        // Add neighbors only for the absolute best zones
        const neighborhoodRadius = Math.max(1, Math.floor(coarseStep / 2));
        for (const zone of topZones) {
          for (let offset = -neighborhoodRadius; offset <= neighborhoodRadius; offset++) {
            const idx = zone.index + offset;
            if (idx >= 0 && idx < rowShiftPairs.length) finePool.add(rowShiftPairs[idx]);
          }
        }
        candidatePairs = [...finePool];
      }

      for (const { rowShiftXmm, rowShiftYmm } of candidatePairs) {
        const shiftedDyMm = this._findShiftedRowPitch(sampleRow, rowShiftXmm, rowShiftYmm, config, step);
        if (shiftedDyMm == null) continue;
        
        shiftResults.push({ 
          rowShiftXmm: roundMetric(rowShiftXmm), 
          rowShiftYmm: roundMetric(rowShiftYmm), 
          dy: shiftedDyMm, 
          mode: 'staggered-double-contour' 
        });
      }

      for (const bodyCols of colChoices) {
        if (bodyCols <= 0) continue;

        const rowAlternateOrient = pairedOrient && pairedOrient.angle !== orient.angle
          ? pairedOrient
          : null;
        const uniformRowPlacements = this._buildShiftedUniformPlacements(
          orient,
          bodyCols,
          1,
          currentDx,
          orient.height + config.spacing + step * 2,
          0,
          0,
          0,
          rowAlternateOrient,
          config
        );
        const uniformBodyHeightMm = roundMetric(
          getPlacementsBottom(uniformRowPlacements) - getPlacementsTop(uniformRowPlacements),
          3
        );

        for (const res of shiftResults) {
          variants.push({
            rowPlacements: uniformRowPlacements,
            bodyCols,
            bodyDxMm: currentDx,
            pieceArea: pieceArea, 
            bodyHeightMm: uniformBodyHeightMm,
            bodyDyMm: res.dy,
            rowShiftXmm: res.rowShiftXmm,
            rowShiftYmm: res.rowShiftYmm,
            scanOrder: res.mode === 'uniform-pitch-grid' ? 'uniform-pitch-grid' : 'staggered-double-contour',
            bodyPatternMode: rowAlternateOrient
              ? (res.mode === 'uniform-pitch-grid' ? 'double-insole-aligned-alternating-pitch' : 'double-insole-aligned-alternating-staggered')
              : (res.mode === 'uniform-pitch-grid' ? 'double-insole-uniform-pitch' : 'double-insole-staggered-row-shift'),
            bodyPrimaryAngle: orient.angle,
            bodyAlternateAngle: rowAlternateOrient?.angle ?? orient.angle
          });
          if (variants.length >= variantLimit) break;
        }
        if (variants.length >= variantLimit) break;
      }
      if (variants.length >= variantLimit) break;
    }

    const sequentialRows = [];
    const buildUniqueSequentialRows = (pOrient, aOrient, scanOrder, patternMode) => {
      const allRows = [];
      const height = Math.max(pOrient.height, aOrient.height);

      const colShiftYCandidates = [0];
      const landmarks = [0, 0.25, 0.5, 0.75, 1.0]; // Smart landmarks for common interlock patterns
      for (const ratio of landmarks) {
        const dy = roundMetric(height * ratio, 3);
        if (dy > 0) {
          colShiftYCandidates.push(dy, -dy);
        }
      }

      // KEY IMPROVEMENT: When alternating orientations (pOrient ≠ aOrient),
      // use _findAlignedBodyDx which computes the TIGHTER interlocking spacing
      // where the concave part of one piece fits into the convex part of the adjacent piece.
      // This typically yields 10-20% more pieces per row compared to uniform dx.
      const safetySpacing = config.spacing || 0;
      const uniformDx = this._findUniformDx(pOrient, { ...config, spacing: safetySpacing }, step);
      const alignedDx = this._findAlignedBodyDx(pOrient, aOrient, { ...config, spacing: safetySpacing }, step);
      // Use the tighter of the two, but only if aligned dx is valid
      const dxMm = (alignedDx != null && alignedDx < uniformDx) ? alignedDx : uniformDx;

      for (const colShiftYmm of colShiftYCandidates) {
        const rowPlacements = this._buildShiftedUniformPlacements(
          pOrient,
          100, 
          1,
          dxMm,
          pOrient.height + safetySpacing + step * 2,
          0,
          colShiftYmm,
          0,
          aOrient,
          config
        );

        const actualPlacements = [];
        for (const p of rowPlacements) {
          if (p.x + p.orient.bb.maxX <= workWidth + 1e-6) {
            actualPlacements.push(p);
          } else {
            break;
          }
        }

        if (actualPlacements.length > 0) {
          const rowWidth = getPlacementsRight(actualPlacements) - getPlacementsLeft(actualPlacements);
          allRows.push({
            placements: actualPlacements,
            count: actualPlacements.length,
            width: rowWidth,
            colShiftYmm
          });
        }
      }

      allRows.sort((a, b) => b.count - a.count || a.width - b.width);
      const seen = new Set();
      const unique = [];
      const searchDepth = fastMode
        ? Math.max(3, Math.min(8, Math.floor(areaRatio * 0.08)))
        : Math.max(10, Math.min(30, Math.floor(areaRatio * 0.3)));

      for (const item of allRows) {
        const key = `${item.count}_${item.width.toFixed(1)}`; // Coarser key to group similar patterns
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
        if (unique.length >= searchDepth) break; 
      }

      for (const item of unique) {
        sequentialRows.push({
          placements: item.placements,
          scanOrder: item.colShiftYmm === 0 ? scanOrder : `${scanOrder}-col-shift-${item.colShiftYmm}`,
          bodyPatternMode: patternMode,
          primaryAngle: pOrient.angle,
          alternateAngle: aOrient.angle
        });
      }
    };

    buildUniqueSequentialRows(orient, pairedOrient, 'alternating-double-contour', 'double-insole-alternating-row');
    buildUniqueSequentialRows(orient, orient, 'same-side-double-contour', 'double-insole-same-side-row');

    for (const sequentialRow of sequentialRows) {
      const sequentialRowPlacements = sequentialRow.placements;
      if (!sequentialRowPlacements.length) continue;

      const sequentialBodyHeightMm = roundMetric(
        getPlacementsBottom(sequentialRowPlacements) - getPlacementsTop(sequentialRowPlacements),
        3
      );
      const sequentialDyMm = this._findSequentialRowPitch(sequentialRowPlacements, config, step);
      if (sequentialDyMm != null) {
        variants.push({
          rowPlacements: sequentialRowPlacements,
          bodyCols: sequentialRowPlacements.length,
          bodyDxMm: getAveragePitchX(sequentialRowPlacements),
          bodyHeightMm: sequentialBodyHeightMm,
          bodyDyMm: sequentialDyMm,
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          scanOrder: sequentialRow.scanOrder,
          bodyPatternMode: sequentialRow.bodyPatternMode,
          bodyPrimaryAngle: sequentialRow.primaryAngle,
          bodyAlternateAngle: sequentialRow.alternateAngle
        });
      }

      for (const { rowShiftXmm, rowShiftYmm } of rowShiftPairs) {
        const cacheKey = `${sequentialRow.primaryAngle}_${sequentialRow.alternateAngle}_${rowShiftXmm}_${rowShiftYmm}`;
        let shiftedDyMm = this._dyCache.get(cacheKey);
        if (shiftedDyMm === undefined) {
          const safetyConfig = config;
          shiftedDyMm = this._findShiftedRowPitch(sequentialRowPlacements, rowShiftXmm, rowShiftYmm, safetyConfig, step);
          this._dyCache.set(cacheKey, shiftedDyMm);
        }
        if (shiftedDyMm == null) continue;
        variants.push({
          rowPlacements: sequentialRowPlacements,
          bodyCols: sequentialRowPlacements.length,
          bodyDxMm: getAveragePitchX(sequentialRowPlacements),
          bodyHeightMm: sequentialBodyHeightMm,
          bodyDyMm: shiftedDyMm,
          rowShiftXmm: roundMetric(rowShiftXmm),
          rowShiftYmm: roundMetric(rowShiftYmm),
          scanOrder: `${sequentialRow.scanOrder}-staggered`,
          bodyPatternMode: `${sequentialRow.bodyPatternMode}-staggered`,
          bodyPrimaryAngle: sequentialRow.primaryAngle,
          bodyAlternateAngle: sequentialRow.alternateAngle
        });
      }
    }

    // Unified Ranking: Absolute priority is piece count. Alignment is the tie-breaker.
    variants.sort((a, b) => {
      // Use faster ranking for base variants
      const aRank = rankDoubleContourVariant(a, workWidth, workHeight);
      const bRank = rankDoubleContourVariant(b, workWidth, workHeight);
      
      // 1. Primary Priority: Total Piece Count
      if (bRank.estimatedCount !== aRank.estimatedCount) {
        return bRank.estimatedCount - aRank.estimatedCount;
      }
      
      // 2. Secondary Priority: Efficiency / High Utilization
      if (bRank.utilization !== aRank.utilization) {
         return bRank.utilization - aRank.utilization;
      }

      // 3. Tertiary Priority: Alignment (Ngay hàng thẳng lối)
      const aAlign = (a.bodyDxMm % 5 < 0.1 || a.bodyDxMm % 5 > 4.9) ? 1 : 0;
      const bAlign = (b.bodyDxMm % 5 < 0.1 || b.bodyDxMm % 5 > 4.9) ? 1 : 0;
      return bAlign - aAlign;
    });

    // ULTRA SMART SKIP: If the top base variant is already good, skip the rest
    if (variants.length > 0) {
       const topRank = rankDoubleContourVariant(variants[0], workWidth, workHeight);
       // More aggressive skip for non-critical sizes
       if (topRank.utilization > (isCritical ? 0.98 : 0.85)) {
          return variants.slice(0, 1);
       }
    }

    const limit = fastMode ? 120 : (isCritical ? 1000 : 2); 
    return variants.slice(0, limit);
  }
  _evaluateFootCandidateForAngles(sizeName, foot, polygon, config, workWidth, workHeight, angles) {
    const isCritical = true; // High quality by default for all sizes
    const fastMode = config.doubleContourDeepSearch !== true;
    const pieceArea = polygonArea(polygon) || 1;
    const step = (config.gridStep || (isCritical ? 0.5 : 1));
    let bestCandidate = null;
    const candidatePool = [];
    const angleStates = [];

    // HYPER-OPTIMIZATION: For non-critical sizes, only evaluate the first angle (0 degrees) to save time.
    const filteredAngles = isCritical ? angles : [angles[0]];
    
    for (const angle of filteredAngles) {
      const orient = this._decorateOrient(sizeName, 'X', polygon, angle, config, step);
      
      const relativePairedAngles = fastMode ? [180, 90, 270] : [180, 90, 270, 0];
      for (const relAngle of relativePairedAngles) {
        const pairedAngle = normalizeAngleDegrees(angle + relAngle);
        const pairedOrient = {
          ...this._decorateOrient(sizeName, 'X', polygon, pairedAngle, config, step),
          isAlternate: (relAngle !== 0)
        };

      const modes = ['aligned', 'uniform'];
      const variantLimit = fastMode
        ? (pieceArea > 25000 ? 72 : 56)
        : (pieceArea > 25000 ? 500 : 200);

      for (const mode of modes) {
        const dxMm = (mode === 'aligned') 
          ? this._findAlignedBodyDx(orient, pairedOrient, config, step) 
          : this._findUniformDx(orient, config, step);
          
        if (dxMm == null) continue;

        const variants = this._buildDoubleContourVariants(
          orient, 
          dxMm, 
          workWidth, 
          workHeight, 
          config, 
          step, 
          (mode === 'aligned' ? pairedOrient : orient)
        ).slice(0, variantLimit);

        if (!variants.length) continue;

        let filler90Orient = null;
        let filler90DxMm = null;
        let filler90DyMm = null;
        let filler90Cols = 0;
        let maxFiller90Rows = 0;

        if (config.allowRotate90 !== false) {
          const filler90Angle = (angle + 90) % 360;
          filler90Orient = this._decorateOrient(sizeName, 'X', polygon, filler90Angle, config, step);
          filler90DxMm = this._findUniformDx(filler90Orient, config, step);
          if (filler90DxMm != null) {
            filler90DyMm = this._findUniformDy(filler90Orient, filler90DxMm, config, step);
            if (filler90DyMm != null) {
              filler90Cols = this._countCols(filler90Orient.width, filler90DxMm, workWidth);
              maxFiller90Rows = this._countRows(filler90Orient.height, filler90DyMm, workHeight);
            }
          }
        }

        angleStates.push({
          orient,
          variants,
          filler90Orient,
          filler90DxMm,
          filler90DyMm,
          filler90Cols,
          maxFiller90Rows
        });
      }
    }
}

    for (const state of angleStates) {
      const { orient, variants } = state;

      for (const variant of variants) {
        const bodyCols = variant.bodyCols;
        const maxCols = variant.rowPlacements.length;
        const bodyRows = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight, variant.rowShiftYmm || 0) + 1;
        if (!bodyCols || !bodyRows) continue;

        const bodyPlacements = [];
        const startX = variant.rowShiftXmm < 0 ? -variant.rowShiftXmm : 0;
        const startY = -Math.min(0, variant.rowShiftYmm);

        for (let row = 0; row < bodyRows; row++) {
          const isOddRow = row % 2 === 1;
          const shiftX = isOddRow ? variant.rowShiftXmm : 0;
          const shiftY = isOddRow ? variant.rowShiftYmm : 0;
          
          for (let col = 0; col < maxCols; col++) {
            const rowPlacement = variant.rowPlacements[col % variant.rowPlacements.length];
            const currentOrient = rowPlacement.orient;
            const itemX = roundMetric(startX + rowPlacement.x + shiftX, 3);
            const itemY = roundMetric(startY + rowPlacement.y + row * variant.bodyDyMm + shiftY, 3);

            bodyPlacements.push({
              id: `body_${row}_${col}`,
              orient: currentOrient,
              x: itemX,
              y: itemY
            });
          }
        }

        const finalPlacements = this._filterPlacementsInBounds(bodyPlacements, workWidth, workHeight);

        if (!finalPlacements.length) continue;

        const bodyOnlyCandidate = this._buildCandidate(
          sizeName,
          foot,
          pieceArea,
          finalPlacements,
          {
            rowMode: 'uniform',
            bodyCount: finalPlacements.length,
            bodyCols,
            bodyRows,
            bodyDxMm: variant.bodyDxMm,
            bodyDyMm: variant.bodyDyMm,
            bodyStartY: 0,
            bodyPrimaryAngle: variant.bodyPrimaryAngle ?? orient.angle,
            bodyAlternateAngle: variant.bodyAlternateAngle ?? orient.angle,
            bodyPatternMode: variant.bodyPatternMode,
            bodyRotationOffset: 0,
            bodyStartPattern: 'uniform',
            rowShiftXmm: variant.rowShiftXmm,
            rowShiftYmm: variant.rowShiftYmm,
            filler90Used: false,
            filler90Count: 0,
            filler90Cols: 0,
            filler90Rows: 0,
            filler90TopRows: 0,
            filler90BottomRows: 0,
            filler90DxMm: null,
            filler90DyMm: null,
            filler270DyMm: null,
            filler90Angle: null,
            filler270Angle: null,
            fillerPatternKey: 'none',
            fillerPatternPriority: 99,
            fillerRotationOffset: 0,
            fillerStartPattern: 'none',
            scanOrder: variant.scanOrder
          },
          workWidth,
          workHeight,
          config
        );
        const finalizedBodyOnlyCandidate = bodyOnlyCandidate ? this._finalizeCandidate(bodyOnlyCandidate, config, workWidth, workHeight) : null;
        if (finalizedBodyOnlyCandidate) {
          if (compareDoubleInsoleCandidates(finalizedBodyOnlyCandidate, bestCandidate) < 0) {
            bestCandidate = finalizedBodyOnlyCandidate;
          }
          addRankedCandidate(candidatePool, finalizedBodyOnlyCandidate, config.preparedSplitFillCandidateLimit);
        }
      }
    }

    for (const state of angleStates) {
      const {
        orient,
        variants,
        filler90Orient,
        filler90DxMm,
        filler90DyMm,
        filler90Cols,
        maxFiller90Rows
      } = state;
      if (!filler90Cols) continue;

      for (const variant of variants) {
        const bodyCols = variant.bodyCols;
        if (!bodyCols) continue;
        const bodyRowsNoFiller = this._countRows(variant.bodyHeightMm, variant.bodyDyMm, workHeight, variant.rowShiftYmm || 0);
        if (!bodyRowsNoFiller) continue;

        const bodyOnlyCount = bodyCols * bodyRowsNoFiller;
        const optimisticCount = bodyOnlyCount + filler90Cols * 2;
        if (bestCandidate && optimisticCount < getWholePlacementCount(bestCandidate)) {
          continue;
        }

        const bodyRowPlacements = variant.rowPlacements;
        const isFastMode = config.preparedSplitFillDeep === false;
        
        let fillerColOptions = [filler90Cols, filler90Cols - 1, filler90Cols - 2, filler90Cols - 3, filler90Cols - 4].filter(c => c > 0);
        if (fillerColOptions.length === 0 && filler90Cols > 0) fillerColOptions = [filler90Cols];
        if (isFastMode && fillerColOptions.length > 0) {
          fillerColOptions = [fillerColOptions[0]];
        }
        
        const fillerRowOptions = filler90Cols > 0 ? maxFiller90Rows : 0;
        let fillerRowCountOptions = buildFillerRowCountChoices(fillerRowOptions);
        if (isFastMode && fillerRowCountOptions.length > 0) {
          const finalChoices = new Set([0]);
          if (fillerRowOptions >= 1) finalChoices.add(1);
          if (fillerRowOptions > 1) finalChoices.add(fillerRowOptions);
          fillerRowCountOptions = [...finalChoices].sort((a, b) => a - b);
        }

        for (const filler90ColsChoice of fillerColOptions) {
          const fillerRowWidth = filler90ColsChoice > 0
            ? roundMetric(filler90Orient.width + (filler90ColsChoice - 1) * filler90DxMm)
            : 0;
          let fillerStartXCandidates = filler90ColsChoice > 0
            ? [...new Set([
              0,
              roundMetric(Math.max(0, (workWidth - fillerRowWidth) / 2)),
              roundMetric(Math.max(0, workWidth - fillerRowWidth))
            ])]
            : [0];
          if (isFastMode && filler90ColsChoice > 0) {
            fillerStartXCandidates = [0];
          }

          for (const filler90TopRows of fillerRowCountOptions) {
            const topStartOptions = filler90TopRows > 0 ? fillerStartXCandidates : [0];

            for (const topFillerStartX of topStartOptions) {
              const topSampleRowPlacements = filler90TopRows > 0
                ? this._buildUniformPlacementsAtX(
                  filler90Orient,
                  filler90ColsChoice,
                  1,
                  filler90DxMm,
                  filler90DyMm,
                  topFillerStartX,
                  0
                )
                : [];
              const bodyStartOffsetAfterFillerRow = topSampleRowPlacements.length
                ? this._findBodyStartOffsetAfterFillerRow(
                  topSampleRowPlacements,
                  bodyRowPlacements,
                  config,
                  step
                )
                : 0;
              if (filler90TopRows > 0 && bodyStartOffsetAfterFillerRow == null) continue;

              for (const filler90BottomRows of fillerRowCountOptions) {
                if (!shouldTryFillerRowCombination(filler90TopRows, filler90BottomRows, fillerRowOptions)) continue;
                const bottomStartOptions = filler90BottomRows > 0 ? fillerStartXCandidates : [0];

                for (const bottomFillerStartX of bottomStartOptions) {
                  const bottomSampleRowPlacements = filler90BottomRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      1,
                      filler90DxMm,
                      filler90DyMm,
                      bottomFillerStartX,
                      0
                    )
                    : [];
                  const fillerStartOffsetAfterBodyRow = bottomSampleRowPlacements.length
                    ? this._findBodyStartOffsetAfterFillerRow(
                      bodyRowPlacements,
                      bottomSampleRowPlacements,
                      config,
                      step
                    )
                    : 0;
                  if (filler90BottomRows > 0 && fillerStartOffsetAfterBodyRow == null) continue;

                  const isHighQuality = true; // Use high-quality offset search for all sizes
                  if (filler90BottomRows > 0 && fillerStartOffsetAfterBodyRow == null) continue;

                  const lastTopFillerRowY = filler90TopRows > 0
                    ? roundMetric((filler90TopRows - 1) * filler90DyMm)
                    : 0;
                  const bodyStartY = filler90TopRows > 0
                    ? roundMetric(lastTopFillerRowY + bodyStartOffsetAfterFillerRow)
                    : 0;
                  const bottomFillerBlockHeight = filler90BottomRows > 0
                    ? roundMetric(filler90Orient.height + (filler90BottomRows - 1) * filler90DyMm)
                    : 0;

                  const bodyRows = this._countRowsWithTrailingBlock(
                    variant.bodyHeightMm,
                    variant.bodyDyMm,
                    Math.max(0, workHeight - bodyStartY),
                    filler90BottomRows > 0 ? fillerStartOffsetAfterBodyRow : 0,
                    bottomFillerBlockHeight
                  ) + 1;
                  if (!bodyCols || !bodyRows) continue;

                  let actualTopFillerDy = filler90DyMm;
                  if (filler90TopRows > 1 && bodyRows > 0) {
                    const bodyDy = variant.bodyDyMm;
                    const N = Math.ceil(filler90DyMm / bodyDy);
                    const alignedDy = N * bodyDy;
                    if (0 + (filler90TopRows - 1) * alignedDy + filler90Orient.height <= workHeight + 1e-6) {
                      actualTopFillerDy = alignedDy;
                    }
                  }

                  const topFillerPlacements = filler90TopRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90TopRows,
                      filler90DxMm,
                      actualTopFillerDy,
                      topFillerStartX,
                      0
                    )
                    : [];
                  // Targeted body offsets: Optimized set for small sizes
                  const bodyOffsetChoices = isHighQuality ? [0, 3, 6] : [0]; 
                  for (const bodyOffsetX of bodyOffsetChoices) {
                    const bodyPlacements = this._buildRepeatedBodyPlacements(
                      variant.rowPlacements,
                      bodyRows,
                      variant.bodyDyMm,
                      bodyStartY,
                      variant.rowShiftXmm,
                      variant.rowShiftYmm,
                      bodyOffsetX
                    );
                  const bottomFillerStartY = filler90BottomRows > 0
                    ? roundMetric(bodyStartY + (bodyRows - 1) * variant.bodyDyMm + fillerStartOffsetAfterBodyRow)
                    : null;
                  let actualBottomFillerDy = filler90DyMm;
                  if (filler90BottomRows > 1 && bodyRows > 0) {
                    const bodyDy = variant.bodyDyMm;
                    const N = Math.ceil(filler90DyMm / bodyDy);
                    const alignedDy = N * bodyDy;
                    if (bottomFillerStartY + (filler90BottomRows - 1) * alignedDy + filler90Orient.height <= workHeight + 1e-6) {
                      actualBottomFillerDy = alignedDy;
                    }
                  }

                  const bottomFillerPlacements = filler90BottomRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90BottomRows,
                      filler90DxMm,
                      actualBottomFillerDy,
                      bottomFillerStartX,
                      bottomFillerStartY
                    )
                    : [];
                  const combinedPlacements = [...topFillerPlacements, ...bodyPlacements, ...bottomFillerPlacements];
                  const finalPlacements = this._filterPlacementsInBounds(combinedPlacements, workWidth, workHeight);

                  if (!finalPlacements.length) continue;

                  const finalBodyCount = finalPlacements.filter(p => p.id.includes('body') || p.id.includes('double_insole')).length;
                  const finalFillerCount = finalPlacements.filter(p => p.id.includes('fill90') || p.id.includes('filler')).length;
                  const totalPlacedCount = finalPlacements.length;

                  if (bestCandidate && totalPlacedCount < getWholePlacementCount(bestCandidate)) continue;

                  const candidateMetadata = {
                    rowMode: 'uniform',
                    bodyCount: finalBodyCount,
                    bodyCols,
                    bodyRows,
                    bodyDxMm: variant.bodyDxMm,
                    bodyDyMm: variant.bodyDyMm,
                    bodyStartY,
                    bodyPrimaryAngle: variant.bodyPrimaryAngle ?? orient.angle,
                    bodyAlternateAngle: variant.bodyAlternateAngle ?? orient.angle,
                    bodyPatternMode: variant.bodyPatternMode,
                    bodyRotationOffset: 0,
                    bodyStartPattern: filler90TopRows > 0 ? 'after-top-rotated-filler' : 'uniform',
                    rowShiftXmm: variant.rowShiftXmm,
                    rowShiftYmm: variant.rowShiftYmm,
                    filler90Used: finalFillerCount > 0,
                    filler90Count: finalFillerCount,
                    filler90Cols: finalFillerCount > 0 ? filler90ColsChoice : 0,
                    filler90Rows: filler90TopRows + filler90BottomRows,
                    filler90TopRows,
                    filler90BottomRows,
                    filler90DxMm: finalFillerCount > 0 ? filler90DxMm : null,
                    filler90DyMm: finalFillerCount > 0 ? filler90DyMm : null,
                    filler270DyMm: null,
                    filler90Angle: finalFillerCount > 0 ? filler90Orient?.angle ?? null : null,
                    filler270Angle: null,
                    fillerPatternKey: finalFillerCount > 0
                      ? (filler90TopRows > 0 && filler90BottomRows > 0
                        ? 'top-bottom-rotated-rows'
                        : filler90TopRows > 0
                          ? 'top-rotated-rows'
                          : 'bottom-rotated-rows')
                      : 'none',
                    fillerPatternPriority: finalFillerCount > 0 ? 1 : 99,
                    fillerRotationOffset: 0,
                    fillerStartPattern: finalFillerCount > 0 ? 'uniform-90' : 'none',
                    scanOrder: finalFillerCount > 0 ? `${variant.scanOrder}-with-rotated-filler` : variant.scanOrder
                  };

                  const candidate = {
                    sizeName,
                    foot,
                    pieceArea,
                    placements: finalPlacements,
                    placedCount: finalPlacements.length,
                    ...candidateMetadata,
                    patternInfo: candidateMetadata
                  };

                  const finalizedVariant = this._finalizeCandidate(candidate, config, workWidth, workHeight);
                  if (!finalizedVariant) continue;

                  // Early Exit: Stop searching if target yield is reached for small sizes
                  // Size 3.5: 64, Size 4.0-5.0: 60, Size 6.0: 53
                  const currentPairs = finalizedVariant.actualPairs || 0;
                  const currentEfficiency = finalizedVariant.efficiency || 0;
                  let targetYield = config.targetPairs || 0;
                  // Remove hardcoded targets to ensure adaptability to any input file
                  
                  // Aggressive Exit for sub-100s:
                  if (targetYield > 0 && currentPairs >= targetYield) {
                    return finalizedVariant;
                  }
                  if (!isCritical && currentEfficiency > 0.76) {
                    return finalizedVariant; // Fast exit for non-critical sizes
                  }

                  const bodyOnlyPairs = getWholePairsPlaced(bestCandidate);
                  const fillerPairs = getWholePairsPlaced(finalizedVariant);
                  const leftoverDrop = (bestCandidate?.leftoverAreaMm2 || 0) - (finalizedVariant.leftoverAreaMm2 || 0);
                  const shouldKeepFiller = fillerPairs > bodyOnlyPairs
                    || leftoverDrop <= Math.max(workWidth * workHeight * 0.04, 1);
                  if (!shouldKeepFiller) continue;

                  // Intelligent Ranking: Favor variants with more pairs, then higher efficiency
                  if (!bestCandidate || compareDoubleInsoleCandidates(finalizedVariant, bestCandidate) < 0) {
                    bestCandidate = finalizedVariant;
                  }
                  
                  // Early Exit Check: Only stop if we've hit a high-efficiency ceiling 
                  // AND it's mathematically unlikely to fit another pair.
                  const areaPerPair = (pieceArea * 2);
                  const remainingPotential = Math.floor(finalizedVariant.leftoverAreaMm2 / areaPerPair);
                  
                  if (currentEfficiency > 0.84 && remainingPotential === 0) {
                    return finalizedVariant;
                  }
                  
                  addRankedCandidate(candidatePool, finalizedVariant, config.preparedSplitFillCandidateLimit);
                }
              }
            }
          }
        }
      }
    }
  }

    if (config.preparedSplitFillEnabled === true && candidatePool.length) {
      // SMART PRUNING: Sort and only take the TOP 2 candidates for filler search.
      // 99% of the time, the best filler layout comes from the best base layout.
      // SMART PRUNING: Only take the BEST candidate for filler search.
      candidatePool.sort(compareDoubleInsoleCandidates);
      
      // Smart Skip: Exit early only if target yield is high AND no space for more
      const pieceArea = candidatePool[0].pieceArea || 10000;
      const theoreticalMax = (workWidth * workHeight) / (pieceArea * 2); // Theoretical max pairs
      const currentPairs = candidatePool[0].actualPairs || 0;
      const currentEfficiency = candidatePool[0].efficiency || 0;
      
      // If we are at >82% efficiency and it's impossible to add another full pair, we stop.
      const canFitMore = (currentPairs + 1) <= (theoreticalMax * 0.98); 
      
      if (currentEfficiency > 0.82 && !canFitMore) {
        return candidatePool[0];
      }

      // DIVERSITY-FIRST SELECTION: Take top 15 from each orientation to ensure we don't miss "gems" 
      // like the Horizontal pattern for Size 6 that allows fillers.
      const topCandidates = [...candidatePool]
        .sort((left, right) => {
          const leftRank = this._rankCandidateForSplitFill(left, workWidth, workHeight);
          const rightRank = this._rankCandidateForSplitFill(right, workWidth, workHeight);
          return rightRank.wholeCount - leftRank.wholeCount
            || rightRank.marginScore - leftRank.marginScore
            || rightRank.actualPairs - leftRank.actualPairs
            || compareDoubleInsoleCandidates(left, right);
        })
        .slice(0, fastMode ? 16 : 80);
      
      const splitCandidates = topCandidates.map(c => c.placed ? c : this._finalizeCandidate(c, config, workWidth, workHeight));
      for (const candidate of splitCandidates) {
        if (!candidate) continue;
        if (!candidate.placements?.length) continue;

        // Whole pieces are the base objective; split fillers may only improve equal-base layouts.
        const currentWholeCount = getWholePlacementCount(candidate);
        const currentBestWholeCount = bestCandidate ? getWholePlacementCount(bestCandidate) : 0;
        if (currentWholeCount < currentBestWholeCount) continue;

        const augmentedCandidate = this._augmentCandidateWithSplitFillers(
          sizeName,
          polygon,
          candidate,
          config,
          workWidth,
          workHeight
        );
        if (augmentedCandidate && compareDoubleInsoleCandidates(augmentedCandidate, bestCandidate) < 0) {
          bestCandidate = augmentedCandidate;
        }
        
        // Early Exit if target yield hit
        if (bestCandidate?._hitTarget) break;
      }

    }

    if (this._dyCache) this._dyCache.clear();
    return bestCandidate;
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    // Removed redundant log for cleaner output

    const preferredAngles = this._getDoubleContourPreferredAngles(sizeName, config).filter(a => a < 180);
    let bestCandidate = this._evaluateFootCandidateForAngles(
      sizeName,
      foot,
      polygon,
      config,
      workWidth,
      workHeight,
      preferredAngles
    );

    const fallbackSameSideCandidate = CapacityTestSameSidePattern.prototype._evaluateFootCandidate.call(
      this,
      sizeName,
      foot,
      polygon,
      config,
      workWidth,
      workHeight
    );
    const fallbackCandidate = fallbackSameSideCandidate && config.preparedSplitFillEnabled === true
      ? this._augmentCandidateWithSplitFillers(
        sizeName,
        polygon,
        fallbackSameSideCandidate,
        config,
        workWidth,
        workHeight
      )
      : attachLeftoverMetrics(fallbackSameSideCandidate, workWidth, workHeight);
    if (
      fallbackCandidate &&
      (
        !bestCandidate ||
        compareDoubleInsoleCandidates(fallbackCandidate, bestCandidate) < 0
      )
    ) {
      bestCandidate = fallbackCandidate;
    }

    if (bestCandidate) {
    }
    return bestCandidate;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const internals = placement.orient.internals || [];
      // Robust renderKey including angle and isAlternate
      const renderKey = `${placement.orient.foot || 'X'}_${placement.orient.angle}_${placement.orient.isAlternate ? 'alt' : 'main'}`;

      if (!renderTemplates[renderKey]) {
        // Build path including holes (M...Z M...Z)
        let svgPath = polygon.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ') + ' Z';
        if (internals.length > 0) {
          internals.forEach(path => {
            if (path.length > 1) {
              svgPath += ' ' + path.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ') + ' Z';
            }
          });
        }

        renderTemplates[renderKey] = {
          path: svgPath,
          labelOffset: {
            x: roundMetric(polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length),
            y: roundMetric(polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length)
          }
        };
      }

      const foot = placement.orient.foot || 'X';
      const isHalf = foot.startsWith('split-') || foot === 'L' || foot === 'R';

      return {
        id: `${sizeName}_${foot}_${index}`,
        sizeName,
        foot: foot,
        pieceCount: isHalf ? 1 : 2,
        x: roundMetric(worldX, 3),
        y: roundMetric(worldY, 3),
        angle: placement.orient.angle,
        polygon: translate(polygon, worldX, worldY),
        cycPolygon: translate(placement.orient.cycPolygon || polygon, worldX, worldY),
        internals: internals.map(path => translate(path, worldX, worldY)),
        renderKey,
        areaMm2: placement.effectiveArea
          ?? placement.orient.areaMm2
          ?? polygonArea(polygon)
      };
    });

    return { placed: items, renderTemplates };
  }

  _finalizeCandidate(candidate, config, workWidth, workHeight, fastOnly = true) {
    if (!candidate?.placements?.length) return null;
    
    // Align margin splits before finalizing candidate
    const alignedPlacements = this._alignMarginSplits(candidate.placements, config, workWidth, workHeight);
    const bounds = computeEnvelope(alignedPlacements);
    if (
      bounds.minX < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > workWidth + 1e-6 ||
      bounds.maxY > workHeight + 1e-6
    ) {
      return null;
    }
    const usedAreaMm2 = candidate.usedAreaMm2 || alignedPlacements.reduce((sum, p) => sum + (p.effectiveArea || p.orient?.areaMm2 || 0), 0);
    
    // CRITICAL: Final overlap validation to prevent >100% efficiency and physically impossible layouts
    if (alignedPlacements.length > 1) {
      const validation = validateLocalPlacements(alignedPlacements, config.spacing || 0);
      if (!validation.valid) {
        return null;
      }
    }

    const updatedCandidate = {
      ...candidate,
      placements: alignedPlacements,
      bounds,
      usedAreaMm2
    };
    candidate = updatedCandidate;


    const totalPieces = candidate.placements.reduce((sum, p) => {
      const f = p.orient?.foot || 'X';
      const isHalf = f.startsWith('split-') || f === 'L' || f === 'R';
      // In double-contour strategy, if it's not a split half, it's a pre-nested pair (2 pieces)
      return sum + (isHalf ? 1 : 2);
    }, 0);
    const pairs = totalPieces / 2;

    if (fastOnly) {
      const leftoverMetrics = computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2);
      return {
        ...candidate,
        usedWidthMm: roundMetric(bounds.width),
        usedHeightMm: roundMetric(bounds.height),
        usedAreaMm2,
        envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - usedAreaMm2)),
        maxPairsPlaced: Math.floor(pairs),
        ...leftoverMetrics,
        placedCount: totalPieces,
        pairs,
        actualPairs: pairs,
        bounds
      };
    }

    const materialized = this._materializePlacedItems(candidate.sizeName, candidate.placements, config);

    let l = 0, r = 0, dc = 0;
    if (materialized.placed) {
      for (const p of materialized.placed) {
        if (p.foot === 'L' || p.foot === 'split-left') l++;
        else if (p.foot === 'R' || p.foot === 'split-right') r++;
        else dc++;
      }
    }

    const leftoverMetrics = computeLeftoverMetricsFromBounds(bounds, workWidth, workHeight, usedAreaMm2);

    return {
      ...candidate,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      usedAreaMm2,
      envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - usedAreaMm2)),
      maxPairsPlaced: Math.floor(pairs),
      ...leftoverMetrics,
      ...materialized,
      placedCount: totalPieces,
      pairs: pairs,
      actualPairs: pairs,
      dcCount: dc,
      splitPairCount: Math.min(l, r),
      splitUnpairedCount: Math.max(l, r) - Math.min(l, r),
      bounds
    };
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const materialized = this._materializePlacedItems(sizeName, candidate.placements, config);
    const totalPieces = materialized.placed.reduce((sum, item) => sum + (item.pieceCount || 0), 0);
    const efficiency = totalArea > 0
      ? roundMetric((candidate.usedAreaMm2 / totalArea) * 100, 1)
      : 0;

    return {
      sheetIndex: 0,
      placed: materialized.placed,
      renderTemplates: materialized.renderTemplates,
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placedCount: totalPieces,
      actualPairs: candidate.actualPairs,
      maxPairsPlaced: candidate.maxPairsPlaced ?? Math.floor(totalPieces / 2),
      leftoverAreaMm2: candidate.leftoverAreaMm2 ?? 0,
      openSheetAreaMm2: candidate.openSheetAreaMm2 ?? 0,
      remainingSheetAreaMm2: candidate.remainingSheetAreaMm2 ?? 0,
      efficiency,
      patternInfo: {
        algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
        maxPairsPlaced: candidate.maxPairsPlaced ?? getWholePairsPlaced(candidate),
        leftoverAreaMm2: candidate.leftoverAreaMm2 ?? 0,
        openSheetAreaMm2: candidate.openSheetAreaMm2 ?? 0,
        rowMode: candidate.rowMode ?? null,
        bodyCount: candidate.bodyCount ?? 0,
        bodyCols: candidate.bodyCols ?? 0,
        bodyRows: candidate.bodyRows ?? 0,
        bodyDxMm: candidate.bodyDxMm ?? null,
        bodyDyMm: candidate.bodyDyMm ?? null,
        bodyStartY: candidate.bodyStartY ?? 0,
        bodyPrimaryAngle: candidate.bodyPrimaryAngle ?? null,
        bodyAlternateAngle: candidate.bodyAlternateAngle ?? null,
        bodyPatternMode: candidate.bodyPatternMode ?? null,
        rowShiftXmm: candidate.rowShiftXmm ?? 0,
        rowShiftYmm: candidate.rowShiftYmm ?? 0,
        filler90Used: candidate.filler90Used ?? false,
        filler90Count: candidate.filler90Count ?? 0,
        filler90Cols: candidate.filler90Cols ?? 0,
        filler90Rows: candidate.filler90Rows ?? 0,
        filler90TopRows: candidate.filler90TopRows ?? candidate.filler90Rows ?? 0,
        filler90BottomRows: candidate.filler90BottomRows ?? 0,
        filler90DxMm: candidate.filler90DxMm ?? null,
        filler90DyMm: candidate.filler90DyMm ?? null,
        filler90Angle: candidate.filler90Angle ?? null,
        fillerPatternKey: candidate.fillerPatternKey ?? 'none',
        scanOrder: candidate.scanOrder ?? null,
        splitFillUsed: candidate.splitFillUsed ?? false,
        splitFillCount: candidate.splitFillCount ?? 0,
        splitPairCount: candidate.splitPairCount ?? 0,
        splitUnpairedCount: candidate.splitUnpairedCount ?? 0
      }
    };
  }

  async _testCapacityParallel(sizeList, config, onProgress) {
    const startTime = Date.now();
    const cachedResults = new Array(sizeList.length).fill(null);
    const uncachedTasks = [];

    for (let index = 0; index < sizeList.length; index++) {
      const size = sizeList[index];
      const cacheKey = buildCapacityResultCacheKey('same-side-double-contour', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        if (onProgress) onProgress(size.sizeName, 'done');
        cachedResults[index] = cachedResult;
        continue;
      }

      uncachedTasks.push({
        index,
        cacheKey,
        size,
        config: {
          ...config,
          sameSidePreparedVariant: 'double-contour',
          capacityLayoutMode: 'same-side-double-contour',
          parallelSizes: false
        }
      });
    }

    const workerCount = resolveAdaptiveParallelWorkerCount(uncachedTasks, config);
    const orderedTasks = orderTasksByEstimatedWeight(
      uncachedTasks,
      (task) => {
        const pieceArea = Math.max(1, polygonArea(task.size.polygon) || 1000);
        const pointFactor = 1 + Math.max(0, ((task.size.polygon?.length || 0) - 12) / 48);
        const sheetArea = (config.sheetWidth || 1000) * (config.sheetHeight || 2000);
        // Larger ratio (more pieces) and complex shapes get higher weight to run first
        return (sheetArea / pieceArea) * pointFactor;
      }
    );
    const sheetsBySize = {};
    const summary = [];

    console.log(`[DoubleContour] Starting parallel processing of ${orderedTasks.length} tasks with ${workerCount} workers...`);

    const workerResults = orderedTasks.length
      ? await executeDoubleContourTasksInParallel(orderedTasks, workerCount, (taskIndex, status) => {
          const task = orderedTasks.find(t => t.index === taskIndex);
          if (status === 'started') {
            console.log(`  - Size ${task.size.sizeName}: Started`);
          } else if (status === 'done') {
            console.log(`  - Size ${task.size.sizeName}: Completed`);
          }
          if (onProgress) onProgress(task.size.sizeName, status);
        })
      : [];

    for (const task of uncachedTasks) {
      const workerResult = workerResults[task.index];
      if (!workerResult?.payload) {
        throw new Error(`Missing double-contour worker payload for size index ${task.index}`);
      }
      setCachedCapacityResult(task.cacheKey, workerResult.payload);
      cachedResults[task.index] = workerResult.payload;
    }

    for (let index = 0; index < cachedResults.length; index++) {
      const cachedResult = cachedResults[index];
      if (!cachedResult) {
        throw new Error(`Missing double-contour capacity payload for size index ${index}`);
      }
      const { summaryItem, sheet } = cachedResult;
      // Ensure summary item uses correct pieces/pairs from sheet
      const correctedSummaryItem = {
        ...summaryItem,
        totalPieces: sheet?.placedCount || 0,
        pairs: sheet?.actualPairs || 0,
        placedCount: sheet?.placedCount || 0
      };
      summary.push(correctedSummaryItem);
      sheetsBySize[correctedSummaryItem.sizeName] = sheet;
    }

    // enforceMonotonicity(summary, sheetsBySize);
    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-double-contour',
      algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
      summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName,
      sheet: defaultSheet,
      sheetsBySize,
      timeMs: Date.now() - startTime
    };
  }

  async testCapacity(sizeList, overrideConfig = {}, onProgress) {
    const explicitDeepSplitFill = overrideConfig.preparedSplitFillDeep ?? this.config.preparedSplitFillDeep;
    const deepSplitFillEnabled = explicitDeepSplitFill == null
      ? sizeList.length === 1
      : explicitDeepSplitFill === true;
    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    const config = {
      ...this.config,
      ...overrideConfig,
      sameSidePreparedVariant: 'double-contour',
      capacityLayoutMode: 'same-side-double-contour',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate90: overrideConfig.allowRotate90 ?? this.config.allowRotate90 ?? true,
      allowRotate180: overrideConfig.allowRotate180 ?? this.config.allowRotate180 ?? false,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true,
      preparedSplitFillEnabled: overrideConfig.preparedSplitFillEnabled
        ?? this.config.preparedSplitFillEnabled
        ?? true,
      preparedSplitFillMaxPieces: overrideConfig.preparedSplitFillMaxPieces
        ?? this.config.preparedSplitFillMaxPieces
        ?? 8,
      preparedSplitFillTimeLimitMs: overrideConfig.preparedSplitFillTimeLimitMs
        ?? this.config.preparedSplitFillTimeLimitMs
        ?? 2500,
      preparedSplitFillCandidateLimit: overrideConfig.preparedSplitFillCandidateLimit
        ?? this.config.preparedSplitFillCandidateLimit
        ?? (deepSplitFillEnabled ? 24 : (sizeList.length > 1 ? 16 : 24))
    };

    this._doubleContourSourceBySize = new Map(
      normalizedSizeList.map((size) => [
        size.sizeName,
        {
          polygon: size.polygon,
          internals: Array.isArray(size.internals) ? size.internals : []
        }
      ])
    );

    if (shouldUseParallelDoubleContourCapacity(normalizedSizeList, config)) {
      return this._testCapacityParallel(normalizedSizeList, config, onProgress);
    }

    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const sheetsBySize = {};
    const summary = [];

    for (const size of normalizedSizeList) {
      const cacheKey = buildCapacityResultCacheKey('same-side-double-contour', size, config);
      const cachedResult = getCachedCapacityResult(cacheKey);
      if (cachedResult) {
        if (onProgress) onProgress(size.sizeName, 'done');
        summary.push(cachedResult.summaryItem);
        sheetsBySize[size.sizeName] = cachedResult.sheet;
        continue;
      }

      if (onProgress) onProgress(size.sizeName, 'started');

      const foot = size.foot || 'L';
      const candidate = this._evaluateFootCandidate(
        size.sizeName,
        foot,
        size.polygon,
        config,
        workWidth,
        workHeight
      );

      if (!candidate) {
        const summaryItem = {
          sizeName: size.sizeName,
          totalPieces: 0,
          pairs: 0,
          placedCount: 0,
          efficiency: 0
        };
        summary.push(summaryItem);
        sheetsBySize[size.sizeName] = null;
        continue;
      }

      const sheet = this._buildSheetFromCandidate(size.sizeName, candidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;
      
      const summaryItem = {
        sizeName: size.sizeName,
        totalPieces: sheet.placedCount,
        pairs: sheet.actualPairs,
        placedCount: sheet.placedCount,
        efficiency: sheet.efficiency
      };
      summary.push(summaryItem);
      
      setCachedCapacityResult(cacheKey, {
        summaryItem,
        sheet
      });
    }
    const defaultSizeName = normalizedSizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-double-contour',
      algorithmVersion: DOUBLE_CONTOUR_ALGORITHM_VERSION,
      summary,
      totalPlaced: defaultSheet?.placedCount || 0,
      efficiency: defaultSheet?.efficiency || 0,
      defaultSizeName,
      sheet: defaultSheet,
      sheetsBySize,
      timeMs: Date.now() - startTime
    };
  }

}
