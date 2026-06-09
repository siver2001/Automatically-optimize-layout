import {
  isSplitHalfItem,
  normalizeDieCutExportData
} from './diecutExportUtils.js';

function formatCycNumber(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return numeric.toFixed(3);
}

function normalizeAngle(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const normalized = ((numeric % 360) + 360) % 360;
  return Math.abs(normalized - 360) < 1e-6 ? 0 : normalized;
}

function parsePreparedSequenceLabel(label) {
  const match = String(label || '').match(/\bN=(\d+)\b/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Calculate bounding box center of a polygon.
 * This matches how the factory CYC files define X,Y positions.
 */
function boundingBoxCenter(points) {
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

function resolveCycPolygon(item) {
  if (isSplitHalfItem(item) && !Array.isArray(item?.cycPolygon)) {
    throw new Error(
      `Thieu bien dang CYC goc cho mieng tach nua size ${item?.sizeName || 'UNK'}. ` +
      'Khong xuat CYC de tranh may dap sai.'
    );
  }

  return item?.cycPolygon || item?.polygon;
}

/**
 * Resolve tool code for a given item from the user-provided toolCodeMap.
 */
function resolveToolCode(item, toolCodeMap = {}) {
  const sizeName = String(item?.sizeName || '');
  const numericKey = sizeName.replace(/[^0-9.]/g, '');
  const toolCode = toolCodeMap[sizeName] || toolCodeMap[numericKey];
  const parsed = Number.parseInt(toolCode, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function generateDieCutCyc(payload = {}) {
  const toolCodeMap = payload.toolCodeMap || {};

  if (!Object.keys(toolCodeMap).length) {
    throw new Error('Chua co thong tin ma dao T. Hay nhap so T cho tung size truoc khi xuat CYC.');
  }

  // Force 'prepared-sequence' labelMode for CYC export to sync with DXF Luxin mode
  const modifiedPayload = {
    ...payload,
    labelMode: 'prepared-sequence'
  };

  const exportData = normalizeDieCutExportData(modifiedPayload);

  if (exportData.sheets.length !== 1) {
    throw new Error('File CYC chi xuat 1 tam moi lan.');
  }

  const [sheet] = exportData.sheets;
  
  const validPlaced = (sheet.placed || []).filter((item) => {
    const toolCode = resolveToolCode(item, toolCodeMap);
    return toolCode !== null;
  });

  if (validPlaced.length === 0) {
    throw new Error('Khong co chi tiet nao tren tam co ma dao T. Vui long cau hinh ma dao T truoc khi xuat.');
  }

  const cycles = validPlaced.map((item, index) => {
    const toolCode = resolveToolCode(item, toolCodeMap);
    const center = boundingBoxCenter(resolveCycPolygon(item));

    return {
      toolCode,
      x: center.x,
      y: sheet.sheetHeight - center.y, // Invert Y to match the DXF
      angle: normalizeAngle(item?.angle),
      splitRank: isSplitHalfItem(item) ? 1 : 0,
      preparedSequenceNumber: parsePreparedSequenceLabel(item?.label),
      sequenceNumber: index + 1
    };
  });

  // Group cycles by toolCode and assign N per-group so the machine
  // processes each tool's items with their own sequential numbering.
  const sortedCycles = [...cycles].sort((a, b) => {
    if (a.toolCode !== b.toolCode) return a.toolCode - b.toolCode;
    if (a.preparedSequenceNumber != null && b.preparedSequenceNumber != null) {
      return a.preparedSequenceNumber - b.preparedSequenceNumber;
    }
    if (a.splitRank !== b.splitRank) return a.splitRank - b.splitRank;
    return a.sequenceNumber - b.sequenceNumber;
  });

  const toolSequenceCounters = new Map();
  for (const cycle of sortedCycles) {
    const count = (toolSequenceCounters.get(cycle.toolCode) || 0) + 1;
    toolSequenceCounters.set(cycle.toolCode, count);
    cycle.groupSequence = cycle.preparedSequenceNumber ?? count;
  }

  const lines = ['<CycleFile>'];
  for (const cycle of sortedCycles) {
    lines.push('<Cycle Name="DXFData">');
    lines.push(`\t<Field Name="T" Value="${cycle.toolCode}"/>`);
    lines.push(`\t<Field Name="X" Value="${formatCycNumber(cycle.x)}"/>`);
    lines.push(`\t<Field Name="Y" Value="${formatCycNumber(cycle.y)}"/>`);
    lines.push(`\t<Field Name="C" Value="${formatCycNumber(cycle.angle)}"/>`);
    lines.push(`\t<Field Name="N" Value="${cycle.groupSequence}"/>`);
    lines.push('</Cycle>');
  }
  lines.push('</CycleFile>');

  return lines.join('\r\n');
}
