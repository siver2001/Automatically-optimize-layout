import { BaseNesting } from '../../core/BaseNesting.js';
import {
  flipX,
  normalizeToOrigin,
  area as polygonArea,
  polygonsOverlap
} from '../../core/polygonUtils.js';
import {
  buildShiftCandidates,
  compareComplementaryCandidates,
  computeEnvelope,
  findMinimalQuantizedValue,
  getOrientBounds,
  quantizeToStep,
  roundMetric,
  validateLocalPlacements,
  validatePatternPlacements
} from './patternCapacityUtils.js';

const PAIR_SHIFT_SAMPLE_LIMIT = 19;
const ROW_SHIFT_X_SAMPLE_LIMIT = 21;
const ROW_SHIFT_Y_SAMPLE_LIMIT = 13;
const ROW_REPEAT_CHECK_COUNT = 4;
const ROW_NEIGHBOR_COL_START = -1;
const ROW_NEIGHBOR_COL_END = 2;

function compareMotifCandidates(nextMotif, bestMotif) {
  if (!bestMotif) return -1;
  const nextArea = nextMotif.width * nextMotif.height;
  const bestArea = bestMotif.width * bestMotif.height;
  if (nextArea !== bestArea) {
    return nextArea - bestArea;
  }
  if (nextMotif.height !== bestMotif.height) {
    return nextMotif.height - bestMotif.height;
  }
  if (nextMotif.width !== bestMotif.width) {
    return nextMotif.width - bestMotif.width;
  }
  if (Math.abs(nextMotif.pairDyMm) !== Math.abs(bestMotif.pairDyMm)) {
    return Math.abs(nextMotif.pairDyMm) - Math.abs(bestMotif.pairDyMm);
  }
  return nextMotif.pairDxMm - bestMotif.pairDxMm;
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

export class CapacityTestComplementaryPattern extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _minSepV(rA, rB, dx) {
    for (let dy = -rB.rows; dy <= rA.rows + rB.rows; dy++) {
      let overlap = false;
      const yStart = Math.max(0, dy);
      const yEnd = Math.min(rA.rows, dy + rB.rows);
      if (yStart < yEnd) {
        outer: for (let r = yStart; r < yEnd; r++) {
          const offA = r * rA.cols;
          const offB = (r - dy) * rB.cols;
          for (let cB = 0; cB < rB.cols; cB++) {
            const cA = cB + dx;
            if (cA >= 0 && cA < rA.cols && rA.cells[offA + cA] && rB.cells[offB + cB]) {
              overlap = true;
              break outer;
            }
          }
        }
      }
      if (!overlap) return dy;
    }
    return rA.rows + rB.rows;
  }

  _minSepH(rA, rB, dy) {
    for (let dx = -rB.cols; dx <= rA.cols + rB.cols; dx++) {
      let overlap = false;
      const xStart = Math.max(0, dx);
      const xEnd = Math.min(rA.cols, dx + rB.cols);
      if (xStart < xEnd) {
        outer: for (let c = xStart; c < xEnd; c++) {
          for (let rowB = 0; rowB < rB.rows; rowB++) {
            const rowA = rowB + dy;
            if (rowA >= 0 && rowA < rA.rows) {
              if (rA.cells[rowA * rA.cols + c] && rB.cells[rowB * rB.cols + (c - dx)]) {
                overlap = true;
                break outer;
              }
            }
          }
        }
      }
      if (!overlap) return dx;
    }
    return rA.cols + rB.cols;
  }

  _getAngleFamilies(config) {
    const allowed = new Set(this._getAllowedAngles(config));
    let bodyAngles = [0, 180].filter((angle) => allowed.has(angle));
    let topAngles = [90, 270].filter((angle) => allowed.has(angle));

    if (!bodyAngles.length) {
      bodyAngles = [...allowed].sort((a, b) => a - b);
    }
    if (!topAngles.length && config.allowRotate90 !== false && allowed.has(90)) {
      topAngles = [90];
    }

    return {
      bodyAngles,
      topAngles
    };
  }

  _buildOrients(sizeName, foot, polygon, angles, config, step) {
    const item = { sizeName, foot, polygon };
    return [...new Set(angles)]
      .map((angle) => {
        const orient = this._getOrient(item, angle, step, config.spacing);
        const bb = getOrientBounds(orient);
        return {
          ...orient,
          foot,
          bb,
          width: bb.width,
          height: bb.height,
          key: `${foot}-${angle}`
        };
      })
      .sort((a, b) => a.angle - b.angle);
  }

  _isPairSafe(orientA, orientB, dxMm, dyMm, spacing, step) {
    if (dxMm === 0 && dyMm === 0) return false;
    const dx = Math.round(dxMm / step);
    const dy = Math.round(dyMm / step);
    if (this._checkRasterOverlap(orientA.raster, orientB.raster, dx, dy)) {
      return false;
    }
    return !polygonsOverlap(
      orientA.polygon,
      orientB.polygon,
      { x: 0, y: 0 },
      { x: dxMm, y: dyMm },
      spacing,
      orientA.bb,
      orientB.bb
    );
  }

  _createMotif(order, leftOrient, rightOrient, pairDxMm, pairDyMm, name) {
    const firstOrient = order === 'LR' ? leftOrient : rightOrient;
    const secondOrient = order === 'LR' ? rightOrient : leftOrient;
    const rawItems = [
      { id: `${name}_0`, orient: firstOrient, x: 0, y: 0 },
      { id: `${name}_1`, orient: secondOrient, x: pairDxMm, y: pairDyMm }
    ];
    const rawBounds = computeEnvelope(rawItems);
    const items = rawItems.map((item) => ({
      ...item,
      x: item.x - rawBounds.minX,
      y: item.y - rawBounds.minY
    }));
    const bounds = computeEnvelope(items);

    return {
      name,
      order,
      items,
      bounds,
      width: bounds.width,
      height: bounds.height,
      pairDxMm: roundMetric(pairDxMm),
      pairDyMm: roundMetric(pairDyMm),
      leftOrient,
      rightOrient,
      leftAngle: leftOrient.angle,
      rightAngle: rightOrient.angle
    };
  }

  _materializeMotif(motif, originX, originY, prefix) {
    return motif.items.map((item, index) => ({
      id: `${prefix}_${index}`,
      orient: item.orient,
      x: originX + item.x,
      y: originY + item.y
    }));
  }

  _buildRowSpecs(startFoot, leftOrients, rightOrients) {
    const specs = [];
    for (const leftOrient of leftOrients) {
      for (const rightOrient of rightOrients) {
        specs.push({
          startFoot,
          leftOrient,
          rightOrient
        });
      }
    }
    return specs;
  }

  _getRowOrient(rowSpec, col) {
    const isEvenCol = Math.abs(col) % 2 === 0;
    const useLeft = rowSpec.startFoot === 'L' ? isEvenCol : !isEvenCol;
    return useLeft ? rowSpec.leftOrient : rowSpec.rightOrient;
  }

  _buildAlternatingRowPlacements(rowSpec, dxMm, colShiftYmm, rowXmm, rowYmm, colStart, colEnd, prefix) {
    const placements = [];
    for (let col = colStart; col <= colEnd; col++) {
      placements.push({
        id: `${prefix}_${col}`,
        orient: this._getRowOrient(rowSpec, col),
        x: rowXmm + col * dxMm,
        y: rowYmm + (Math.abs(col) % 2 === 1 ? colShiftYmm : 0)
      });
    }
    return placements;
  }

  _areSameRowSafe(rowSpec, dxMm, colShiftYmm, spacing) {
    const placements = this._buildAlternatingRowPlacements(rowSpec, dxMm, colShiftYmm, 0, 0, -2, 5, 'same_row');
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findAlternatingDx(row0Spec, row1Spec, colShiftYmm, config, step) {
    const widthUpper = Math.max(
      row0Spec.leftOrient.width,
      row0Spec.rightOrient.width,
      row1Spec.leftOrient.width,
      row1Spec.rightOrient.width
    );
    const upper = Math.max(
      step,
      quantizeToStep(widthUpper * 2 + Math.abs(colShiftYmm) + config.spacing + step * 6, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (dxMm) =>
      this._areSameRowSafe(row0Spec, dxMm, colShiftYmm, config.spacing) &&
      this._areSameRowSafe(row1Spec, dxMm, colShiftYmm, config.spacing)
    );
  }

  _areAdjacentAlternatingRowsSafe(row0Spec, row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowShiftYmm, rowStrideYmm, spacing) {
    const placements = [
      ...this._buildAlternatingRowPlacements(row0Spec, dxMm, colShiftYmm, 0, 0, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row0'),
      ...this._buildAlternatingRowPlacements(row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowStrideYmm + rowShiftYmm, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row1'),
      ...this._buildAlternatingRowPlacements(row0Spec, dxMm, colShiftYmm, 0, rowStrideYmm * 2, ROW_NEIGHBOR_COL_START, ROW_NEIGHBOR_COL_END + 2, 'row2')
    ];
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findAlternatingDy(row0Spec, row1Spec, dxMm, colShiftYmm, rowShiftXmm, rowShiftYmm, config, step) {
    const heightUpper = Math.max(
      row0Spec.leftOrient.height,
      row0Spec.rightOrient.height,
      row1Spec.leftOrient.height,
      row1Spec.rightOrient.height
    );
    const upper = Math.max(
      step,
      quantizeToStep(heightUpper * 2 + Math.abs(colShiftYmm) + Math.abs(rowShiftYmm) + config.spacing + step * 10, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideYmm) =>
      this._areAdjacentAlternatingRowsSafe(
        row0Spec,
        row1Spec,
        dxMm,
        colShiftYmm,
        rowShiftXmm,
        rowShiftYmm,
        rowStrideYmm,
        config.spacing
      )
    );
  }

  _findBestMotif(order, leftOrient, rightOrient, config, step, namePrefix) {
    const firstOrient = order === 'LR' ? leftOrient : rightOrient;
    const secondOrient = order === 'LR' ? rightOrient : leftOrient;
    let bestMotif = null;

    const considerCandidate = (dxCells, dyCells) => {
      const dxMm = dxCells * step;
      const dyMm = dyCells * step;
      if (!this._isPairSafe(firstOrient, secondOrient, dxMm, dyMm, config.spacing, step)) {
        return;
      }
      const motif = this._createMotif(order, leftOrient, rightOrient, dxMm, dyMm, namePrefix);
      if (compareMotifCandidates(motif, bestMotif) < 0) {
        bestMotif = motif;
      }
    };

    for (let dxCells = -secondOrient.raster.cols; dxCells <= firstOrient.raster.cols; dxCells++) {
      const dyCells = this._minSepV(firstOrient.raster, secondOrient.raster, dxCells);
      considerCandidate(dxCells, dyCells);
    }

    for (let dyCells = -secondOrient.raster.rows; dyCells <= firstOrient.raster.rows; dyCells++) {
      const dxCells = this._minSepH(firstOrient.raster, secondOrient.raster, dyCells);
      considerCandidate(dxCells, dyCells);
    }

    return bestMotif;
  }

  _buildMotifOptions(order, leftOrients, rightOrients, config, step, deadline, prefix) {
    const motifs = [];

    for (const leftOrient of leftOrients) {
      if (Date.now() > deadline) break;
      for (const rightOrient of rightOrients) {
        if (Date.now() > deadline) break;
        const motif = this._findBestMotif(
          order,
          leftOrient,
          rightOrient,
          config,
          step,
          `${prefix}_${leftOrient.angle}_${rightOrient.angle}`
        );
        if (motif) {
          motifs.push(motif);
        }
      }
    }

    return motifs.sort((a, b) => compareMotifCandidates(a, b));
  }

  _areRowRepeatsSafe(motif, rowStrideXmm, spacing) {
    const placements = [];
    for (let col = 0; col < ROW_REPEAT_CHECK_COUNT; col++) {
      placements.push(...this._materializeMotif(motif, col * rowStrideXmm, 0, `repeat_${col}`));
    }
    return validateLocalPlacements(placements, spacing).valid;
  }

  _findRowStrideX(row0Motif, row1Motif, config, step) {
    const upper = Math.max(
      step,
      quantizeToStep(Math.max(row0Motif.width, row1Motif.width) * 2 + config.spacing + step * 8, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideXmm) =>
      this._areRowRepeatsSafe(row0Motif, rowStrideXmm, config.spacing) &&
      this._areRowRepeatsSafe(row1Motif, rowStrideXmm, config.spacing)
    );
  }

  _buildRowNeighborhood(row0Motif, row1Motif, rowStrideXmm, rowShiftXmm, rowShiftYmm, rowStrideYmm) {
    const rows = [];
    const motifs = [row0Motif, row1Motif, row0Motif];

    for (let row = 0; row < motifs.length; row++) {
      const motif = motifs[row];
      const isOddRow = row % 2 === 1;
      const rowX = isOddRow ? rowShiftXmm : 0;
      const rowY = row * rowStrideYmm + (isOddRow ? rowShiftYmm : 0);

      for (let col = ROW_NEIGHBOR_COL_START; col <= ROW_NEIGHBOR_COL_END; col++) {
        rows.push(...this._materializeMotif(motif, rowX + col * rowStrideXmm, rowY, `row_${row}_${col}`));
      }
    }

    return rows;
  }

  _findRowStrideY(row0Motif, row1Motif, rowStrideXmm, rowShiftXmm, rowShiftYmm, config, step) {
    const upper = Math.max(
      step,
      quantizeToStep(row0Motif.height + row1Motif.height + Math.abs(rowShiftYmm) + config.spacing + step * 10, step)
    );

    return findMinimalQuantizedValue(step, upper, step, (rowStrideYmm) => {
      const neighborhood = this._buildRowNeighborhood(
        row0Motif,
        row1Motif,
        rowStrideXmm,
        rowShiftXmm,
        rowShiftYmm,
        rowStrideYmm
      );
      return validateLocalPlacements(neighborhood, config.spacing).valid;
    });
  }

  _buildBodyPlacements(pattern, workWidth, workHeight, startYmm = 0, maxRows = Number.MAX_SAFE_INTEGER) {
    const placements = [];
    const baseX = pattern.rowShiftXmm < 0 ? -pattern.rowShiftXmm : 0;
    const minEvenY = Math.min(0, pattern.colShiftYmm);
    const minOddY = pattern.rowShiftYmm + Math.min(0, pattern.colShiftYmm);
    const baseY = startYmm - Math.min(0, minEvenY, minOddY);
    let usedRows = 0;
    let usedCols = 0;

    for (let row = 0; row < maxRows; row++) {
      const rowX = baseX + (row % 2 === 1 ? pattern.rowShiftXmm : 0);
      const rowY = baseY + row * pattern.rowStrideYmm + (row % 2 === 1 ? pattern.rowShiftYmm : 0);
      const rowSpec = row % 2 === 1 ? pattern.row1Spec : pattern.row0Spec;
      const maxRowHeight = Math.max(rowSpec.leftOrient.height, rowSpec.rightOrient.height) + Math.abs(pattern.colShiftYmm);
      if (rowY + maxRowHeight > workHeight + 1e-6) break;

      const rowPlacements = [];
      for (let col = 0; ; col++) {
        const orient = this._getRowOrient(rowSpec, col);
        const x = rowX + col * pattern.dxMm;
        if (x + orient.width > workWidth + 1e-6) break;
        const y = rowY + (col % 2 === 1 ? pattern.colShiftYmm : 0);
        if (y < -1e-6 || y + orient.height > workHeight + 1e-6) continue;

        rowPlacements.push({
          id: `body_${row}_${col}`,
          orient,
          x,
          y
        });
      }

      if (!rowPlacements.length) break;

      placements.push(...rowPlacements);
      usedRows += 1;
      usedCols = Math.max(usedCols, Math.floor(rowPlacements.length / 2));
    }

    return {
      placements,
      usedRows,
      usedCols
    };
  }

  _buildTopBandPlacements(topPattern, workWidth, workHeight) {
    const placements = [];
    const minY = Math.min(0, topPattern.colShiftYmm);
    const baseY = -minY;
    const rowHeight = Math.max(topPattern.rowSpec.leftOrient.height, topPattern.rowSpec.rightOrient.height) + Math.abs(topPattern.colShiftYmm);
    if (rowHeight > workHeight + 1e-6) {
      return { placements, topBandPairs: 0 };
    }

    for (let col = 0; ; col++) {
      const orient = this._getRowOrient(topPattern.rowSpec, col);
      const x = col * topPattern.dxMm;
      if (x + orient.width > workWidth + 1e-6) break;
      const y = baseY + (col % 2 === 1 ? topPattern.colShiftYmm : 0);
      if (y < -1e-6 || y + orient.height > workHeight + 1e-6) continue;

      placements.push({
        id: `top_${col}`,
        orient,
        x,
        y
      });
    }

    return {
      placements,
      topBandPairs: placements.length / 2
    };
  }

  _findBodyStartY(topPlacements, pattern, workWidth, workHeight, config, step) {
    return findMinimalQuantizedValue(0, workHeight, step, (startYmm) => {
      const body = this._buildBodyPlacements(pattern, workWidth, workHeight, startYmm, 2);
      if (!body.placements.length) return false;
      return validatePatternPlacements([...topPlacements, ...body.placements], workWidth, workHeight, config.spacing).valid;
    });
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

  _buildCandidate(sizeName, pieceArea, placements, metadata, workWidth, workHeight, config) {
    if (!placements.length) return null;

    const quickBounds = computeEnvelope(placements);
    const quickCandidate = {
      ...metadata,
      pieceArea,
      placedCount: placements.length,
      usedHeightMm: roundMetric(quickBounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, quickBounds.width * quickBounds.height - placements.length * pieceArea))
    };

    const validation = validatePatternPlacements(placements, workWidth, workHeight, config.spacing);
    if (!validation.valid) return null;

    return {
      ...quickCandidate,
      ...this._materializePlacedItems(sizeName, placements, config),
      bounds: validation.bounds,
      usedHeightMm: roundMetric(validation.bounds.height),
      envelopeWasteMm2: roundMetric(Math.max(0, validation.bounds.width * validation.bounds.height - placements.length * pieceArea))
    };
  }

  _findBestForSize(size, config, workWidth, workHeight, deadline) {
    const step = config.gridStep || 1;
    const pieceArea = polygonArea(size.polygon) || 1;
    const baseLeft = normalizeToOrigin(size.polygon);
    const baseRight = normalizeToOrigin(flipX(size.polygon));
    const { bodyAngles, topAngles } = this._getAngleFamilies(config);
    const leftBodyOrients = this._buildOrients(size.sizeName, 'L', baseLeft, bodyAngles, config, step);
    const rightBodyOrients = this._buildOrients(size.sizeName, 'R', baseRight, bodyAngles, config, step);
    const leftTopOrients = topAngles.length
      ? this._buildOrients(size.sizeName, 'L', baseLeft, topAngles, config, step)
      : [];
    const rightTopOrients = topAngles.length
      ? this._buildOrients(size.sizeName, 'R', baseRight, topAngles, config, step)
      : [];

    const families = ['checkerboard', 'stripe'];

    let bestCandidate = null;
    const startOrders = ['L', 'R'];

    for (const family of families) {
      for (const startFoot of startOrders) {
        const row0Specs = this._buildRowSpecs(startFoot, leftBodyOrients, rightBodyOrients);
        const row1StartFoot = family === 'checkerboard'
          ? (startFoot === 'L' ? 'R' : 'L')
          : startFoot;
        const row1Specs = this._buildRowSpecs(row1StartFoot, leftBodyOrients, rightBodyOrients);

        for (const row0Spec of row0Specs) {
          if (Date.now() > deadline) return bestCandidate;

          for (const row1Spec of row1Specs) {
            if (Date.now() > deadline) return bestCandidate;

            const colShiftRange = Math.max(
              row0Spec.leftOrient.height,
              row0Spec.rightOrient.height,
              row1Spec.leftOrient.height,
              row1Spec.rightOrient.height
            ) * 0.35;
            const colShiftCandidates = buildShiftCandidates(colShiftRange, step, PAIR_SHIFT_SAMPLE_LIMIT);

            for (const colShiftYmm of colShiftCandidates) {
              if (Date.now() > deadline) return bestCandidate;

              const dxMm = this._findAlternatingDx(row0Spec, row1Spec, colShiftYmm, config, step);
              if (dxMm == null) continue;

              const rowShiftXRange = Math.max(
                row0Spec.leftOrient.width,
                row0Spec.rightOrient.width,
                row1Spec.leftOrient.width,
                row1Spec.rightOrient.width
              ) * 0.5;
              const rowShiftYRange = Math.max(
                row0Spec.leftOrient.height,
                row0Spec.rightOrient.height,
                row1Spec.leftOrient.height,
                row1Spec.rightOrient.height
              ) * 0.15;
              const rowShiftXCandidates = buildShiftCandidates(rowShiftXRange, step, ROW_SHIFT_X_SAMPLE_LIMIT);
              const rowShiftYCandidates = buildShiftCandidates(rowShiftYRange, step, ROW_SHIFT_Y_SAMPLE_LIMIT);

              for (const rowShiftXmm of rowShiftXCandidates) {
                if (Date.now() > deadline) return bestCandidate;

                for (const rowShiftYmm of rowShiftYCandidates) {
                  if (Date.now() > deadline) return bestCandidate;

                  const rowStrideYmm = this._findAlternatingDy(
                    row0Spec,
                    row1Spec,
                    dxMm,
                    colShiftYmm,
                    rowShiftXmm,
                    rowShiftYmm,
                    config,
                    step
                  );
                  if (rowStrideYmm == null) continue;

                  const pattern = {
                    patternFamily: family,
                    row0Spec,
                    row1Spec,
                    dxMm,
                    colShiftYmm,
                    rowStrideXmm: dxMm * 2,
                    rowStrideYmm,
                    rowShiftXmm,
                    rowShiftYmm
                  };

                  const bodyOnly = this._buildBodyPlacements(pattern, workWidth, workHeight, 0);
                  if (!bodyOnly.placements.length) continue;

                  const bodyCandidate = this._buildCandidate(
                    size.sizeName,
                    pieceArea,
                    bodyOnly.placements,
                    {
                      patternFamily: family,
                      topBandUsed: false,
                      topBandPairs: 0,
                      topBandAngleLeft: null,
                      topBandAngleRight: null,
                      bodyRow0LeftAngle: row0Spec.leftOrient.angle,
                      bodyRow0RightAngle: row0Spec.rightOrient.angle,
                      bodyRow1LeftAngle: row1Spec.leftOrient.angle,
                      bodyRow1RightAngle: row1Spec.rightOrient.angle,
                      pairDxMm: roundMetric(dxMm),
                      pairDyMm: roundMetric(colShiftYmm),
                      rowStrideXmm: roundMetric(dxMm * 2),
                      rowStrideYmm: roundMetric(rowStrideYmm),
                      rowShiftXmm: roundMetric(rowShiftXmm),
                      rowShiftYmm: roundMetric(rowShiftYmm),
                      usedRows: bodyOnly.usedRows,
                      usedCols: bodyOnly.usedCols
                    },
                    workWidth,
                    workHeight,
                    config
                  );

                  if (bodyCandidate && compareComplementaryCandidates(bodyCandidate, bestCandidate) < 0) {
                    bestCandidate = bodyCandidate;
                  }

                  if (!leftTopOrients.length || !rightTopOrients.length) continue;

                  for (const topStartFoot of startOrders) {
                    if (Date.now() > deadline) return bestCandidate;
                    const topSpecs = this._buildRowSpecs(topStartFoot, leftTopOrients, rightTopOrients);

                    for (const topSpec of topSpecs) {
                      if (Date.now() > deadline) return bestCandidate;

                      const topColShiftRange = Math.max(topSpec.leftOrient.height, topSpec.rightOrient.height) * 0.35;
                      const topColShiftCandidates = buildShiftCandidates(topColShiftRange, step, PAIR_SHIFT_SAMPLE_LIMIT);

                      for (const topColShiftYmm of topColShiftCandidates) {
                        const topDxMm = this._findAlternatingDx(topSpec, topSpec, topColShiftYmm, config, step);
                        if (topDxMm == null) continue;

                        const topBand = this._buildTopBandPlacements(
                          {
                            rowSpec: topSpec,
                            dxMm: topDxMm,
                            colShiftYmm: topColShiftYmm
                          },
                          workWidth,
                          workHeight
                        );
                        if (!topBand.topBandPairs) continue;

                        const bodyStartYmm = this._findBodyStartY(topBand.placements, pattern, workWidth, workHeight, config, step);
                        if (bodyStartYmm == null) continue;

                        const bodyWithTop = this._buildBodyPlacements(pattern, workWidth, workHeight, bodyStartYmm);
                        if (!bodyWithTop.placements.length) continue;

                        const candidate = this._buildCandidate(
                          size.sizeName,
                          pieceArea,
                          [...topBand.placements, ...bodyWithTop.placements],
                          {
                            patternFamily: family,
                            topBandUsed: true,
                            topBandPairs: topBand.topBandPairs,
                            topBandAngleLeft: topSpec.leftOrient.angle,
                            topBandAngleRight: topSpec.rightOrient.angle,
                            bodyRow0LeftAngle: row0Spec.leftOrient.angle,
                            bodyRow0RightAngle: row0Spec.rightOrient.angle,
                            bodyRow1LeftAngle: row1Spec.leftOrient.angle,
                            bodyRow1RightAngle: row1Spec.rightOrient.angle,
                            pairDxMm: roundMetric(dxMm),
                            pairDyMm: roundMetric(colShiftYmm),
                            rowStrideXmm: roundMetric(dxMm * 2),
                            rowStrideYmm: roundMetric(rowStrideYmm),
                            rowShiftXmm: roundMetric(rowShiftXmm),
                            rowShiftYmm: roundMetric(rowShiftYmm),
                            usedRows: bodyWithTop.usedRows,
                            usedCols: bodyWithTop.usedCols
                          },
                          workWidth,
                          workHeight,
                          config
                        );

                        if (candidate && compareComplementaryCandidates(candidate, bestCandidate) < 0) {
                          bestCandidate = candidate;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return bestCandidate;
  }

  _buildSheetFromCandidate(sizeName, candidate, config, totalArea) {
    const placedCount = candidate.placed.length;
    const pairs = Math.floor(placedCount / 2);
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
      capacityLayoutMode: overrideConfig.capacityLayoutMode === 'legacy-pair'
        ? 'legacy-pair'
        : 'pair-complementary',
      pairingStrategy: 'pair',
      mirrorPairs: true
    };

    this._orientCache.clear();
    const startTime = Date.now();
    const totalArea = config.sheetWidth * config.sheetHeight;
    const workWidth = config.sheetWidth - 2 * (config.marginX || 0);
    const workHeight = config.sheetHeight - 2 * (config.marginY || 0);
    const perSizeBudget = Math.max(2500, Math.floor((config.maxTimeMs || 120000) / Math.max(1, sizeList.length)));

    const sheetsBySize = {};
    const summary = [];

    for (const size of sizeList) {
      const candidate = this._findBestForSize(
        size,
        config,
        workWidth,
        workHeight,
        Date.now() + perSizeBudget
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
        totalPieces: sheet.placedCount,
        pairs: Math.floor(sheet.placedCount / 2),
        placedCount: sheet.placedCount,
        efficiency: sheet.efficiency
      });
    }

    const defaultSizeName = sizeList[0]?.sizeName || null;
    const defaultSheet = defaultSizeName ? sheetsBySize[defaultSizeName] : null;

    return {
      success: true,
      mode: 'test-capacity-pair-complementary',
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
