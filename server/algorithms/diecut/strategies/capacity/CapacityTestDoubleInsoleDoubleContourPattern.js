import { normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestPrePairedSameSidePattern } from './CapacityTestPrePairedSameSidePattern.js';
import { roundMetric, validateLocalPlacements } from './patternCapacityUtils.js';
import { CapacityTestSameSidePattern } from './CapacityTestSameSidePattern.js';

const DEFAULT_PER_SIZE_TIME_MS = 2500;
const MIN_PER_SIZE_TIME_MS = 750;
const MAX_SHIFT_CANDIDATES = 7;
const SHIFT_SCAN_LIMIT = 9;
const INTERNAL_GAP_SAMPLE_RATIOS = [0.08, 0.12, 0.16, 0.22, 0.28, 0.34, 0.66, 0.72, 0.78, 0.84, 0.9];
const FILLER_PHASE_MIN_MS = 300;
const FILLER_PHASE_MAX_MS = 900;
const FILLER_PHASE_RATIO = 0.35;

function compareDoubleInsoleCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.bodyCount !== bestCandidate.bodyCount) {
    return bestCandidate.bodyCount - nextCandidate.bodyCount;
  }
  if (nextCandidate.filler90Count !== bestCandidate.filler90Count) {
    return nextCandidate.filler90Count - bestCandidate.filler90Count;
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

function buildHorizontalIntervalsAtY(polygon, y) {
  const intersections = [];
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const crosses = (current.y <= y && next.y > y) || (next.y <= y && current.y > y);
    if (!crosses) continue;
    const ratio = (y - current.y) / (next.y - current.y);
    intersections.push(current.x + ratio * (next.x - current.x));
  }

  intersections.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]]);
  }
  return intervals;
}

function extractInternalGapShiftCandidates(orient, step) {
  if (!orient?.polygon?.length || !Number.isFinite(orient.height)) return [];

  const candidateMagnitudes = new Set();

  for (const ratio of INTERNAL_GAP_SAMPLE_RATIOS) {
    const y = orient.height * ratio;
    const intervals = buildHorizontalIntervalsAtY(orient.polygon, y);
    if (intervals.length < 2) continue;

    let widestGap = null;
    for (let index = 0; index + 1 < intervals.length; index++) {
      const leftInterval = intervals[index];
      const rightInterval = intervals[index + 1];
      const gapStart = leftInterval[1];
      const gapEnd = rightInterval[0];
      const gapWidth = gapEnd - gapStart;
      if (gapWidth <= Math.max(step, 0.25)) continue;
      if (!widestGap || gapWidth > widestGap.gapWidth) {
        widestGap = { leftInterval, rightInterval, gapStart, gapEnd, gapWidth };
      }
    }

    if (!widestGap) continue;

    const gapCenter = (widestGap.gapStart + widestGap.gapEnd) / 2;
    const leftLobeCenter = (widestGap.leftInterval[0] + widestGap.leftInterval[1]) / 2;
    const rightLobeCenter = (widestGap.rightInterval[0] + widestGap.rightInterval[1]) / 2;

    const shifts = [
      Math.abs(gapCenter - leftLobeCenter),
      Math.abs(rightLobeCenter - gapCenter),
      Math.abs(widestGap.gapStart - leftLobeCenter),
      Math.abs(rightLobeCenter - widestGap.gapEnd)
    ];

    for (const shift of shifts) {
      const rounded = roundMetric(shift, 3);
      if (rounded >= Math.max(step, 0.25) * 0.5) {
        candidateMagnitudes.add(rounded);
      }
    }
  }

  return [...candidateMagnitudes]
    .flatMap((value) => [-value, value])
    .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

function mergeShiftCandidateLists(primaryCandidates, secondaryCandidates) {
  const merged = new Set();
  for (const value of [...primaryCandidates, ...secondaryCandidates]) {
    if (Number.isFinite(value)) {
      merged.add(roundMetric(value, 3));
    }
  }
  return [...merged].sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

function limitShiftCandidates(candidates, limit = 7) {
  return [...candidates]
    .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
    .slice(0, Math.max(1, limit));
}

function buildFillerColumnChoices(maxCols) {
  if (!Number.isFinite(maxCols) || maxCols <= 0) return [0];
  if (maxCols <= 3) {
    return Array.from({ length: maxCols }, (_, index) => maxCols - index);
  }

  return [...new Set([
    maxCols,
    Math.max(1, maxCols - 1),
    Math.max(1, Math.ceil(maxCols * 0.75)),
    Math.max(1, Math.ceil(maxCols / 2))
  ])].sort((left, right) => right - left);
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

  _countRowsWithTrailingBlock(maxHeight, dyMm, workHeight, trailingOffsetMm = 0, trailingBlockHeightMm = 0) {
    let rows = 0;
    while (true) {
      const y = rows * dyMm;
      if (y + maxHeight + trailingOffsetMm + trailingBlockHeightMm > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    const perSizeTimeMs = config.perSizeTimeMs || DEFAULT_PER_SIZE_TIME_MS;
    const deadlineTs = Date.now() + Math.max(MIN_PER_SIZE_TIME_MS, perSizeTimeMs);
    let bestCandidate = null;
    const angleStates = [];

    for (const angle of this._getPreferredAngles()) {
      if (Date.now() > deadlineTs) break;
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
      const geometricShiftCandidates = extractInternalGapShiftCandidates(orient, step);
      const rowShiftCandidates = limitShiftCandidates(
        mergeShiftCandidateLists(
          geometricShiftCandidates,
          buildShiftCandidates(rowShiftRange, step, SHIFT_SCAN_LIMIT)
        ),
        MAX_SHIFT_CANDIDATES
      );
      for (const rowShiftXmm of rowShiftCandidates) {
        if (Date.now() > deadlineTs) break;
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

      angleStates.push({
        orient,
        dxMm,
        variants,
        filler90Orient,
        filler90DxMm,
        filler90DyMm,
        filler90Cols,
        maxFiller90Rows
      });
    }

    for (const state of angleStates) {
      if (Date.now() > deadlineTs) break;
      const { orient, dxMm, variants } = state;

      for (const variant of variants) {
        if (Date.now() > deadlineTs) break;
        const bodyCols = this._countCols(orient.width, dxMm, workWidth);
        const bodyRows = this._countRows(orient.height, variant.dyMm, workHeight);
        if (!bodyCols || !bodyRows) continue;

        const bodyPlacements = this._buildShiftedUniformPlacements(
          orient,
          bodyCols,
          bodyRows,
          dxMm,
          variant.dyMm,
          variant.rowShiftXmm,
          variant.rowShiftYmm,
          0
        );
        const bodyOnlyCandidate = this._buildCandidate(
          sizeName,
          foot,
          pieceArea,
          bodyPlacements,
          {
            rowMode: 'uniform',
            bodyCount: bodyPlacements.length,
            bodyCols,
            bodyRows,
            bodyDxMm: dxMm,
            bodyDyMm: variant.dyMm,
            bodyStartY: 0,
            bodyPrimaryAngle: orient.angle,
            bodyAlternateAngle: orient.angle,
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
        const finalizedBodyOnlyCandidate = bodyOnlyCandidate ? this._finalizeCandidate(bodyOnlyCandidate, config) : null;
        if (finalizedBodyOnlyCandidate && compareDoubleInsoleCandidates(finalizedBodyOnlyCandidate, bestCandidate) < 0) {
          bestCandidate = finalizedBodyOnlyCandidate;
        }
      }
    }

    const fillerDeadlineTs = Math.min(
      deadlineTs,
      Date.now() + Math.max(FILLER_PHASE_MIN_MS, Math.min(FILLER_PHASE_MAX_MS, Math.floor(perSizeTimeMs * FILLER_PHASE_RATIO)))
    );

    for (const state of angleStates) {
      if (Date.now() > fillerDeadlineTs) break;
      const {
        orient,
        dxMm,
        variants,
        filler90Orient,
        filler90DxMm,
        filler90DyMm,
        filler90Cols,
        maxFiller90Rows
      } = state;
      if (!filler90Cols) continue;

      for (const variant of variants) {
        if (Date.now() > fillerDeadlineTs) break;
        const bodyCols = this._countCols(orient.width, dxMm, workWidth);
        if (!bodyCols) continue;
        const bodyRowsNoFiller = this._countRows(orient.height, variant.dyMm, workHeight);
        if (!bodyRowsNoFiller) continue;

        const bodyOnlyCount = bodyCols * bodyRowsNoFiller;
        const optimisticCount = bodyOnlyCount + filler90Cols * 2;
        if (bestCandidate && optimisticCount <= bestCandidate.placedCount) {
          continue;
        }

        const bodyRowPlacements = this._buildShiftedUniformPlacements(
          orient,
          bodyCols,
          1,
          dxMm,
          variant.dyMm,
          variant.rowShiftXmm,
          variant.rowShiftYmm,
          0
        );
        const fillerColOptions = buildFillerColumnChoices(filler90Cols);
        const fillerRowOptions = filler90Cols > 0 ? maxFiller90Rows : 0;

        for (const filler90ColsChoice of fillerColOptions) {
          if (Date.now() > fillerDeadlineTs) break;
          const fillerRowWidth = filler90ColsChoice > 0
            ? roundMetric(filler90Orient.width + (filler90ColsChoice - 1) * filler90DxMm)
            : 0;
          const fillerStartXCandidates = filler90ColsChoice > 0
            ? [...new Set([
              0,
              roundMetric(Math.max(0, (workWidth - fillerRowWidth) / 2)),
              roundMetric(Math.max(0, workWidth - fillerRowWidth))
            ])]
            : [0];

          for (let filler90TopRows = 0; filler90TopRows <= fillerRowOptions; filler90TopRows++) {
            if (Date.now() > fillerDeadlineTs) break;
            const topStartOptions = filler90TopRows > 0 ? fillerStartXCandidates : [0];

            for (const topFillerStartX of topStartOptions) {
              if (Date.now() > fillerDeadlineTs) break;
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

              for (let filler90BottomRows = 0; filler90BottomRows <= fillerRowOptions; filler90BottomRows++) {
                if (Date.now() > fillerDeadlineTs) break;
                const bottomStartOptions = filler90BottomRows > 0 ? fillerStartXCandidates : [0];

                for (const bottomFillerStartX of bottomStartOptions) {
                  if (Date.now() > fillerDeadlineTs) break;
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
                    orient.height,
                    variant.dyMm,
                    Math.max(0, workHeight - bodyStartY),
                    filler90BottomRows > 0 ? fillerStartOffsetAfterBodyRow : 0,
                    bottomFillerBlockHeight
                  );
                  if (!bodyCols || !bodyRows) continue;

                  const topFillerPlacements = filler90TopRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90TopRows,
                      filler90DxMm,
                      filler90DyMm,
                      topFillerStartX,
                      0
                    )
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
                  const bottomFillerStartY = filler90BottomRows > 0
                    ? roundMetric(bodyStartY + (bodyRows - 1) * variant.dyMm + fillerStartOffsetAfterBodyRow)
                    : null;
                  const bottomFillerPlacements = filler90BottomRows > 0
                    ? this._buildUniformPlacementsAtX(
                      filler90Orient,
                      filler90ColsChoice,
                      filler90BottomRows,
                      filler90DxMm,
                      filler90DyMm,
                      bottomFillerStartX,
                      bottomFillerStartY
                    )
                    : [];
                  const fillerPlacements = [...topFillerPlacements, ...bottomFillerPlacements];
                  const placements = [...topFillerPlacements, ...bodyPlacements, ...bottomFillerPlacements];

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
                      bodyStartPattern: filler90TopRows > 0 ? 'after-top-rotated-filler' : 'uniform',
                      rowShiftXmm: variant.rowShiftXmm,
                      rowShiftYmm: variant.rowShiftYmm,
                      filler90Used: fillerPlacements.length > 0,
                      filler90Count: fillerPlacements.length,
                      filler90Cols: fillerPlacements.length > 0 ? filler90ColsChoice : 0,
                      filler90Rows: filler90TopRows + filler90BottomRows,
                      filler90TopRows,
                      filler90BottomRows,
                      filler90DxMm: fillerPlacements.length > 0 ? filler90DxMm : null,
                      filler90DyMm: fillerPlacements.length > 0 ? filler90DyMm : null,
                      filler270DyMm: null,
                      filler90Angle: fillerPlacements.length > 0 ? filler90Orient?.angle ?? null : null,
                      filler270Angle: null,
                      fillerPatternKey: fillerPlacements.length > 0
                        ? (filler90TopRows > 0 && filler90BottomRows > 0
                          ? 'top-bottom-rotated-rows'
                          : filler90TopRows > 0
                            ? 'top-rotated-rows'
                            : 'bottom-rotated-rows')
                        : 'none',
                      fillerPatternPriority: fillerPlacements.length > 0 ? 1 : 99,
                      fillerRotationOffset: 0,
                      fillerStartPattern: fillerPlacements.length > 0 ? 'uniform-90' : 'none',
                      scanOrder: fillerPlacements.length > 0 ? `${variant.scanOrder}-with-rotated-filler` : variant.scanOrder
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
          }
        }
      }
    }

    if (!bestCandidate || Date.now() <= deadlineTs) {
      const fallbackSameSideCandidate = CapacityTestSameSidePattern.prototype._evaluateFootCandidate.call(
        this,
        sizeName,
        foot,
        polygon,
        config,
        workWidth,
        workHeight
      );
      if (
        fallbackSameSideCandidate &&
        (
          !bestCandidate ||
          fallbackSameSideCandidate.placedCount > bestCandidate.placedCount
        )
      ) {
        bestCandidate = fallbackSameSideCandidate;
      }
    }

    return bestCandidate;
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = {
      ...this.config,
      ...overrideConfig,
      sameSidePreparedVariant: 'double-contour',
      capacityLayoutMode: 'same-side-double-contour',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate90: overrideConfig.allowRotate90 ?? this.config.allowRotate90 ?? true,
      allowRotate180: overrideConfig.allowRotate180 ?? this.config.allowRotate180 ?? false,
      perSizeTimeMs: overrideConfig.perSizeTimeMs ?? this.config.perSizeTimeMs ?? DEFAULT_PER_SIZE_TIME_MS,
      parallelSizes: overrideConfig.parallelSizes ?? this.config.parallelSizes ?? true
    };

    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    return super.testCapacity(normalizedSizeList, config);
  }
}
