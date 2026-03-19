import { BaseNesting } from '../../core/BaseNesting.js';
import {
  flipX,
  normalizeToOrigin,
  area as polygonArea,
  polygonsOverlap
} from '../../core/polygonUtils.js';
import {
  getOrientBounds,
  roundMetric,
  validateLocalPlacements,
  computeEnvelope
} from './patternCapacityUtils.js';

function compareAlignedCandidates(nextCandidate, bestCandidate) {
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
  return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
}

function buildUpperBound(step, ...values) {
  return Math.max(step, ...values);
}

function findMinimalContinuousValue(minValue, maxValue, precision, isSafe) {
  if (minValue > maxValue) return null;
  if (!isSafe(maxValue)) return null;

  let low = minValue;
  let high = maxValue;
  while (high - low > precision) {
    const mid = (low + high) / 2;
    if (isSafe(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return roundMetric(high, 3);
}

function getPlacementsBottom(placements) {
  let maxY = 0;
  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    maxY = Math.max(maxY, placement.y + bb.maxY);
  }
  return maxY;
}

function getPlacementsTop(placements) {
  if (!placements.length) return 0;
  let minY = Infinity;
  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    minY = Math.min(minY, placement.y + bb.minY);
  }
  return minY;
}

function getAveragePitchX(placements) {
  if (placements.length < 2) return null;
  let total = 0;
  for (let index = 1; index < placements.length; index++) {
    total += placements[index].x - placements[index - 1].x;
  }
  return roundMetric(total / (placements.length - 1));
}

function buildRelativeSvgPath(polygon) {
  if (!polygon || polygon.length < 2) return '';
  return polygon.map((point, index) => {
    const x = point.x.toFixed(2);
    const y = point.y.toFixed(2);
    return `${index === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ') + ' Z';
}

function getRelativeCentroid(polygon) {
  if (!polygon || polygon.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const point of polygon) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: roundMetric(sumX / polygon.length),
    y: roundMetric(sumY / polygon.length)
  };
}

function getRenderKey(orient) {
  return `${orient.foot}_${orient.angle}`;
}

function getPlacementWorldBounds(placement) {
  const bb = getOrientBounds(placement.orient);
  return {
    bb,
    minX: placement.x + bb.minX,
    minY: placement.y + bb.minY,
    maxX: placement.x + bb.maxX,
    maxY: placement.y + bb.maxY
  };
}

function hasCrossPlacementOverlap(firstPlacements, secondPlacements, spacing) {
  if (!firstPlacements.length || !secondPlacements.length) return false;

  const firstIndexed = firstPlacements.map((placement) => ({
    placement,
    bounds: getPlacementWorldBounds(placement)
  }));
  const secondIndexed = secondPlacements.map((placement) => ({
    placement,
    bounds: getPlacementWorldBounds(placement)
  }));

  for (const first of firstIndexed) {
    for (const second of secondIndexed) {
      if (
        first.bounds.maxX + spacing < second.bounds.minX ||
        first.bounds.minX - spacing > second.bounds.maxX ||
        first.bounds.maxY + spacing < second.bounds.minY ||
        first.bounds.minY - spacing > second.bounds.maxY
      ) {
        continue;
      }

      if (
        polygonsOverlap(
          first.placement.orient.polygon,
          second.placement.orient.polygon,
          { x: first.placement.x, y: first.placement.y },
          { x: second.placement.x, y: second.placement.y },
          spacing,
          first.bounds.bb,
          second.bounds.bb
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export class CapacityTestSameSidePattern extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _decorateOrient(sizeName, foot, polygon, angle, config, step) {
    const item = { sizeName, foot, polygon };
    const orient = this._getOrient(item, angle, step, config.spacing);
    const bb = getOrientBounds(orient);
    return {
      ...orient,
      foot,
      bb,
      width: bb.width,
      height: bb.height
    };
  }

  _resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col) {
    const parity = (row + col) % 2;
    if (rowMode === 'checkerboard') {
      return parity === 0 ? primaryOrient : alternateOrient;
    }
    return col % 2 === 0 ? primaryOrient : alternateOrient;
  }

  _buildBodyNeighborhood(primaryOrient, alternateOrient, rowMode, dxMm, dyMm) {
    const placements = [];
    const sampleRows = 4;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      for (let col = 0; col < sampleCols; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col);
        placements.push({
          id: `body_${row}_${col}`,
          orient,
          x: col * dxMm,
          y: row * dyMm
        });
      }
    }

    return placements;
  }

  _buildUniformNeighborhood(orient, dxMm, dyMm) {
    const placements = [];
    const sampleRows = 4;
    const sampleCols = 6;

    for (let row = 0; row < sampleRows; row++) {
      for (let col = 0; col < sampleCols; col++) {
        placements.push({
          id: `uniform_${row}_${col}`,
          orient,
          x: col * dxMm,
          y: row * dyMm
        });
      }
    }

    return placements;
  }

  _buildSequentialBodyRow(primaryOrient, alternateOrient, rowMode, workWidth, config, step) {
    const precision = Math.min(step, 0.05);
    const buildRow = (validateAgainstWholeRow) => {
      const placements = [];

      for (let col = 0; ; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, 0, col);
        const maxX = roundMetric(workWidth - orient.bb.maxX, 3);
        if (maxX < -1e-6) break;

        const itemId = `body_0_${col}`;
        if (!placements.length) {
          const startX = roundMetric(Math.max(0, -orient.bb.minX), 3);
          if (startX > maxX + 1e-6) break;
          placements.push({
            id: itemId,
            orient,
            x: startX,
            y: 0
          });
          continue;
        }

        const previous = placements[placements.length - 1];
        const minX = roundMetric(previous.x, 3);
        const referencePlacements = validateAgainstWholeRow ? placements : [previous];
        const candidateX = findMinimalContinuousValue(minX, maxX, precision, (x) =>
          !hasCrossPlacementOverlap(
            referencePlacements,
            [
              {
                id: itemId,
                orient,
                x,
                y: 0
              }
            ],
            config.spacing
          )
        );

        if (candidateX == null || candidateX + orient.bb.maxX > workWidth + 1e-6) {
          break;
        }

        placements.push({
          id: itemId,
          orient,
          x: candidateX,
          y: 0
        });
      }

      return placements;
    };

    const row = buildRow(false);
    if (validateLocalPlacements(row, config.spacing).valid) {
      return row;
    }
    return buildRow(true);
  }

  _findSequentialRowPitch(rowPlacements, config, step) {
    if (!rowPlacements.length) return null;

    const precision = Math.min(step, 0.05);
    const rowTop = getPlacementsTop(rowPlacements);
    const rowBottom = getPlacementsBottom(rowPlacements);
    const minDeltaY = 0;
    const upper = buildUpperBound(
      step,
      rowBottom - rowTop + config.spacing + step * 8
    );

    return findMinimalContinuousValue(minDeltaY, upper, precision, (deltaY) =>
      !hasCrossPlacementOverlap(
        rowPlacements,
        rowPlacements.map((placement, index) => ({
          ...placement,
          id: `body_next_${index}`,
          y: roundMetric(placement.y + deltaY, 3)
        })),
        config.spacing
      )
    );
  }

  _findAlignedBodyDx(primaryOrient, alternateOrient, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.width, alternateOrient.width) * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) =>
      validateLocalPlacements(
        this._buildBodyNeighborhood(primaryOrient, alternateOrient, 'rows', dxMm, Math.max(primaryOrient.height, alternateOrient.height) + config.spacing + step * 2).filter(item => item.y === 0),
        config.spacing
      ).valid
    );
  }

  _findAlignedBodyDy(primaryOrient, alternateOrient, rowMode, dxMm, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      Math.max(primaryOrient.height, alternateOrient.height) * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      validateLocalPlacements(
        this._buildBodyNeighborhood(primaryOrient, alternateOrient, rowMode, dxMm, dyMm),
        config.spacing
      ).valid
    );
  }

  _findUniformDx(orient, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      orient.width * 2 + config.spacing + step * 8
    );

    return findMinimalContinuousValue(step, upper, precision, (dxMm) =>
      validateLocalPlacements(
        this._buildUniformNeighborhood(orient, dxMm, orient.height + config.spacing + step * 2).filter(item => item.y === 0),
        config.spacing
      ).valid
    );
  }

  _findUniformDy(orient, dxMm, config, step) {
    const precision = Math.min(step, 0.05);
    const upper = buildUpperBound(
      step,
      orient.height * 2 + config.spacing + step * 8
    );
    const baseRow = this._buildUniformNeighborhood(
      orient,
      dxMm,
      orient.height + config.spacing + step * 2
    ).filter((item) => item.y === 0);

    return findMinimalContinuousValue(step, upper, precision, (dyMm) =>
      !hasCrossPlacementOverlap(
        baseRow,
        baseRow.map((placement, index) => ({
          ...placement,
          id: `uniform_next_${index}`,
          y: roundMetric(dyMm, 3)
        })),
        config.spacing
      )
    );
  }

  _countCols(maxWidth, dxMm, workWidth) {
    let cols = 0;
    while (true) {
      const x = cols * dxMm;
      if (x + maxWidth > workWidth + 1e-6) break;
      cols += 1;
    }
    return cols;
  }

  _countRows(maxHeight, dyMm, workHeight) {
    let rows = 0;
    while (true) {
      const y = rows * dyMm;
      if (y + maxHeight > workHeight + 1e-6) break;
      rows += 1;
    }
    return rows;
  }

  _buildBodyPlacements(primaryOrient, alternateOrient, rowMode, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const orient = this._resolveBodyOrient(primaryOrient, alternateOrient, rowMode, row, col);
        placements.push({
          id: `body_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _buildUniformPlacements(orient, cols, rows, dxMm, dyMm, startY = 0) {
    const placements = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        placements.push({
          id: `fill90_${row}_${col}`,
          orient,
          x: roundMetric(col * dxMm),
          y: roundMetric(startY + row * dyMm)
        });
      }
    }

    return placements;
  }

  _findBodyStartOffsetAfterFillerRow(fillerRowPlacements, bodyRowPlacements, config, step) {
    if (!fillerRowPlacements.length) return 0;

    const precision = Math.min(step, 0.05);
    const bodyTop = getPlacementsTop(bodyRowPlacements);
    const fillerBottom = getPlacementsBottom(fillerRowPlacements);
    const minDeltaY = 0;
    const upper = buildUpperBound(
      step,
      fillerBottom - bodyTop + getPlacementsBottom(bodyRowPlacements) + config.spacing + step * 8
    );

    const deltaY = findMinimalContinuousValue(minDeltaY, upper, precision, (delta) => {
      const shiftedBodyRow = bodyRowPlacements.map((placement, index) => ({
        ...placement,
        id: `body_start_${index}`,
        y: roundMetric(placement.y + delta, 3)
      }));
      return !hasCrossPlacementOverlap(fillerRowPlacements, shiftedBodyRow, config.spacing);
    });

    return deltaY == null ? null : roundMetric(deltaY, 3);
  }

  _buildRepeatedBodyPlacements(rowPlacements, rows, rowPitch, startY = 0) {
    const placements = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < rowPlacements.length; col++) {
        const placement = rowPlacements[col];
        placements.push({
          id: `body_${row}_${col}`,
          orient: placement.orient,
          x: placement.x,
          y: roundMetric(startY + placement.y + row * rowPitch, 3)
        });
      }
    }
    return placements;
  }

  _materializePlacedItems(sizeName, placements, config) {
    const renderTemplates = {};
    const items = placements.map((placement, index) => {
      const worldX = config.marginX + placement.x;
      const worldY = config.marginY + placement.y;
      const polygon = placement.orient.polygon;
      const renderKey = getRenderKey(placement.orient);
      if (!renderTemplates[renderKey]) {
        renderTemplates[renderKey] = {
          path: buildRelativeSvgPath(polygon),
          labelOffset: getRelativeCentroid(polygon)
        };
      }
      return {
        id: `${sizeName}_${placement.orient.foot}_${index}`,
        sizeName,
        foot: placement.orient.foot,
        x: roundMetric(worldX),
        y: roundMetric(worldY),
        angle: placement.orient.angle,
        renderKey
      };
    });
    return { placed: items, renderTemplates };
  }

  _buildCandidate(sizeName, foot, pieceArea, placements, metadata, workWidth, workHeight, config) {
    if (!placements.length) return null;

    const bounds = computeEnvelope(placements);
    if (
      bounds.minX < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > workWidth + 1e-6 ||
      bounds.maxY > workHeight + 1e-6
    ) {
      return null;
    }

    return {
      sizeName,
      selectedFoot: foot,
      pieceArea,
      placedCount: placements.length,
      ...metadata,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, bounds.width * bounds.height - placements.length * pieceArea)),
      placements,
      bounds
    };
  }

  _finalizeCandidate(candidate, config) {
    if (!candidate?.placements?.length) return null;

    const bounds = candidate.bounds || computeEnvelope(candidate.placements);
    return {
      ...candidate,
      usedWidthMm: roundMetric(bounds.width),
      usedHeightMm: roundMetric(bounds.height),
      envelopeWasteMm2: roundMetric(
        Math.max(0, bounds.width * bounds.height - candidate.placedCount * candidate.pieceArea)
      ),
      ...this._materializePlacedItems(candidate.sizeName, candidate.placements, config),
      bounds
    };
  }

  _evaluateFootCandidate(sizeName, foot, polygon, config, workWidth, workHeight) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(polygon) || 1;
    const primaryOrient = this._decorateOrient(sizeName, foot, polygon, 0, config, step);
    const alternateOrient = this._decorateOrient(sizeName, foot, polygon, 180, config, step);
    const filler90Orient = config.allowRotate90 === false
      ? null
      : this._decorateOrient(sizeName, foot, polygon, 90, config, step);

    let filler90DxMm = null;
    let filler90DyMm = null;
    let filler90Cols = 0;
    let maxFiller90Rows = 0;

    if (filler90Orient) {
      filler90DxMm = this._findUniformDx(filler90Orient, config, step);
      if (filler90DxMm != null) {
        filler90DyMm = this._findUniformDy(filler90Orient, filler90DxMm, config, step);
        if (filler90DyMm != null) {
          filler90Cols = this._countCols(filler90Orient.width, filler90DxMm, workWidth);
          maxFiller90Rows = this._countRows(filler90Orient.height, filler90DyMm, workHeight);
        }
      }
    }

    const bodyModes = ['rows'];
    let bestCandidate = null;
    const candidatePool = [];

    for (const rowMode of bodyModes) {
      const bodyRowPlacements = this._buildSequentialBodyRow(
        primaryOrient,
        alternateOrient,
        rowMode,
        workWidth,
        config,
        step
      );
      const bodyCols = bodyRowPlacements.length;
      if (!bodyCols) continue;

      const bodyDyMm = this._findSequentialRowPitch(bodyRowPlacements, config, step);
      if (bodyDyMm == null) continue;
      const bodyHeightMm = getPlacementsBottom(bodyRowPlacements) - getPlacementsTop(bodyRowPlacements);
      const bodyDxMm = getAveragePitchX(bodyRowPlacements);
      const fillerLastRowPlacements = filler90Cols > 0
        ? this._buildUniformPlacements(filler90Orient, filler90Cols, 1, filler90DxMm, filler90DyMm, 0)
        : [];
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
        const fillerHeight = filler90Rows > 0
          ? filler90Orient.height + (filler90Rows - 1) * filler90DyMm
          : 0;
        if (fillerHeight > workHeight + 1e-6) continue;

        if (filler90Rows > 0 && bodyStartOffsetAfterFillerRow == null) continue;
        const lastFillerRowY = filler90Rows > 0
          ? roundMetric((filler90Rows - 1) * filler90DyMm)
          : 0;
        const bodyStartY = filler90Rows > 0
          ? roundMetric(lastFillerRowY + bodyStartOffsetAfterFillerRow)
          : 0;

        const bodyRows = this._countRows(
          bodyHeightMm,
          bodyDyMm,
          Math.max(0, workHeight - bodyStartY)
        );
        const bodyCount = bodyCols * bodyRows;
        const fillerCount = filler90Cols * filler90Rows;
        const totalCount = bodyCount + fillerCount;

        if (bestCandidate) {
          if (totalCount < bestCandidate.placedCount) continue;
          if (totalCount === bestCandidate.placedCount && bodyCount < bestCandidate.bodyCount) continue;
          if (
            totalCount === bestCandidate.placedCount &&
            bodyCount === bestCandidate.bodyCount &&
            fillerCount > bestCandidate.filler90Count
          ) {
            continue;
          }
        }

        const fillerPlacements = filler90Rows > 0
          ? this._buildUniformPlacements(filler90Orient, filler90Cols, filler90Rows, filler90DxMm, filler90DyMm, 0)
          : [];
        const bodyPlacements = bodyRows > 0
          ? this._buildRepeatedBodyPlacements(bodyRowPlacements, bodyRows, bodyDyMm, bodyStartY)
          : [];

        const placements = [...fillerPlacements, ...bodyPlacements];
        const candidate = this._buildCandidate(
          sizeName,
          foot,
          pieceArea,
          placements,
          {
            rowMode,
            bodyCount,
            bodyCols,
            bodyRows,
            bodyDxMm,
            bodyDyMm: roundMetric(bodyDyMm),
            bodyStartY: roundMetric(bodyStartY),
            bodyPrimaryAngle: 0,
            bodyAlternateAngle: 180,
            filler90Used: filler90Rows > 0,
            filler90Count: fillerCount,
            filler90Cols,
            filler90Rows,
            filler90DxMm: filler90DxMm != null ? roundMetric(filler90DxMm) : null,
            filler90DyMm: filler90DyMm != null ? roundMetric(filler90DyMm) : null,
            filler90Angle: filler90Orient ? 90 : null,
            scanOrder: 'left-to-right-then-down'
          },
          workWidth,
          workHeight,
          config
        );

        if (candidate) {
          candidatePool.push(candidate);
          if (compareAlignedCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }

    if (!candidatePool.length) return null;

    candidatePool.sort((left, right) => compareAlignedCandidates(left, right));
    for (const candidate of candidatePool) {
      const finalized = this._finalizeCandidate(candidate, config);
      if (finalized) return finalized;
    }

    return null;
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const placedCount = candidate.placed.length;
    const efficiency = totalArea > 0
      ? roundMetric((placedCount * candidate.pieceArea / totalArea) * 100, 1)
      : 0;

    return {
      sheetIndex: 0,
      placed: candidate.placed,
      renderTemplates: candidate.renderTemplates,
      sheetWidth: config.sheetWidth,
      sheetHeight: config.sheetHeight,
      placedCount,
      efficiency
    };
  }

  async testCapacity(sizeList, overrideConfig = {}) {
    const config = {
      ...this.config,
      ...overrideConfig,
      capacityLayoutMode: 'same-side-banded',
      pairingStrategy: 'same-side',
      mirrorPairs: false,
      allowRotate180: true
    };

    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);

    const sheetsBySize = {};
    const summary = [];

    for (const size of sizeList) {
      const basePolygon = normalizeToOrigin(size.polygon);
      const footCandidates = [
        { foot: 'L', polygon: basePolygon },
        { foot: 'R', polygon: normalizeToOrigin(flipX(size.polygon)) }
      ];

      let bestCandidate = null;

      for (const footCandidate of footCandidates) {
        const candidate = this._evaluateFootCandidate(
          size.sizeName,
          footCandidate.foot,
          footCandidate.polygon,
          config,
          workWidth,
          workHeight
        );

        if (candidate && compareAlignedCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
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

      const sheet = this._buildSheetFromCandidate(size.sizeName, bestCandidate, config, totalArea);
      sheetsBySize[size.sizeName] = sheet;

      summary.push({
        sizeName: size.sizeName,
        sizeValue: size.sizeValue,
        totalPieces: sheet.placedCount,
        pairs: 0,
        placedCount: sheet.placedCount,
        efficiency: sheet.efficiency
      });
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-same-side-banded',
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
