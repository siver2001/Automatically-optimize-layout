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

    const renderTemplates = sheet?.renderTemplates || {};
    const items = (sheet?.placed || []).map((item, itemIndex) => {
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

      const centroid = averagePolygonPoint(polygon);
      const color = sizeNameToColor(item?.sizeName, sizeColorMap);
      return {
        ...item,
        polygon,
        centroid,
        color,
        layerName: sanitizeLayerName(`SIZE_${item?.sizeName || 'UNK'}`),
        label: `${item?.sizeName || ''}${item?.foot || ''}`
      };
    });

    return {
      sheetIndex: sheet?.sheetIndex ?? sheetIndex,
      sheetWidth: resolvedWidth,
      sheetHeight: resolvedHeight,
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

export {
  averagePolygonPoint,
  hexToRgb,
  rgbToTrueColor,
  sanitizeExportFileName,
  sanitizeLayerName
};
