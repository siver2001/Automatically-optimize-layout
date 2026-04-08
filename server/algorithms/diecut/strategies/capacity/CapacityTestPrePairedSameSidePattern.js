import { normalizeToOrigin, area as polygonArea } from '../../core/polygonUtils.js';
import { CapacityTestSameSidePattern } from './CapacityTestSameSidePattern.js';

function compareTightCandidates(nextCandidate, bestCandidate) {
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
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

export class CapacityTestPrePairedSameSidePattern extends CapacityTestSameSidePattern {
  _getPreferredAngles() {
    return [0, 90];
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    let bestCandidate = null;

    for (const angle of this._getPreferredAngles()) {
      const orient = this._decorateOrient(sizeName, foot, polygon, angle, config, step);
      const dxMm = this._findUniformDx(orient, config, step);
      if (dxMm == null) continue;

      const dyMm = this._findUniformDy(orient, dxMm, config, step);
      if (dyMm == null) continue;

      const bodyCols = this._countCols(orient.width, dxMm, workWidth);
      const bodyRows = this._countRows(orient.height, dyMm, workHeight);
      if (!bodyCols || !bodyRows) continue;

      const placements = this._buildUniformPlacements(
        orient,
        bodyCols,
        bodyRows,
        dxMm,
        dyMm,
        0
      );

      const candidate = this._buildCandidate(
        sizeName,
        foot,
        pieceArea,
        placements,
        {
          rowMode: 'uniform',
          bodyCount: placements.length,
          bodyCols,
          bodyRows,
          bodyDxMm: dxMm,
          bodyDyMm: dyMm,
          bodyStartY: 0,
          bodyPrimaryAngle: orient.angle,
          bodyAlternateAngle: orient.angle,
          bodyPatternMode: 'prepaired-uniform-pitch',
          bodyRotationOffset: 0,
          bodyStartPattern: 'uniform',
          rowShiftXmm: 0,
          rowShiftYmm: 0,
          filler90Used: false,
          filler90Count: 0,
          filler90Cols: 0,
          filler90Rows: 0,
          filler90DxMm: null,
          filler90DyMm: null,
          filler270DyMm: null,
          filler90Angle: null,
          filler270Angle: null,
          fillerPatternKey: 'none',
          fillerPatternPriority: 99,
          fillerRotationOffset: 0,
          fillerStartPattern: 'none',
          scanOrder: 'uniform-pitch-grid'
        },
        workWidth,
        workHeight,
        config
      );

      const finalizedCandidate = candidate ? this._finalizeCandidate(candidate, config) : null;
      if (finalizedCandidate && compareTightCandidates(finalizedCandidate, bestCandidate) < 0) {
        bestCandidate = finalizedCandidate;
      }
    }

    return bestCandidate;
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = {
      ...this.config,
      ...overrideConfig,
      capacityLayoutMode: 'same-side-prepaired-tight',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate180: true,
      parallelSizes: false,
      sameSideFineRotateOffsets: [0],
      sameSideAlignedRowShiftRatios: [0]
    };

    const normalizedSizeList = sizeList.map((size) => ({
      ...size,
      polygon: normalizeToOrigin(size.polygon)
    }));

    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const sheetsBySize = {};
    const summary = [];

    for (const size of normalizedSizeList) {
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
        summary.push({
          sizeName: size.sizeName,
          sizeValue: size.sizeValue,
          totalPieces: 0,
          pairs: 0,
          placedCount: 0,
          efficiency: 0
        });
        sheetsBySize[size.sizeName] = null;
        continue;
      }

      const sheet = this._buildSheetFromCandidate(size.sizeName, candidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;
      summary.push({
        sizeName: size.sizeName,
        sizeValue: size.sizeValue,
        totalPieces: sheet?.placedCount || 0,
        pairs: 0,
        placedCount: sheet?.placedCount || 0,
        efficiency: sheet?.efficiency || 0
      });
    }

    const defaultSizeName = normalizedSizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-prepaired-tight',
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
