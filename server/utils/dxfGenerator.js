/**
 * server/utils/dxfGenerator.js
 * Generate AutoCAD-friendly ASCII DXF files.
 *
 * The previous writer emitted a very minimal hybrid DXF that some viewers
 * accepted but AutoCAD often rejected. This writer intentionally targets the
 * older DXF R12-style entity model (POLYLINE / VERTEX / TEXT) plus explicit
 * LAYER and STYLE tables because that format is broadly compatible.
 */

const STANDARD_COLORS = [
  { rgb: [0, 0, 0], aci: 7 },
  { rgb: [255, 255, 255], aci: 7 },
  { rgb: [255, 0, 0], aci: 1 },
  { rgb: [255, 255, 0], aci: 2 },
  { rgb: [0, 255, 0], aci: 3 },
  { rgb: [0, 255, 255], aci: 4 },
  { rgb: [0, 0, 255], aci: 5 },
  { rgb: [255, 0, 255], aci: 6 },
  { rgb: [128, 128, 128], aci: 8 },
  { rgb: [192, 192, 192], aci: 9 },
  { rgb: [255, 127, 0], aci: 30 },
  { rgb: [127, 255, 0], aci: 70 },
  { rgb: [0, 255, 127], aci: 130 },
  { rgb: [0, 127, 255], aci: 150 },
  { rgb: [127, 0, 255], aci: 170 },
  { rgb: [255, 0, 127], aci: 210 },
  { rgb: [165, 42, 42], aci: 14 }
];

function getDistance(rgb1, rgb2) {
  return Math.sqrt(
    Math.pow(rgb1[0] - rgb2[0], 2) +
    Math.pow(rgb1[1] - rgb2[1], 2) +
    Math.pow(rgb1[2] - rgb2[2], 2)
  );
}

function parseColorStr(colorStr) {
  if (!colorStr) return [255, 255, 255];

  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16)
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }
  }

  if (colorStr.startsWith('rgb')) {
    const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
  }

  return [255, 255, 255];
}

function rgbToAci(rgb) {
  let closestProximity = Infinity;
  let closestAci = 7;

  STANDARD_COLORS.forEach((item) => {
    const dist = getDistance(rgb, item.rgb);
    if (dist < closestProximity) {
      closestProximity = dist;
      closestAci = item.aci;
    }
  });
  return closestAci;
}

function rgbToTrueColor(rgb) {
  return (rgb[0] << 16) + (rgb[1] << 8) + rgb[2];
}

function clampAci(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 7;
  return Math.max(1, Math.min(255, Math.round(numeric)));
}

function formatDxfNumber(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const safeValue = Object.is(numeric, -0) ? 0 : numeric;
  const text = safeValue.toFixed(4).replace(/\.?0+$/, '');
  return text.includes('.') ? text : `${text}.0`;
}

function sanitizeTextValue(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEmptyExtents() {
  return {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0
  };
}

export class DxfWriter {
  constructor() {
    this.entityLines = [];
    this.layers = new Map([['0', 7]]);
    this.extents = null;
  }

  push(lines, code, value) {
    lines.push(String(code));
    lines.push(String(value));
  }

  registerLayer(layer = '0', aciColor = 7) {
    const layerName = String(layer || '0');
    const resolvedColor = clampAci(aciColor);
    if (!this.layers.has(layerName) || (this.layers.get(layerName) === 7 && resolvedColor !== 7)) {
      this.layers.set(layerName, resolvedColor);
    }
    return layerName;
  }

  trackPoint(x, y) {
    const pointX = Number.isFinite(Number(x)) ? Number(x) : 0;
    const pointY = Number.isFinite(Number(y)) ? Number(y) : 0;
    if (!this.extents) {
      this.extents = {
        minX: pointX,
        minY: pointY,
        maxX: pointX,
        maxY: pointY
      };
      return;
    }

    this.extents.minX = Math.min(this.extents.minX, pointX);
    this.extents.minY = Math.min(this.extents.minY, pointY);
    this.extents.maxX = Math.max(this.extents.maxX, pointX);
    this.extents.maxY = Math.max(this.extents.maxY, pointY);
  }

  addPolyline(points, aciColor = 7, _trueColor = null, layer = '0') {
    if (!Array.isArray(points) || points.length < 2) return;

    const layerName = this.registerLayer(layer, aciColor);
    const entityColor = clampAci(aciColor);

    points.forEach((point) => this.trackPoint(point.x, point.y));

    this.push(this.entityLines, 0, 'POLYLINE');
    this.push(this.entityLines, 8, layerName);
    this.push(this.entityLines, 6, 'CONTINUOUS');
    this.push(this.entityLines, 62, entityColor);
    this.push(this.entityLines, 66, 1);
    this.push(this.entityLines, 70, 1);
    this.push(this.entityLines, 10, 0.0);
    this.push(this.entityLines, 20, 0.0);
    this.push(this.entityLines, 30, 0.0);

    points.forEach((point) => {
      this.push(this.entityLines, 0, 'VERTEX');
      this.push(this.entityLines, 8, layerName);
      this.push(this.entityLines, 6, 'CONTINUOUS');
      this.push(this.entityLines, 62, entityColor);
      this.push(this.entityLines, 10, formatDxfNumber(point.x));
      this.push(this.entityLines, 20, formatDxfNumber(point.y));
      this.push(this.entityLines, 30, 0.0);
    });

    this.push(this.entityLines, 0, 'SEQEND');
  }

  addText(text, x, y, height, aciColor = 7, layer = 'TEXT', rotation = 0) {
    const content = sanitizeTextValue(text);
    if (!content) return;

    const layerName = this.registerLayer(layer, aciColor);
    const textX = Number.isFinite(Number(x)) ? Number(x) : 0;
    const textY = Number.isFinite(Number(y)) ? Number(y) : 0;
    const textHeight = Math.max(0.1, Number.isFinite(Number(height)) ? Number(height) : 1);

    this.trackPoint(textX, textY);
    this.trackPoint(textX, textY + textHeight);

    this.push(this.entityLines, 0, 'TEXT');
    this.push(this.entityLines, 8, layerName);
    this.push(this.entityLines, 62, clampAci(aciColor));
    this.push(this.entityLines, 10, formatDxfNumber(textX));
    this.push(this.entityLines, 20, formatDxfNumber(textY));
    this.push(this.entityLines, 30, 0.0);
    this.push(this.entityLines, 11, formatDxfNumber(textX));
    this.push(this.entityLines, 21, formatDxfNumber(textY));
    this.push(this.entityLines, 31, 0.0);
    this.push(this.entityLines, 40, formatDxfNumber(textHeight));
    this.push(this.entityLines, 1, content);
    this.push(this.entityLines, 7, 'STANDARD');
    if (rotation) {
      this.push(this.entityLines, 50, formatDxfNumber(rotation));
    }
    this.push(this.entityLines, 72, 0);
    this.push(this.entityLines, 73, 0);
  }

  writeHeader(lines) {
    const extents = this.extents || getEmptyExtents();

    this.push(lines, 0, 'SECTION');
    this.push(lines, 2, 'HEADER');
    this.push(lines, 9, '$ACADVER');
    this.push(lines, 1, 'AC1009');
    this.push(lines, 9, '$DWGCODEPAGE');
    this.push(lines, 3, 'ANSI_1252');
    this.push(lines, 9, '$INSBASE');
    this.push(lines, 10, 0.0);
    this.push(lines, 20, 0.0);
    this.push(lines, 30, 0.0);
    this.push(lines, 9, '$EXTMIN');
    this.push(lines, 10, formatDxfNumber(extents.minX));
    this.push(lines, 20, formatDxfNumber(extents.minY));
    this.push(lines, 30, 0.0);
    this.push(lines, 9, '$EXTMAX');
    this.push(lines, 10, formatDxfNumber(extents.maxX));
    this.push(lines, 20, formatDxfNumber(extents.maxY));
    this.push(lines, 30, 0.0);
    this.push(lines, 9, '$LIMMIN');
    this.push(lines, 10, 0.0);
    this.push(lines, 20, 0.0);
    this.push(lines, 9, '$LIMMAX');
    this.push(lines, 10, 12.0);
    this.push(lines, 20, 9.0);
    this.push(lines, 9, '$TEXTSTYLE');
    this.push(lines, 7, 'STANDARD');
    this.push(lines, 0, 'ENDSEC');
  }

  writeTables(lines) {
    const orderedLayers = [...this.layers.entries()].sort(([left], [right]) => {
      if (left === '0') return -1;
      if (right === '0') return 1;
      return left.localeCompare(right);
    });

    this.push(lines, 0, 'SECTION');
    this.push(lines, 2, 'TABLES');

    this.push(lines, 0, 'TABLE');
    this.push(lines, 2, 'LTYPE');
    this.push(lines, 70, 1);
    this.push(lines, 0, 'LTYPE');
    this.push(lines, 2, 'CONTINUOUS');
    this.push(lines, 70, 0);
    this.push(lines, 3, 'Solid line');
    this.push(lines, 72, 65);
    this.push(lines, 73, 0);
    this.push(lines, 40, 0.0);
    this.push(lines, 0, 'ENDTAB');

    this.push(lines, 0, 'TABLE');
    this.push(lines, 2, 'LAYER');
    this.push(lines, 70, orderedLayers.length);
    orderedLayers.forEach(([layerName, layerColor]) => {
      this.push(lines, 0, 'LAYER');
      this.push(lines, 2, layerName);
      this.push(lines, 70, 0);
      this.push(lines, 62, clampAci(layerColor));
      this.push(lines, 6, 'CONTINUOUS');
    });
    this.push(lines, 0, 'ENDTAB');

    this.push(lines, 0, 'TABLE');
    this.push(lines, 2, 'STYLE');
    this.push(lines, 70, 1);
    this.push(lines, 0, 'STYLE');
    this.push(lines, 2, 'STANDARD');
    this.push(lines, 70, 0);
    this.push(lines, 40, 0.0);
    this.push(lines, 41, 1.0);
    this.push(lines, 50, 0.0);
    this.push(lines, 71, 0);
    this.push(lines, 42, 0.2);
    this.push(lines, 3, 'txt');
    this.push(lines, 4, '');
    this.push(lines, 0, 'ENDTAB');

    this.push(lines, 0, 'ENDSEC');
  }

  writeBlocks(lines) {
    this.push(lines, 0, 'SECTION');
    this.push(lines, 2, 'BLOCKS');
    this.push(lines, 0, 'ENDSEC');
  }

  writeEntities(lines) {
    this.push(lines, 0, 'SECTION');
    this.push(lines, 2, 'ENTITIES');
    lines.push(...this.entityLines);
    this.push(lines, 0, 'ENDSEC');
  }

  endFile() {
    const lines = [];
    this.writeHeader(lines);
    this.writeTables(lines);
    this.writeBlocks(lines);
    this.writeEntities(lines);
    this.push(lines, 0, 'EOF');
    return lines.join('\r\n') + '\r\n';
  }
}

/**
 * Generate DXF content from packing data.
 */
export function generateDxf(data) {
  const { container, allLayouts } = data;
  const writer = new DxfWriter();

  const SHEET_GAP = 200;

  function removeAccents(str) {
    if (!str) return '';
    return str.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/\u0110/g, 'D');
  }

  function getClosestAci(r, g, b) {
    const standards = [
      { i: 1, r: 255, g: 0, b: 0 },
      { i: 2, r: 255, g: 255, b: 0 },
      { i: 3, r: 0, g: 255, b: 0 },
      { i: 4, r: 0, g: 255, b: 255 },
      { i: 5, r: 0, g: 0, b: 255 },
      { i: 6, r: 255, g: 0, b: 255 },
      { i: 7, r: 255, g: 255, b: 255 },
      { i: 8, r: 128, g: 128, b: 128 },
      { i: 9, r: 192, g: 192, b: 192 }
    ];

    let bestIdx = 7;
    let minDist = Infinity;

    for (const color of standards) {
      const dist = (color.r - r) ** 2 + (color.g - g) ** 2 + (color.b - b) ** 2;
      if (dist < minDist) {
        minDist = dist;
        bestIdx = color.i;
      }
    }

    if (minDist < 100) return bestIdx;

    const extras = [
      { i: 10, r: 255, g: 0, b: 0 },
      { i: 11, r: 255, g: 127, b: 127 },
      { i: 30, r: 255, g: 127, b: 0 },
      { i: 40, r: 255, g: 191, b: 0 },
      { i: 50, r: 255, g: 255, b: 0 },
      { i: 51, r: 255, g: 255, b: 127 },
      { i: 70, r: 127, g: 255, b: 0 },
      { i: 90, r: 0, g: 255, b: 0 },
      { i: 91, r: 127, g: 255, b: 127 },
      { i: 130, r: 0, g: 255, b: 255 },
      { i: 131, r: 127, g: 255, b: 255 },
      { i: 150, r: 0, g: 0, b: 255 },
      { i: 151, r: 127, g: 127, b: 255 },
      { i: 210, r: 255, g: 0, b: 127 },
      { i: 211, r: 255, g: 127, b: 191 },
      { i: 250, r: 51, g: 51, b: 51 },
      { i: 251, r: 80, g: 80, b: 80 },
      { i: 252, r: 105, g: 105, b: 105 },
      { i: 253, r: 130, g: 130, b: 130 },
      { i: 254, r: 190, g: 190, b: 190 }
    ];

    for (const color of extras) {
      const dist = (color.r - r) ** 2 + (color.g - g) ** 2 + (color.b - b) ** 2;
      if (dist < minDist) {
        minDist = dist;
        bestIdx = color.i;
      }
    }

    return bestIdx;
  }

  function stringToColor(str) {
    if (!str) return '#CCCCCC';
    let hash = 0;
    for (let index = 0; index < str.length; index++) {
      hash = str.charCodeAt(index) + ((hash << 5) - hash);
    }
    const color = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return `#${'00000'.substring(0, 6 - color.length)}${color}`;
  }

  allLayouts.forEach((layout, index) => {
    const offsetX = index * (container.length + SHEET_GAP);
    const offsetY = 0;

    const borderPoints = [
      { x: offsetX, y: offsetY },
      { x: offsetX + container.length, y: offsetY },
      { x: offsetX + container.length, y: offsetY + container.width },
      { x: offsetX, y: offsetY + container.width }
    ];
    writer.addPolyline(borderPoints, 7, null, 'BORDER');

    const layerCount = layout.layers ? layout.layers.length : 1;
    const sheetLabel = removeAccents(`Sheet ${index + 1} - ${layout.description || ''} - ${layerCount} lop`);
    writer.addText(sheetLabel, offsetX, offsetY - 20, 10, 7, 'TEXT');

    const placedRectangles = layout.layers
      ? layout.layers.flatMap((layer) => layer.rectangles.filter(Boolean))
      : [];

    placedRectangles.forEach((rect) => {
      const rectX = offsetX + rect.y;
      const rectY = offsetY + rect.x;

      const rW = rect.length;
      const rH = rect.width;

      const points = [
        { x: rectX, y: rectY },
        { x: rectX + rW, y: rectY },
        { x: rectX + rW, y: rectY + rH },
        { x: rectX, y: rectY + rH }
      ];

      let colorToUse = rect.color;
      if (!colorToUse || colorToUse === '#000000' || colorToUse === '#ffffff') {
        colorToUse = stringToColor(rect.name);
      }

      const rgb = parseColorStr(colorToUse);
      const aci = getClosestAci(rgb[0], rgb[1], rgb[2]);
      const trueColor = rgbToTrueColor(rgb);

      let layerName = removeAccents(rect.name || 'Unknown');
      layerName = layerName.replace(/[^a-zA-Z0-9_\-]/g, '_');
      if (!layerName) layerName = 'Items';

      if (index === 0 && placedRectangles.length < 5) {
        console.log(`[DXF DEBUG] Rect: ${rect.width}x${rect.length}, Name: "${rect.name}", Layer: ${layerName}, FinalColor: "${colorToUse}", ACI: ${aci}, TrueColor: ${trueColor}`);
      }

      writer.addPolyline(points, aci, trueColor, layerName);

      const textSize = Math.min(Math.min(rW, rH) * 0.15, 20);
      const useRotatedText = rH > rW * 1.5;

      const centerX = rectX + rW / 2;
      const centerY = rectY + rH / 2;
      const label = `${rect.width}x${rect.length}`;

      const estimatedTextWidth = 0.6 * textSize * label.length;

      let textX = centerX - (estimatedTextWidth / 2);
      let textY = centerY - (textSize / 2);
      let rotation = 0;

      if (useRotatedText) {
        rotation = 90;
        textX = centerX + (textSize / 2);
        textY = centerY - (estimatedTextWidth / 2);
      }

      writer.addText(label, textX, textY, textSize, 7, 'TEXT_LABELS', rotation);
    });
  });

  return writer.endFile();
}

export { rgbToAci, rgbToTrueColor };
