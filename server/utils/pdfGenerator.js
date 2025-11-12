// server/utils/pdfGenerator.js

import PDFDocument from 'pdfkit';

/**
 * Vẽ kết quả sắp xếp lên một tài liệu PDF
 * @param {object} data - Dữ liệu chứa { container, placedRectangles }
 * @param {Stream} stream - Stream để ghi file PDF vào (ví dụ: res của Express)
 */
function generatePackingPdf(data, stream) {
  const { container, placedRectangles } = data;

  // Sử dụng khổ A4 ngang (landscape)
  // Kích thước A4 landscape: ~842 x 595 points
  const doc = new PDFDocument({ layout: 'landscape', size: 'A4' });

  // Ghi PDF vào stream (ví dụ: res.write)
  doc.pipe(stream);

  // === Tính toán Scaling (Co dãn) ===
  const pageHeight = doc.page.height;
  const pageWidth = doc.page.width;
  
  // Đặt lề
  const margin = 50; 
  
  // Khu vực có thể vẽ
  const drawWidth = pageWidth - (margin * 2);
  const drawHeight = pageHeight - (margin * 2);

  // Tính tỷ lệ co dãn
  // Chúng ta muốn toàn bộ container vừa vặn trong khu vực vẽ
  const scale = Math.min(
    drawWidth / container.width,
    drawHeight / container.length
  );

  // Gốc tọa độ (0,0) của container trên PDF (sẽ là lề trái, lề trên)
  const originX = margin;
  const originY = margin;

  // === Bắt đầu vẽ ===

  // 1. Vẽ Tấm chứa (Container)
  doc
    .rect(
      originX,
      originY,
      container.width * scale, // Scale chiều rộng
      container.length * scale // Scale chiều dài (length trong code của bạn là y-axis)
    )
    .lineWidth(2)
    .stroke('black');
    
  // Tiêu đề
  doc
    .fontSize(16)
    .fillColor('black')
    .text(
      `Kết quả sắp xếp - Tấm: ${container.width} x ${container.length}`, 
      margin, 
      margin - 30 // Đặt tiêu đề bên trên lề
    );

  // 2. Vẽ các hình chữ nhật (Rectangles) đã sắp xếp
  placedRectangles.forEach(rect => {
    if (!rect) return;

    // Tính toán tọa độ và kích thước trên PDF
    const pdfX = originX + (rect.x * scale);
    const pdfY = originY + (rect.y * scale);
    const pdfWidth = rect.width * scale;
    const pdfLength = rect.length * scale; // (length trong code của bạn là y-axis)

    // Lấy màu sắc từ client (nếu không có, dùng màu đen)
    const borderColor = rect.color || '#000000';

    // Vẽ hình chữ nhật
    doc
      .rect(pdfX, pdfY, pdfWidth, pdfLength)
      .lineWidth(1)
      .stroke(borderColor); // Dùng viền màu

    // Ghi ID (số size) vào giữa
    // Căn giữa tương đối
    const text = `${rect.id}`; // Hiển thị ID
    const textWidth = doc.widthOfString(text, { fontSize: 10 });
    
    // Chỉ hiển thị text nếu nó vừa
    if (textWidth < pdfWidth - 4 && 10 < pdfLength - 4) {
      doc
        .fontSize(10)
        .fillColor('black')
        .text(
          text,
          pdfX + (pdfWidth - textWidth) / 2, // Căn giữa theo chiều X
          pdfY + (pdfLength - 10) / 2,       // Căn giữa theo chiều Y
          {
            width: pdfWidth,
            align: 'center'
          }
        );
    }
  });

  // Hoàn tất file PDF
  doc.end();
}

export { generatePackingPdf };