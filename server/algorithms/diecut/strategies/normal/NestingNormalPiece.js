import { BaseNesting } from '../../core/BaseNesting.js';
import { flipXWithCenter, getBoundingBox, translate, area as polygonArea } from '../../core/polygonUtils.js';
import { PairOptimizer } from '../../core/pairOptimizer.js';

function isPreparedDoubleContourMode(config = {}) {
  return config?.capacityLayoutMode === 'same-side-double-contour';
}

export class NestingNormalPiece extends BaseNesting {
  constructor(config = {}) {
    super(config);
  }

  _scoreUnit(totalArea, widthMm, heightMm, itemCount = 1) {
    const bboxArea = Math.max(1e-6, widthMm * heightMm);
    const fillDensity = totalArea / bboxArea;
    const lowProfileScore = 1 / Math.max(1e-6, heightMm);
    const throughputScore = (itemCount / Math.max(1e-6, widthMm)) * 120;
    const footprintScore = (itemCount / bboxArea) * 10000;
    const compactScore = fillDensity * 0.74 + footprintScore * 0.26;
    const rowScore = (lowProfileScore * 50) * 0.20 + fillDensity * 0.40 + throughputScore * 0.40;
    const totalScore = rowScore * 0.62 + compactScore * 0.38;

    return {
      compactScore,
      rowScore,
      totalScore,
      fillDensity
    };
  }

  _buildUnitFromOrient(item, orient, step) {
    if (!orient?.raster?.cols || !orient?.raster?.rows) return null;

    const sx = this._findStride(orient.raster, false);
    const sy = this._findStride(orient.raster, true);
    const widthMm = sx * step;
    const heightMm = sy * step;
    const totalArea = polygonArea(orient.polygon);
    const scores = this._scoreUnit(totalArea, widthMm, heightMm, 1);

    return {
      kind: 'single',
      sizeName: item.sizeName,
      foot: item.foot,
      itemCount: 1,
      pieceCount: item.pieceCount ?? 1,
      orient,
      raster: orient.raster,
      placements: [{ dx: 0, dy: 0, orient }],
      sx,
      sy,
      widthMm,
      heightMm,
      totalArea,
      ...scores
    };
  }

  _buildStaggeredUnitFromResult(item, result, config, step) {
    const firstOrient = this._getOrient(item, result.angle1, step, config.spacing);
    const secondOrient = this._getOrient(item, result.angle2, step, config.spacing);
    if (!firstOrient?.raster?.cols || !secondOrient?.raster?.cols) return null;

    const dx = Math.round(result.offset.x / step);
    const dy = Math.round(result.offset.y / step);
    const minX = Math.min(0, dx);
    const minY = Math.min(0, dy);
    const maxX = Math.max(firstOrient.raster.cols, dx + secondOrient.raster.cols);
    const maxY = Math.max(firstOrient.raster.rows, dy + secondOrient.raster.rows);
    if (maxX <= minX || maxY <= minY) return null;

    const cols = maxX - minX;
    const rows = maxY - minY;
    const cells = new Uint8Array(cols * rows);
    const ax = -minX;
    const ay = -minY;
    const bx = dx - minX;
    const by = dy - minY;

    for (let r = 0; r < firstOrient.raster.rows; r++) {
      const src = r * firstOrient.raster.cols;
      const dst = (ay + r) * cols + ax;
      for (let c = 0; c < firstOrient.raster.cols; c++) {
        if (firstOrient.raster.cells[src + c]) cells[dst + c] = 1;
      }
    }

    for (let r = 0; r < secondOrient.raster.rows; r++) {
      const src = r * secondOrient.raster.cols;
      const dst = (by + r) * cols + bx;
      for (let c = 0; c < secondOrient.raster.cols; c++) {
        if (secondOrient.raster.cells[src + c]) cells[dst + c] = 1;
      }
    }

    const raster = { cells, cols, rows };
    const sx = this._findStride(raster, false);
    const sy = this._findStride(raster, true);
    const widthMm = sx * step;
    const heightMm = sy * step;
    const totalArea = polygonArea(firstOrient.polygon) + polygonArea(secondOrient.polygon);
    const scores = this._scoreUnit(totalArea, widthMm, heightMm, 2);

    return {
      kind: 'staggered',
      sizeName: item.sizeName,
      foot: item.foot,
      itemCount: 2,
      pieceCount: (item.pieceCount ?? 1) * 2,
      raster,
      placements: [
        { dx: ax, dy: ay, orient: firstOrient },
        { dx: bx, dy: by, orient: secondOrient }
      ],
      sx,
      sy,
      widthMm,
      heightMm,
      totalArea,
      ...scores
    };
  }

  _dedupeUnits(units) {
    const seen = new Set();
    return units.filter((unit) => {
      if (!unit?.raster) return false;
      const placementKey = (unit.placements || [])
        .map((placement) => `${placement.dx}:${placement.dy}:${placement.orient?.angle}`)
        .join('|');
      const key = [
        unit.kind,
        unit.itemCount,
        unit.raster.cols,
        unit.raster.rows,
        unit.sx,
        unit.sy,
        placementKey
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _selectMastersForItem(item, config, step) {
    const angles = this._getAllowedAngles(config);
    const singleUnits = [];

    for (const angle of angles) {
      const orient = this._getOrient(item, angle, step, config.spacing);
      const unit = this._buildUnitFromOrient(item, orient, step);
      if (unit) singleUnits.push(unit);
    }

    const staggeredUnits = [];
    const opt = new PairOptimizer({
      spacing: config.spacing,
      translationStep: config.gridStep <= 0.5 ? 0.5 : 1,
      rotationAngles: angles
    });
    const staggeredCandidates = opt.optimize(item.polygon, item.polygon, item.foot || 'X', item.foot || 'X').slice(0, 8);
    for (const candidate of staggeredCandidates) {
      const unit = this._buildStaggeredUnitFromResult(item, candidate, config, step);
      if (unit) staggeredUnits.push(unit);
    }

    const allUnits = this._dedupeUnits([...singleUnits, ...staggeredUnits]);
    if (!allUnits.length) return null;

    const rowCandidates = [...allUnits].sort((a, b) => {
      if (b.rowScore !== a.rowScore) return b.rowScore - a.rowScore;
      if (a.heightMm !== b.heightMm) return a.heightMm - b.heightMm;
      return b.totalScore - a.totalScore;
    });

    const compactCandidates = [...allUnits].sort((a, b) => {
      if (b.compactScore !== a.compactScore) return b.compactScore - a.compactScore;
      if (a.widthMm !== b.widthMm) return a.widthMm - b.widthMm;
      return b.totalScore - a.totalScore;
    });

    return {
      key: `${item.sizeName}__${item.foot || 'X'}`,
      sizeName: item.sizeName,
      foot: item.foot,
      rowMaster: rowCandidates[0],
      compactMaster: compactCandidates[0],
      rowCandidates,
      compactCandidates,
      singleUnits,
      staggeredUnits,
      allUnits
    };
  }

  _getMasterPriority(master) {
    const unit = master?.rowMaster;
    if (!unit) return 0;
    return (unit.totalArea * 0.0035) + (unit.compactScore || 0) * 4 + (unit.rowScore || 0) * 3 + unit.totalScore;
  }

  _selectCandidateUnit(master, availableCount, preferRow = false) {
    if (!master || availableCount <= 0) return null;
    const ordered = preferRow ? master.rowCandidates : master.compactCandidates;
    if (!Array.isArray(ordered)) return null;
    return ordered.find((unit) => unit.itemCount <= availableCount) || null;
  }

  _placeUnit(board, bCols, unit, queue, x, y, placed) {
    if (!unit || queue.length < unit.itemCount) return false;
    if (this._checkCollision(board, bCols, Number.MAX_SAFE_INTEGER, unit.raster, x, y)) return false;

    const consumed = queue.splice(0, unit.itemCount);
    const staggerGroup = unit.itemCount > 1 ? `${consumed[0]?.id || 'group'}__${x}_${y}` : null;
    this._mark(board, bCols, unit.raster, x, y, 1);
    for (let index = 0; index < unit.itemCount; index++) {
      const placement = unit.placements[index];
      placed.push({
        ...this._buildTempPlacement(consumed[index], placement.orient, x + placement.dx, y + placement.dy),
        staggerGroup
      });
    }
    return true;
  }

  _packRowsFast(board, bCols, bRows, groupedItems, mastersByKey, placed, config, step) {
    const keyOrder = [...groupedItems.keys()].sort((a, b) => {
      const sa = this._getMasterPriority(mastersByKey.get(a));
      const sb = this._getMasterPriority(mastersByKey.get(b));
      return sb - sa;
    });

    let y = 0;
    while (y < bRows) {
      let rowPlaced = false;
      let rowHeight = 0;
      let x = 0;

      while (x < bCols) {
        let placedHere = false;
        const widthLeft = bCols - x;

        for (const key of keyOrder) {
          const queue = groupedItems.get(key);
          if (!queue || !queue.length) continue;

          const masters = mastersByKey.get(key);
          const unit = this._selectCandidateUnit(masters, queue.length, x === 0);
          if (!unit) continue;

          const raster = unit.raster;
          if (raster.cols > widthLeft || y + raster.rows > bRows) continue;

          if (!this._checkCollision(board, bCols, bRows, raster, x, y)) {
            const didPlace = this._placeUnit(board, bCols, unit, queue, x, y, placed);
            if (!didPlace) continue;
            rowPlaced = true;
            rowHeight = Math.max(rowHeight, unit.sy);
            x += unit.sx;
            placedHere = true;
            break;
          }
        }

        if (!placedHere) x += 1;
      }

      if (!rowPlaced) y += 1;
      else y += rowHeight;

      const hasRemaining = keyOrder.some((key) => groupedItems.get(key)?.length > 0);
      if (!hasRemaining) break;
    }
  }

  _getFallbackUnits(master) {
    if (!master) return [];
    const candidates = this._dedupeUnits([
      ...(master.rowCandidates || []),
      ...(master.compactCandidates || []),
      ...(master.allUnits || [])
    ]);

    return candidates.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.heightMm - b.heightMm;
    });
  }

  _packFallbackGreedy(board, bCols, bRows, items, mastersByKey, config, step, placed) {
    const groupedItems = new Map();
    for (const item of items) {
      const key = `${item.sizeName}__${item.foot || 'X'}`;
      if (!groupedItems.has(key)) groupedItems.set(key, []);
      groupedItems.get(key).push(item);
    }

    const keyOrder = [...groupedItems.keys()].sort((a, b) => {
      const sa = this._getMasterPriority(mastersByKey.get(a));
      const sb = this._getMasterPriority(mastersByKey.get(b));
      return sb - sa;
    });

    const remaining = [];

    for (const key of keyOrder) {
      const queue = groupedItems.get(key) || [];
      const master = mastersByKey.get(key);

      while (queue.length) {
        const candidates = this._getFallbackUnits(master).filter((unit) => unit.itemCount <= queue.length);
        let bestPos = null;

        for (const unit of candidates) {
          const raster = unit.raster;
          if (raster.cols > bCols || raster.rows > bRows) continue;

          let found = false;
          for (let y = 0; y <= bRows - raster.rows; y++) {
            for (let x = 0; x <= bCols - raster.cols; x++) {
              if (!this._checkCollision(board, bCols, bRows, raster, x, y)) {
                bestPos = { unit, x, y };
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
        }

        if (bestPos) {
          this._placeUnit(board, bCols, bestPos.unit, queue, bestPos.x, bestPos.y, placed);
        } else {
          remaining.push(queue.shift());
        }
      }
    }

    return remaining;
  }

  _packOneSheet(items, config) {
    const step = config.gridStep || 1;
    const workWidth = config.sheetWidth - 2 * config.marginX;
    const workHeight = config.sheetHeight - 2 * config.marginY;
    const bCols = Math.ceil(workWidth / step);
    const bRows = Math.ceil(workHeight / step);
    const board = new Uint8Array(bCols * bRows);
    const tempPlaced = [];

    const groupedItems = new Map();
    for (const item of items) {
      const key = `${item.sizeName}__${item.foot || 'X'}`;
      if (!groupedItems.has(key)) groupedItems.set(key, []);
      groupedItems.get(key).push(item);
    }

    const mastersByKey = new Map();
    for (const [key, queue] of groupedItems.entries()) {
      if (!queue.length) continue;
      const master = this._selectMastersForItem(queue[0], config, step);
      if (master) mastersByKey.set(key, master);
    }

    this._packRowsFast(board, bCols, bRows, groupedItems, mastersByKey, tempPlaced, config, step);

    const tempPlacedIds = new Set(tempPlaced.map((placement) => placement.item.id));
    const afterRows = items.filter((item) => !tempPlacedIds.has(item.id));
    const remaining = this._packFallbackGreedy(
      board,
      bCols,
      bRows,
      afterRows,
      mastersByKey,
      config,
      step,
      tempPlaced
    );

    const hasStaggeredGroups = tempPlaced.some((placement) => placement.staggerGroup);
    const compactPlaced = hasStaggeredGroups
      ? tempPlaced
      : this._compactTempPlacements(tempPlaced, bCols, bRows);
    const placed = this._materializeTempPlacements(compactPlaced, config, step);

    return { placed, remaining };
  }

  _buildItems(sizeList, config) {
    const items = [];
    const usePreparedUnits = isPreparedDoubleContourMode(config);
    let idCounter = 0;

    for (const size of sizeList) {
      const qty = size.quantity || 0;
      const poly = size.polygon;
      const internals = size.internals || [];

      // Normalize Left
      const bbL = getBoundingBox(poly);
      const normPolyL = translate(poly, -bbL.minX, -bbL.minY);
      const normInternalsL = internals.map(path => translate(path, -bbL.minX, -bbL.minY));

      for (let i = 0; i < qty; i++) {
        if (usePreparedUnits) {
          items.push({
            id: `${size.sizeName}_DC_${idCounter}`,
            sizeName: size.sizeName,
            foot: 'X',
            polygon: normPolyL,
            internals: normInternalsL,
            pieceCount: 2
          });
        } else {
          // Right Foot flip
          const cx = bbL.minX + bbL.width / 2;
          const flippedPoly = flipXWithCenter(poly, cx);
          const flippedInternals = internals.map(path => flipXWithCenter(path, cx));
          const bbR = getBoundingBox(flippedPoly);
          const normPolyR = translate(flippedPoly, -bbR.minX, -bbR.minY);
          const normInternalsR = flippedInternals.map(path => translate(path, -bbR.minX, -bbR.minY));

          items.push(
            { 
              id: `${size.sizeName}_L_${idCounter}`, 
              sizeName: size.sizeName, 
              foot: 'L', 
              polygon: normPolyL, 
              internals: normInternalsL,
              pieceCount: 1 
            },
            { 
              id: `${size.sizeName}_R_${idCounter}`, 
              sizeName: size.sizeName, 
              foot: 'R', 
              polygon: normPolyR, 
              internals: normInternalsR,
              pieceCount: 1 
            }
          );
        }
        idCounter++;
      }
    }

    return items;
  }

  async nest(sizeList, overrideConfig = {}) {
    const config = { ...this.config, ...overrideConfig };
    this._orientCache.clear();
    const startedAt = Date.now();

    let items = this._buildItems(sizeList, config);
    const totalItems = items.reduce((sum, item) => sum + (item.pieceCount ?? 1), 0);

    const sheets = [];
    let sheetIndex = 0;
    const maxSheets = Number.isFinite(config.maxSheets) && config.maxSheets > 0
      ? config.maxSheets
      : Number.POSITIVE_INFINITY;

    while (items.length > 0 && sheetIndex < maxSheets) {
      const { placed, remaining: nextItems } = this._packOneSheet(items, config);
      if (!placed.length) break;

      const usedArea = placed.reduce((sum, item) => sum + polygonArea(item.polygon), 0);
      const placedPieceCount = placed.reduce((sum, item) => sum + (item.pieceCount ?? 1), 0);
      sheets.push({
        sheetIndex,
        placed,
        placedCount: placedPieceCount,
        efficiency: parseFloat(((usedArea / (config.sheetWidth * config.sheetHeight)) * 100).toFixed(1))
      });
      items = nextItems;
      sheetIndex++;
    }

    return {
      sheets,
      totalItems,
      placedCount: sheets.reduce((sum, s) => sum + (s.placedCount || 0), 0),
      timeMs: Date.now() - startedAt
    };
  }
}
