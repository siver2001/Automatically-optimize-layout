import { getBoundingBox, polygonsOverlap } from '../../core/polygonUtils.js';

export function roundMetric(value, decimals = 2) {
  return Number.parseFloat(value.toFixed(decimals));
}

export function quantizeToStep(value, step) {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function buildShiftCandidates(rangeMm, step, maxSamples = 25) {
  const limit = Math.max(0, quantizeToStep(rangeMm, step));
  if (limit <= 0) return [0];

  const totalSteps = Math.floor(limit / step);
  const values = [];

  if (totalSteps * 2 + 1 <= maxSamples) {
    for (let unit = -totalSteps; unit <= totalSteps; unit++) {
      values.push(unit * step);
    }
  } else {
    const slots = Math.max(3, maxSamples);
    for (let i = 0; i < slots; i++) {
      const t = slots === 1 ? 0 : i / (slots - 1);
      const value = -limit + t * limit * 2;
      values.push(quantizeToStep(value, step));
    }
    values.push(0);
  }

  return [...new Set(values)]
    .sort((a, b) => {
      const absDiff = Math.abs(a) - Math.abs(b);
      if (absDiff !== 0) return absDiff;
      return a - b;
    });
}

export function findMinimalQuantizedValue(minMm, maxMm, step, isSafe) {
  const minUnits = Math.ceil(minMm / step);
  const maxUnits = Math.floor(maxMm / step);
  if (minUnits > maxUnits) return null;

  if (!isSafe(maxUnits * step)) return null;

  let low = minUnits;
  let high = maxUnits;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (isSafe(mid * step)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low * step;
}

export function getOrientBounds(orient) {
  if (orient.bb) return orient.bb;
  return getBoundingBox(orient.polygon);
}

export function computeEnvelope(placements) {
  if (!placements.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placement of placements) {
    const bb = getOrientBounds(placement.orient);
    minX = Math.min(minX, placement.x + bb.minX);
    minY = Math.min(minY, placement.y + bb.minY);
    maxX = Math.max(maxX, placement.x + bb.maxX);
    maxY = Math.max(maxY, placement.y + bb.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function rebasePlacements(placements, padding = 0) {
  const bounds = computeEnvelope(placements);
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;

  return {
    bounds,
    workWidth: Math.max(0, bounds.width + padding * 2),
    workHeight: Math.max(0, bounds.height + padding * 2),
    placements: placements.map((placement) => ({
      ...placement,
      x: placement.x + offsetX,
      y: placement.y + offsetY
    }))
  };
}

export function validatePatternPlacements(placements, workWidth, workHeight, spacing) {
  if (!placements.length) {
    return {
      valid: false,
      reason: 'empty-layout',
      bounds: computeEnvelope(placements)
    };
  }

  const indexed = placements.map((placement, index) => {
    const bb = getOrientBounds(placement.orient);
    return {
      ...placement,
      index,
      bb: {
        minX: placement.x + bb.minX,
        minY: placement.y + bb.minY,
        maxX: placement.x + bb.maxX,
        maxY: placement.y + bb.maxY,
        width: bb.width,
        height: bb.height
      }
    };
  });

  for (const item of indexed) {
    if (
      item.bb.minX < -1e-6 ||
      item.bb.minY < -1e-6 ||
      item.bb.maxX > workWidth + 1e-6 ||
      item.bb.maxY > workHeight + 1e-6
    ) {
      return {
        valid: false,
        reason: 'out-of-bounds',
        bounds: computeEnvelope(indexed)
      };
    }
  }

  const avgSpan = indexed.reduce((sum, item) => sum + Math.max(item.bb.width, item.bb.height), 0) / indexed.length;
  const cellSize = Math.max(10, avgSpan + spacing);
  const buckets = new Map();
  const compared = new Set();

  for (const item of indexed) {
    const minCellX = Math.floor(item.bb.minX / cellSize);
    const maxCellX = Math.floor(item.bb.maxX / cellSize);
    const minCellY = Math.floor(item.bb.minY / cellSize);
    const maxCellY = Math.floor(item.bb.maxY / cellSize);

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const key = `${cx}:${cy}`;
        const existing = buckets.get(key) || [];
        for (const other of existing) {
          const pairKey = item.index > other.index
            ? `${other.index}:${item.index}`
            : `${item.index}:${other.index}`;
          if (compared.has(pairKey)) continue;
          compared.add(pairKey);

          if (
            polygonsOverlap(
              item.orient.polygon,
              other.orient.polygon,
              { x: item.x, y: item.y },
              { x: other.x, y: other.y },
              spacing,
              getOrientBounds(item.orient),
              getOrientBounds(other.orient)
            )
          ) {
            return {
              valid: false,
              reason: 'overlap',
              bounds: computeEnvelope(indexed),
              pair: [other.id, item.id]
            };
          }
        }
        existing.push(item);
        buckets.set(key, existing);
      }
    }
  }

  return {
    valid: true,
    bounds: computeEnvelope(indexed)
  };
}

export function validateLocalPlacements(placements, spacing, padding = 10) {
  const rebased = rebasePlacements(placements, padding);
  return validatePatternPlacements(rebased.placements, rebased.workWidth, rebased.workHeight, spacing);
}

export function comparePatternCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.envelopeWasteMm2 !== bestCandidate.envelopeWasteMm2) {
    return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  const nextShift = Math.abs(nextCandidate.rowShiftXmm) + Math.abs(nextCandidate.colShiftYmm);
  const bestShift = Math.abs(bestCandidate.rowShiftXmm) + Math.abs(bestCandidate.colShiftYmm);
  if (nextShift !== bestShift) {
    return nextShift - bestShift;
  }
  if (nextCandidate.topBandUsed !== bestCandidate.topBandUsed) {
    return nextCandidate.topBandUsed ? -1 : 1;
  }
  return 0;
}

export function compareComplementaryCandidates(nextCandidate, bestCandidate) {
  if (!bestCandidate) return -1;
  if (nextCandidate.placedCount !== bestCandidate.placedCount) {
    return bestCandidate.placedCount - nextCandidate.placedCount;
  }
  if (nextCandidate.envelopeWasteMm2 !== bestCandidate.envelopeWasteMm2) {
    return nextCandidate.envelopeWasteMm2 - bestCandidate.envelopeWasteMm2;
  }
  if (nextCandidate.usedHeightMm !== bestCandidate.usedHeightMm) {
    return nextCandidate.usedHeightMm - bestCandidate.usedHeightMm;
  }
  if (nextCandidate.patternFamily !== bestCandidate.patternFamily) {
    if (nextCandidate.patternFamily === 'checkerboard') return -1;
    if (bestCandidate.patternFamily === 'checkerboard') return 1;
  }
  if (nextCandidate.topBandUsed !== bestCandidate.topBandUsed) {
    return nextCandidate.topBandUsed ? -1 : 1;
  }
  return 0;
}
