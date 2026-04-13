import { normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestPrePairedSameSidePattern } from './CapacityTestPrePairedSameSidePattern.js';
import { roundMetric, validateLocalPlacements } from './patternCapacityUtils.js';
import { CapacityTestSameSidePattern } from './CapacityTestSameSidePattern.js';

function compareDoubleInsoleCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.usedWidthMm !== bestCandidate.usedWidthMm) {
    return nextCandidate.usedWidthMm - bestCandidate.usedWidthMm;
  }
  const nextShift = Math.abs(nextCandidate.rowShiftXmm || 0) + Math.abs(nextCandidate.rowShiftYmm || 0);
  const bestShift = Math.abs(bestCandidate.rowShiftXmm || 0) + Math.abs(bestCandidate.rowShiftYmm || 0);
  if (nextShift !== bestShift) {
    return bestShift - nextShift;
  }
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

function buildShiftCandidates(range, step, limit = 9) {
  if (!Number.isFinite(range) || range <= 0) return [0];
  const safeStep = Math.max(step, 0.25);
  const candidates = new Set([0]);
  const steps = Math.max(1, limit - 1);
  const increment = Math.max(safeStep, range / steps);

  for (let value = increment; value <= range + 1e-6; value += increment) {
    const rounded = roundMetric(value, 3);
    if (Math.abs(rounded) < safeStep * 0.5) continue;
    candidates.add(rounded);
    candidates.add(-rounded);
  }

  return [...candidates].sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

export class CapacityTestDoubleInsoleDoubleContourPattern extends CapacityTestPrePairedSameSidePattern {
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
    const precision = Math.min(step, 0.05);
    const upper = Math.max(
      step,
      orient.height * 2 + Math.abs(rowShiftYmm) + config.spacing + step * 10
    );

    let low = 0;
    let high = upper;
    if (!validateLocalPlacements(
      this._buildShiftedUniformNeighborhood(orient, dxMm, high, rowShiftXmm, rowShiftYmm),
      config.spacing
    ).valid) {
      return null;
    }

    while (high - low > precision) {
      const mid = (low + high) / 2;
      const valid = validateLocalPlacements(
        this._buildShiftedUniformNeighborhood(orient, dxMm, mid, rowShiftXmm, rowShiftYmm),
        config.spacing
      ).valid;
      if (valid) high = mid;
      else low = mid;
    }

    return roundMetric(high, 3);
  }

  _buildShiftedUniformPlacements(orient, cols, rows, dxMm, dyMm, rowShiftXmm = 0, rowShiftYmm = 0, startY = 0) {
    const placements = [];
    const baseX = rowShiftXmm < 0 ? -rowShiftXmm : 0;
    const baseY = startY - Math.min(0, rowShiftYmm);

    for (let row = 0; row < rows; row++) {
      const isOddRow = row % 2 === 1;
      const shiftX = isOddRow ? rowShiftXmm : 0;
      const shiftY = isOddRow ? rowShiftYmm : 0;

      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `double_insole_${row}_${col}`,
          orient,
          x: roundMetric(baseX + col * dxMm + shiftX, 3),
          y: roundMetric(baseY + startY + row * dyMm + shiftY, 3)
        });
      }
    }

    return placements;
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    let bestCandidate = null;

    for (const angle of this._getPreferredAngles()) {
      const orient = this._decorateOrient(sizeName, foot, polygon, angle, config, step);
      const dxMm = this._findUniformDx(orient, config, step);
      if (dxMm == null) continue;

      const variants = [];
      const alignedDyMm = this._findUniformDy(orient, dxMm, config, step);
      if (alignedDyMm != null) {
        variants.push({
          dyMm: alignedDyMm,
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          scanOrder: 'uniform-pitch-grid',
          bodyPatternMode: 'double-insole-uniform-pitch'
        });
      }

      const rowShiftRange = orient.width * 0.45;
      const rowShiftCandidates = buildShiftCandidates(rowShiftRange, step, 9);
      for (const rowShiftXmm of rowShiftCandidates) {
        if (Math.abs(rowShiftXmm) < Math.max(step, 0.25) * 0.5) continue;
        const shiftedDyMm = this._findShiftedUniformDy(orient, dxMm, rowShiftXmm, 0, config, step);
        if (shiftedDyMm == null) continue;
        variants.push({
          dyMm: shiftedDyMm,
          rowShiftXmm: roundMetric(rowShiftXmm),
          rowShiftYmm: 0,
          scanOrder: 'staggered-double-contour',
          bodyPatternMode: 'double-insole-staggered-row-shift'
        });
      }

      let filler90Orient = null;
      let filler90DxMm = null;
      let filler90DyMm = null;
      let filler90Cols = 0;
      let maxFiller90Rows = 0;

      if (config.allowRotate90 !== false) {
        const filler90Angle = (angle + 90) % 360;
        filler90Orient = this._decorateOrient(sizeName, foot, polygon, filler90Angle, config, step);
        filler90DxMm = this._findUniformDx(filler90Orient, config, step);
        if (filler90DxMm != null) {
          filler90DyMm = this._findUniformDy(filler90Orient, filler90DxMm, config, step);
          if (filler90DyMm != null) {
            filler90Cols = this._countCols(filler90Orient.width, filler90DxMm, workWidth);
            maxFiller90Rows = this._countRows(filler90Orient.height, filler90DyMm, workHeight);
          }
        }
      }

      for (const variant of variants) {
        const fillerLastRowPlacements = filler90Cols > 0
          ? this._buildUniformPlacements(filler90Orient, filler90Cols, 1, filler90DxMm, filler90DyMm, 0)
          : [];
        const bodyRowPlacements = this._buildShiftedUniformPlacements(
          orient,
          this._countCols(orient.width, dxMm, workWidth),
          1,
          dxMm,
          variant.dyMm,
          variant.rowShiftXmm,
          variant.rowShiftYmm,
          0
        );

        const bodyStartOffsetAfterFillerRow = fillerLastRowPlacements.length
          ? this._findBodyStartOffsetAfterFillerRow(
            fillerLastRowPlacements,
            bodyRowPlacements,
            config,
            step
          )
          : 0;

        const fillerRowOptions = filler90Cols > 0 ? maxFiller90Rows : 0;
        for (let filler90Rows = 0; filler90Rows <= fillerRowOptions; filler90Rows++) {
          if (filler90Rows > 0 && bodyStartOffsetAfterFillerRow == null) continue;

          const lastFillerRowY = filler90Rows > 0
            ? roundMetric((filler90Rows - 1) * filler90DyMm)
            : 0;
          const bodyStartY = filler90Rows > 0
            ? roundMetric(lastFillerRowY + bodyStartOffsetAfterFillerRow)
            : 0;

          const bodyCols = this._countCols(orient.width, dxMm, workWidth);
          const bodyRows = this._countRows(
            orient.height,
            variant.dyMm,
            Math.max(0, workHeight - bodyStartY)
          );
          if (!bodyCols || !bodyRows) continue;

          const fillerPlacements = filler90Rows > 0
            ? this._buildUniformPlacements(filler90Orient, filler90Cols, filler90Rows, filler90DxMm, filler90DyMm, 0)
            : [];
          const bodyPlacements = this._buildShiftedUniformPlacements(
            orient,
            bodyCols,
            bodyRows,
            dxMm,
            variant.dyMm,
            variant.rowShiftXmm,
            variant.rowShiftYmm,
            bodyStartY
          );
          const placements = [...fillerPlacements, ...bodyPlacements];

          const candidate = this._buildCandidate(
            sizeName,
            foot,
            pieceArea,
            placements,
            {
              rowMode: 'uniform',
              bodyCount: bodyPlacements.length,
              bodyCols,
              bodyRows,
              bodyDxMm: dxMm,
              bodyDyMm: variant.dyMm,
              bodyStartY,
              bodyPrimaryAngle: orient.angle,
              bodyAlternateAngle: orient.angle,
              bodyPatternMode: variant.bodyPatternMode,
              bodyRotationOffset: 0,
              bodyStartPattern: filler90Rows > 0 ? 'after-rotated-filler' : 'uniform',
              rowShiftXmm: variant.rowShiftXmm,
              rowShiftYmm: variant.rowShiftYmm,
              filler90Used: filler90Rows > 0,
              filler90Count: fillerPlacements.length,
              filler90Cols: filler90Rows > 0 ? filler90Cols : 0,
              filler90Rows,
              filler90DxMm: filler90Rows > 0 ? filler90DxMm : null,
              filler90DyMm: filler90Rows > 0 ? filler90DyMm : null,
              filler270DyMm: null,
              filler90Angle: filler90Rows > 0 ? filler90Orient?.angle ?? null : null,
              filler270Angle: null,
              fillerPatternKey: filler90Rows > 0 ? 'top-rotated-rows' : 'none',
              fillerPatternPriority: filler90Rows > 0 ? 1 : 99,
              fillerRotationOffset: 0,
              fillerStartPattern: filler90Rows > 0 ? 'uniform-90' : 'none',
              scanOrder: filler90Rows > 0 ? `${variant.scanOrder}-with-rotated-filler` : variant.scanOrder
            },
            workWidth,
            workHeight,
            config
          );

          const finalizedCandidate = candidate ? this._finalizeCandidate(candidate, config) : null;
          if (finalizedCandidate && compareDoubleInsoleCandidates(finalizedCandidate, bestCandidate) < 0) {
            bestCandidate = finalizedCandidate;
          }
        }
      }
    }

    const fallbackSameSideCandidate = CapacityTestSameSidePattern.prototype._evaluateFootCandidate.call(
      this,
      sizeName,
      foot,
      polygon,
      config,
      workWidth,
      workHeight
    );
    if (fallbackSameSideCandidate && compareDoubleInsoleCandidates(fallbackSameSideCandidate, bestCandidate) < 0) {
      bestCandidate = fallbackSameSideCandidate;
    }

    return bestCandidate;
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = {
      ...this.config,
      ...overrideConfig,
      capacityLayoutMode: 'same-side-double-contour',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate180: true,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true,
      sameSideFineRotateOffsets: [0],
      sameSideAlignedRowShiftRatios: [0]
    };

    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    return super.testCapacity(normalizedSizeList, config);
  }
}
