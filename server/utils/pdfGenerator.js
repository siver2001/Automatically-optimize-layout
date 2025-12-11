// server/utils/pdfGenerator.js
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Chuyển màu HEX/HSL sang RGB
 */
function parseColor(colorStr) {
  if (!colorStr) return [52, 152, 219];
  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }
  if (colorStr.startsWith('hsl')) {
    const match = colorStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const [, h, s, l] = match.map(Number);
      const hue = h / 360;
      const sat = s / 100;
      const light = l / 100;
      let r, g, b;
      if (sat === 0) {
        r = g = b = light;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
        const p = 2 * light - q;
        r = hue2rgb(p, q, hue + 1 / 3);
        g = hue2rgb(p, q, hue);
        b = hue2rgb(p, q, hue - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
  }
  return [52, 152, 219];
}

/**
 * Vẽ text xoay 90 độ (cho size nằm dọc)
 */
function drawRotatedText(doc, text, x, y, width, height, color) {

  doc.save();
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  doc.translate(centerX, centerY);
  doc.rotate(90);
  const fontSize = Math.max(8, Math.min(12, height / 12));
  doc.fontSize(fontSize).font('Helvetica-Bold');
  const textWidth = doc.widthOfString(text);
  const textHeight = fontSize * 1.2;
  doc
    .fillOpacity(0.85)
    .fillColor('white')
    .rect(
      -textWidth / 2 - 2,
      -textHeight / 2 - 1,
      textWidth + 4,
      textHeight + 2
    )
    .fill();
  doc
    .fillOpacity(1)
    .fillColor(color)
    .text(text, -textWidth / 2, -textHeight / 2);
  doc.restore();
}

/**
 * Vẽ 1 layout lên trang 'doc' hiện tại
 */
function drawSinglePageLayout(doc, layoutData, pageInfo) {
  const { container, placedRectangles, plateInfo = {} } = layoutData;
  const { currentPage, totalPages } = pageInfo;

  // === Layout ===

  const pageHeight = doc.page.height;
  const pageWidth = doc.page.width;
  const margin = 50;
  const headerHeight = 80;
  const drawWidth = pageWidth - (margin * 2);
  const drawHeight = pageHeight - (margin * 2) - headerHeight;
  const scale = Math.min(
    drawWidth / container.length,
    drawHeight / container.width
  );
  const containerWidth = container.length * scale;
  const containerHeight = container.width * scale;
  const originX = margin + (drawWidth - containerWidth) / 2;
  const originY = margin + headerHeight + (drawHeight - containerHeight) / 2;

  // === HEADER ===

  // Lay title (co the co dau)
  let title = (plateInfo.description && plateInfo.description.trim() !== '')
    ? plateInfo.description.toUpperCase()
    : 'KET QUA SAP TAM LIEU';

  if (plateInfo.layerCount) {
    title += ` - ${plateInfo.layerCount} LOP`;
  }
  // Bo dau cua title truoc khi in
  title = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');

  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .fillColor('#2c3e50')
    .text(title, margin, 20, { align: 'center' }); // 'title' bay gio da khong co dau


  const pageText = `Tam: ${currentPage} / ${totalPages}`; // 'Tam' thay vi 'Tấm'

  doc
    .fontSize(12)
    .font('Helvetica')
    .fillColor('#34495e')
    .text(

      `Kich thuoc: ${container.width}mm x ${container.length}mm | ` + // 'Kich thuoc'
      `${pageText} | ` +
      `So hinh: ${placedRectangles.length}`, // 'So hinh'
      margin, 45,
      { align: 'center' }
    );

  if (plateInfo.efficiency) {
    doc
      .fontSize(11)
      .fillColor('#27ae60')
      .text(

        `Hieu suat: ${plateInfo.efficiency.toFixed(1)}%`, // 'Hieu suat'
        margin, 62,
        { align: 'center' }
      );
  }

  // === VIỀN CONTAINER ===

  doc
    .rect(originX, originY, containerWidth, containerHeight)
    .lineWidth(2)
    .strokeColor('#2c3e50')
    .stroke();

  // === GRID ===

  const gridSize = 50;
  const gridSpacing = gridSize * scale;
  doc.lineWidth(0.3).strokeColor('#bdc3c7').opacity(0.5);
  for (let x = gridSpacing; x < containerWidth; x += gridSpacing) {
    doc.moveTo(originX + x, originY)
      .lineTo(originX + x, originY + containerHeight)
      .stroke();
  }
  for (let y = gridSpacing; y < containerHeight; y += gridSpacing) {
    doc.moveTo(originX, originY + y)
      .lineTo(originX + containerWidth, originY + y)
      .stroke();
  }
  doc.opacity(1);

  const rectsByLayer = {};
  placedRectangles.forEach(rect => {
    const layer = rect.layer ?? 0;
    if (!rectsByLayer[layer]) rectsByLayer[layer] = [];
    rectsByLayer[layer].push(rect);
  });
  const layers = Object.keys(rectsByLayer).sort((a, b) => Number(a) - Number(b));

  layers.forEach((layerKey, layerIndex) => {
    const layerRects = rectsByLayer[layerKey];
    const layerOpacity = 1 - (layerIndex * 0.15);

    layerRects.forEach(rect => {

      const pdfX = originX + (rect.y * scale);
      const pdfY = originY + (rect.x * scale);
      const pdfWidth = rect.length * scale;
      const pdfHeight = rect.width * scale;

      const [r, g, b] = parseColor(rect.color);
      doc
        .rect(pdfX, pdfY, pdfWidth, pdfHeight)
        .fillOpacity(layerOpacity * 0.3)
        .fillColor([r, g, b])
        .fill();
      doc
        .rect(pdfX, pdfY, pdfWidth, pdfHeight)
        .lineWidth(1.5)
        .strokeOpacity(layerOpacity)
        .strokeColor([r, g, b])
        .stroke();

      const sizeText = `${rect.width}x${rect.length}`; // Khong co dau
      const isVertical = pdfHeight > pdfWidth * 1.5;

      if (isVertical) {
        drawRotatedText(doc, sizeText, pdfX, pdfY, pdfWidth, pdfHeight, [r, g, b]);
      } else {
        const fontSize = Math.max(8, Math.min(12, pdfWidth / 12));
        doc.fontSize(fontSize).font('Helvetica-Bold');
        const textWidth = doc.widthOfString(sizeText);
        const textHeight = fontSize * 1.2;

        if (textWidth < pdfWidth - 4 && textHeight < pdfHeight - 4) {
          doc
            .fillOpacity(0.85)
            .fillColor('white')
            .rect(
              pdfX + (pdfWidth - textWidth) / 2 - 2,
              pdfY + (pdfHeight - textHeight) / 2 - 1,
              textWidth + 4,
              textHeight + 2
            )
            .fill();
          doc
            .fillOpacity(1)
            .fillColor([r, g, b])
            .text(
              sizeText,
              pdfX,
              pdfY + (pdfHeight - textHeight) / 2,
              { width: pdfWidth, align: 'center' }
            );
        }
      }
    });
  });


  // === FOOTER ===
  if (currentPage === totalPages) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    doc
      .fontSize(8)
      .font('Helvetica') // Giu nguyen font
      .fillColor('#95a5a6')
      .text(

        `Xuat luc: ${dateStr} | Optimize Size Layout`, // 'Xuat luc'
        margin,
        pageHeight - 40,
        { align: 'center' }
      );
  }
}

/**
 * ✅ Tạo file PDF có nhiều trang (slides)
 */
function generateMultiPagePackingPdf(data, stream) {
  const { container, allLayouts } = data;
  const totalPages = allLayouts.length;

  if (totalPages === 0) {

    throw new Error("Khong co layout nao de xuat PDF."); // 'Khong', 'de xuat'
  }

  const doc = new PDFDocument({
    layout: 'landscape',
    size: 'A4',
    autoFirstPage: false
  });

  doc.pipe(stream);

  allLayouts.forEach((layout, index) => {
    const currentPage = index + 1;

    doc.addPage({
      layout: 'landscape',
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 }
    });

    const placedRectangles = layout.layers
      ? layout.layers.flatMap(layer => layer.rectangles.filter(Boolean))
      : [];

    const singleLayoutData = {
      container: container,
      placedRectangles: placedRectangles,
      plateInfo: {
        efficiency: layout.efficiency,
        description: layout.description,
        layerCount: layout.layers ? layout.layers.length : 1
      }
    };

    const pageInfo = {
      currentPage: currentPage,
      totalPages: totalPages
    };

    // Ham 'drawSinglePageLayout' se tu dong bo dau khi ve
    drawSinglePageLayout(doc, singleLayoutData, pageInfo);
  });

  doc.end();
}

export { generateMultiPagePackingPdf };