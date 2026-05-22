import { DxfWriter, rgbToAci } from './dxfGenerator.js';
import {
  hexToRgb,
  isSplitHalfItem,
  normalizeDieCutExportData,
  rgbToTrueColor,
  sanitizeLayerName
} from './diecutExportUtils.js';

const SHEET_GAP = 200;

function parsePreparedSequenceLabel(label) {
  const match = String(label || '').match(/\bN=(\d+)\b/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

function addBorder(writer, width, height, offsetX) {
  writer.addPolyline([
    { x: offsetX, y: 0 },
    { x: offsetX + width, y: 0 },
    { x: offsetX + width, y: height },
    { x: offsetX, y: height }
  ], 7, null, 'BORDER');
}

export function generateDieCutDxf(payload) {
  const isLuxin = payload?.isLuxin !== false; // Mặc định bật định dạng Luxin cho die-cut
  const labelMode = isLuxin ? 'prepared-sequence' : (payload?.labelMode || 'default');

  const modifiedPayload = {
    ...payload,
    labelMode
  };

  const exportData = normalizeDieCutExportData(modifiedPayload);
  const writer = new DxfWriter({ isLuxin });
  const usePreparedSequenceLabels = labelMode === 'prepared-sequence';

  exportData.sheets.forEach((sheet, sheetIndex) => {
    const offsetX = sheetIndex * (sheet.sheetWidth + SHEET_GAP);
    addBorder(writer, sheet.sheetWidth, sheet.sheetHeight, offsetX);

    if (!isLuxin) {
      writer.addText(
        `${exportData.title} - Sheet ${sheetIndex + 1}`,
        offsetX,
        -20,
        10,
        7,
        'TEXT'
      );
    }

    // Lọc và sắp xếp các chi tiết theo đúng thứ tự sắp xếp của tệp CYC để đồng bộ hoàn toàn
    let placementsToExport = sheet.placed || [];
    if (isLuxin) {
      placementsToExport = placementsToExport.filter((item) => {
        const toolCode = resolveToolCode(item, payload?.toolCodeMap || {});
        return toolCode !== null;
      });
    }

    const validPlacedWithIdx = placementsToExport.map((item, index) => ({
      item,
      index: index + 1
    }));

    validPlacedWithIdx.sort((a, b) => {
      const aTool = resolveToolCode(a.item, payload?.toolCodeMap || {});
      const bTool = resolveToolCode(b.item, payload?.toolCodeMap || {});
      
      const aToolCode = aTool !== null ? aTool : 999999;
      const bToolCode = bTool !== null ? bTool : 999999;
      
      if (aToolCode !== bToolCode) return aToolCode - bToolCode;
      
      const aSeq = parsePreparedSequenceLabel(a.item.label);
      const bSeq = parsePreparedSequenceLabel(b.item.label);
      
      if (aSeq !== null && bSeq !== null) {
        return aSeq - bSeq;
      }
      
      const aSplit = isSplitHalfItem(a.item) ? 1 : 0;
      const bSplit = isSplitHalfItem(b.item) ? 1 : 0;
      if (aSplit !== bSplit) return aSplit - bSplit;
      
      return a.index - b.index;
    });

    const sortedPlaced = validPlacedWithIdx.map(x => x.item);

    sortedPlaced.forEach((item) => {
      const rgb = hexToRgb(item.color);
      const aciColor = rgbToAci(rgb);
      const trueColor = rgbToTrueColor(rgb);
      const shiftedPolygon = item.polygon.map((point) => ({
        x: point.x + offsetX,
        y: point.y
      }));

      if (item.label) {
        writer.addText(
          item.label,
          item.centroid.x + offsetX,
          item.centroid.y,
          usePreparedSequenceLabels ? 5 : 6,
          7,
          isLuxin ? '1' : 'TEXT_LABELS'
        );
      }

      writer.addPolyline(
        shiftedPolygon,
        aciColor,
        trueColor,
        isLuxin ? '1' : sanitizeLayerName(item.layerName, 'SIZE')
      );

      // Thêm các đường line nội bộ (đường giữa, v.v.)
      if (Array.isArray(item.internals)) {
        item.internals.forEach(path => {
          const shiftedPath = path.map(p => ({
            x: p.x + offsetX,
            y: p.y
          }));
          writer.addPolyline(
            shiftedPath,
            aciColor,
            trueColor,
            isLuxin ? '1' : sanitizeLayerName(item.layerName + '_INTERNAL', 'INTERNAL'),
            false
          );
        });
      }
    });
  });

  return writer.endFile();
}
