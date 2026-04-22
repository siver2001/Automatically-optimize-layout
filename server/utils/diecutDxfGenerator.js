import { DxfWriter, rgbToAci } from './dxfGenerator.js';
import {
  hexToRgb,
  normalizeDieCutExportData,
  rgbToTrueColor,
  sanitizeLayerName
} from './diecutExportUtils.js';

const SHEET_GAP = 200;

function addBorder(writer, width, height, offsetX) {
  writer.addPolyline([
    { x: offsetX, y: 0 },
    { x: offsetX + width, y: 0 },
    { x: offsetX + width, y: height },
    { x: offsetX, y: height }
  ], 7, null, 'BORDER');
}

export function generateDieCutDxf(payload) {
  const exportData = normalizeDieCutExportData(payload);
  const writer = new DxfWriter();

  exportData.sheets.forEach((sheet, sheetIndex) => {
    const offsetX = sheetIndex * (sheet.sheetWidth + SHEET_GAP);
    addBorder(writer, sheet.sheetWidth, sheet.sheetHeight, offsetX);

    writer.addText(
      `${exportData.title} - Sheet ${sheetIndex + 1}`,
      offsetX,
      -20,
      10,
      7,
      'TEXT'
    );

    sheet.placed.forEach((item) => {
      const rgb = hexToRgb(item.color);
      const aciColor = rgbToAci(rgb);
      const trueColor = rgbToTrueColor(rgb);
      const shiftedPolygon = item.polygon.map((point) => ({
        x: point.x + offsetX,
        y: point.y
      }));

      writer.addPolyline(
        shiftedPolygon,
        aciColor,
        trueColor,
        sanitizeLayerName(item.layerName, 'SIZE')
      );

      if (item.label) {
        writer.addText(
          item.label,
          item.centroid.x + offsetX,
          item.centroid.y,
          6,
          7,
          'TEXT_LABELS'
        );
      }
    });
  });

  return writer.endFile();
}
