const SIZE_PALETTE = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#EC4899',
  '#14B8A6',
  '#A78BFA',
  '#FCD34D',
  '#6EE7B7',
  '#FCA5A5',
  '#93C5FD'
];

export const DEFAULT_DIECUT_DXF_LABEL_MODE = 'default';
export const PREPARED_SEQUENCE_DXF_LABEL_MODE = 'prepared-sequence';

function averagePolygonPoint(points) {
  if (!points?.length) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

export function boundingBoxCenter(points) {
  if (!points?.length) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function polygonArea(points = []) {
  if (!points.length) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function parseRelativeSvgPath(pathData) {
  if (!pathData || typeof pathData !== 'string') return null;
  const matches = [...pathData.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
  if (!matches.length) return null;
  return matches.map((match) => ({
    x: Number.parseFloat(match[1]),
    y: Number.parseFloat(match[2])
  }));
}

function translatePolygon(points, offsetX, offsetY) {
  return points.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY
  }));
}

function sanitizeLayerName(value, fallback = 'ITEM') {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || fallback;
}

function sanitizeExportFileName(value, fallback = 'diecut-layouts') {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim();

  const sanitized = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallback;
}

function sizeNameToColor(sizeName, sizeColorMap) {
  return sizeColorMap.get(sizeName) || '#9CA3AF';
}

function hexToRgb(color) {
  if (!color || typeof color !== 'string') return [156, 163, 175];
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (hex.length !== 6) return [156, 163, 175];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function rgbToTrueColor([r, g, b]) {
  return (r << 16) + (g << 8) + b;
}

function getDefaultItemLabel(item) {
  const foot = String(item?.foot || "").replace("split-", "");
  return `${item?.sizeName || ''}${foot}`;
}

function getFiniteSortValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getItemArea(item) {
  const explicitArea = Number(item?.areaMm2 ?? item?.area);
  if (Number.isFinite(explicitArea) && explicitArea > 0) return explicitArea;
  return polygonArea(item?.polygon || []);
}

function isSplitHalfItem(item) {
  return String(item?.foot || '').startsWith('split-') || String(item?.id || '').includes('split_fill');
}

function buildMaxAreaBySize(items = []) {
  const maxAreaBySize = new Map();
  for (const item of items) {
    const sizeName = String(item?.sizeName || '');
    const itemArea = getItemArea(item);
    if (!sizeName || itemArea <= 0) continue;
    maxAreaBySize.set(sizeName, Math.max(maxAreaBySize.get(sizeName) || 0, itemArea));
  }
  return maxAreaBySize;
}

function isPreparedSequenceSplitHalfItem(item, maxAreaBySize = new Map()) {
  if (isSplitHalfItem(item)) return true;

  const sizeName = String(item?.sizeName || '');
  const maxArea = maxAreaBySize.get(sizeName) || 0;
  const itemArea = getItemArea(item);
  if (!maxArea || !itemArea) return false;

  return itemArea / maxArea <= 0.82;
}

function buildPreparedSequenceKey(item, fallbackIndex) {
  if (item?.id) return String(item.id);

  const centroidX = getFiniteSortValue(item?.centroid?.x).toFixed(3);
  const centroidY = getFiniteSortValue(item?.centroid?.y).toFixed(3);
  const pointCount = Array.isArray(item?.polygon) ? item.polygon.length : 0;
  return `${centroidY}:${centroidX}:${pointCount}:${fallbackIndex}`;
}

function sortItemsLeftToRightTopToBottom(keyedItems) {
  const finalSortedKeyed = [];

  // Pre-sort all items by X descending to group them into horizontal rows of the screen (from top to bottom)
  const sortedByX = [...keyedItems].sort((a, b) => 
    getFiniteSortValue(b.item?.centroid?.x) - getFiniteSortValue(a.item?.centroid?.x)
  );

  const rows = [];
  const X_THRESHOLD = 120.0; // 120mm grouping threshold along the X-axis to group staggered rows

  for (const keyed of sortedByX) {
    if (rows.length === 0) {
      rows.push([keyed]);
    } else {
      const lastRow = rows[rows.length - 1];
      const avgX = lastRow.reduce((sum, k) => sum + getFiniteSortValue(k.item?.centroid?.x), 0) / lastRow.length;
      if (Math.abs(getFiniteSortValue(keyed.item?.centroid?.x) - avgX) < X_THRESHOLD) {
        lastRow.push(keyed);
      } else {
        rows.push([keyed]);
      }
    }
  }

  // For each row of the screen, sort by Y (even rows left-to-right, odd rows right-to-left)
  rows.forEach((row, rowIndex) => {
    const isOddRow = rowIndex % 2 === 1;
    const sortedRow = [...row].sort((a, b) => {
      const diffY = getFiniteSortValue(a.item?.centroid?.y) - getFiniteSortValue(b.item?.centroid?.y);
      return isOddRow ? -diffY : diffY;
    });
    finalSortedKeyed.push(...sortedRow);
  });

  return finalSortedKeyed;
}

function applyPreparedSequenceLabels(items = []) {
  // Gán key ban đầu cho toàn bộ chi tiết
  const keyedItems = items.map((item, index) => ({
    item,
    key: buildPreparedSequenceKey(item, index)
  }));

  // Sắp xếp thống nhất cho tất cả các chi tiết từ trái qua phải, từ trên xuống dưới
  const finalSortedKeyed = sortItemsLeftToRightTopToBottom(keyedItems);

  // Ánh xạ mỗi key duy nhất tới số thứ tự N tương ứng (bắt đầu từ 1)
  const sequenceByKey = new Map();
  finalSortedKeyed.forEach((keyed, index) => {
    sequenceByKey.set(keyed.key, index + 1);
  });

  return items.map((item, index) => {
    const key = buildPreparedSequenceKey(item, index);
    return {
      ...item,
      label: `N=${sequenceByKey.get(key) || 1}`
    };
  });
}


export function buildSizeColorMap(sizeList = []) {
  const colorMap = new Map();
  for (let index = 0; index < sizeList.length; index++) {
    const sizeName = sizeList[index]?.sizeName;
    if (!sizeName || colorMap.has(sizeName)) continue;
    colorMap.set(sizeName, SIZE_PALETTE[index % SIZE_PALETTE.length]);
  }
  return colorMap;
}

export function normalizeDieCutExportData(payload = {}) {
  const {
    sheets,
    sheetWidth,
    sheetHeight,
    sizeList = [],
    labelMode = DEFAULT_DIECUT_DXF_LABEL_MODE,
    title = 'Die-Cut Result',
    subtitle = ''
  } = payload;

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('Khong co sheet nao de xuat.');
  }

  const sizeColorMap = buildSizeColorMap(sizeList);

  const normalizedSheets = sheets.map((sheet, sheetIndex) => {
    const resolvedWidth = sheet?.sheetWidth || sheetWidth;
    const resolvedHeight = sheet?.sheetHeight || sheetHeight;
    if (!resolvedWidth || !resolvedHeight) {
      throw new Error('Thieu kich thuoc sheet cho du lieu die-cut.');
    }

    const resolvedWidthBeforeSwap = resolvedWidth;
    let finalWidth = resolvedWidth;
    let finalHeight = resolvedHeight;
    let shouldRotate = false;

    if (resolvedHeight > resolvedWidth) {
      finalWidth = resolvedHeight;
      finalHeight = resolvedWidth;
      shouldRotate = true;
    }

    const renderTemplates = sheet?.renderTemplates || {};
    const normalizedItems = (sheet?.placed || []).map((item, itemIndex) => {
      let polygon = Array.isArray(item?.polygon) ? item.polygon : null;
      if (!polygon?.length && item?.renderKey && renderTemplates[item.renderKey]?.path) {
        const relativePolygon = parseRelativeSvgPath(renderTemplates[item.renderKey].path);
        if (relativePolygon?.length) {
          polygon = translatePolygon(relativePolygon, item.x || 0, item.y || 0);
        }
      }
      if (!polygon?.length) {
        throw new Error(`Khong the tai tao polygon cho item ${item?.id || itemIndex}.`);
      }

      let finalPolygon = polygon;
      let finalCycPolygon = item?.cycPolygon;
      let finalInternals = item?.internals;
      let finalAngle = (360 - (item?.angle ?? 0)) % 360;
      finalAngle = (finalAngle + 90) % 360;
      let finalX = item?.x ?? 0;
      let finalY = item?.y ?? 0;

      if (shouldRotate) {
        const rotPoint = (p) => ({
          x: p.y,
          y: resolvedWidthBeforeSwap - p.x
        });

        finalPolygon = polygon.map(rotPoint);
        if (Array.isArray(finalCycPolygon)) {
          finalCycPolygon = finalCycPolygon.map(rotPoint);
        }
        if (Array.isArray(finalInternals)) {
          finalInternals = finalInternals.map(path => path.map(rotPoint));
        }

        finalX = item.y ?? 0;
        finalY = resolvedWidthBeforeSwap - (item.x ?? 0);
        finalAngle = (finalAngle - 90 + 360) % 360;
      }

      const centroid = boundingBoxCenter(finalCycPolygon || finalPolygon);
      const color = sizeNameToColor(item?.sizeName, sizeColorMap);
      return {
        ...item,
        polygon: finalPolygon,
        cycPolygon: finalCycPolygon,
        internals: finalInternals,
        centroid,
        color,
        angle: finalAngle,
        x: finalX,
        y: finalY,
        layerName: sanitizeLayerName(`SIZE_${item?.sizeName || 'UNK'}`),
        label: getDefaultItemLabel(item)
      };
    });

    const items = labelMode === PREPARED_SEQUENCE_DXF_LABEL_MODE
      ? applyPreparedSequenceLabels(normalizedItems)
      : normalizedItems;

    return {
      sheetIndex: sheet?.sheetIndex ?? sheetIndex,
      sheetWidth: finalWidth,
      sheetHeight: finalHeight,
      efficiency: sheet?.efficiency ?? null,
      placed: items
    };
  });

  return {
    title,
    subtitle,
    sheets: normalizedSheets
  };
}

export function getExportBaseName({ fileNameBase, sizeList, sheetWidth, sheetHeight, sheetIndex, sheetCount }) {
  const sizeStr = `${sheetWidth}x${sheetHeight}`;
  let baseName = fileNameBase ? String(fileNameBase).trim() : '';

  const sizeListForName = Array.isArray(sizeList) ? sizeList : [];
  const sizePart = sizeListForName
    .map((s) => s?.sizeName)
    .filter(Boolean)
    .slice(0, 3)
    .join('-');

  if (!baseName) {
    baseName = `nesting-diecut-${sizePart ? `${sizePart}-` : ''}${sizeStr}`;
    if (sheetCount === 1 && sheetIndex !== undefined) {
      baseName += `-sheet${sheetIndex + 1}`;
    } else if (sheetCount > 1) {
      baseName += `-${sheetCount}sheets`;
    }
  } else {
    if (sizePart && !baseName.toLowerCase().includes('size') && !baseName.includes(sizePart)) {
      baseName += `-${sizePart}`;
    }
    if (!baseName.includes(sizeStr)) {
      baseName += `-${sizeStr}`;
    }
    if (sheetCount === 1 && sheetIndex !== undefined && !baseName.toLowerCase().includes('sheet')) {
      baseName += `-sheet${sheetIndex + 1}`;
    } else if (sheetCount > 1 && !baseName.toLowerCase().includes('sheet')) {
      baseName += `-${sheetCount}sheets`;
    }
  }
  return baseName;
}

export {
  averagePolygonPoint,
  hexToRgb,
  isSplitHalfItem,
  rgbToTrueColor,
  sanitizeExportFileName,
  sanitizeLayerName
};
