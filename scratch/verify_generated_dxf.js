import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

// Dữ liệu mock để xuất die-cut
const mockPayload = {
  title: 'Test Luxin Nesting',
  sheetWidth: 1000,
  sheetHeight: 800,
  labelMode: 'prepared-sequence',
  toolCodeMap: {
    '10.5': '3',
    '11': '4'
  },
  sizeList: [
    { sizeName: '10.5' },
    { sizeName: '11' }
  ],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1000,
      sheetHeight: 800,
      placed: [
        {
          id: 'item1',
          sizeName: '10.5',
          foot: 'L',
          x: 100,
          y: 100,
          angle: 45,
          polygon: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 50 },
            { x: 10, y: 50 }
          ],
          internals: [
            [
              { x: 30, y: 25 },
              { x: 70, y: 25 }
            ]
          ]
        },
        {
          id: 'item2',
          sizeName: '11',
          foot: 'R',
          x: 300,
          y: 200,
          angle: 90,
          polygon: [
            { x: 20, y: 20 },
            { x: 80, y: 20 },
            { x: 80, y: 70 },
            { x: 20, y: 70 }
          ]
        }
      ]
    }
  ]
};

console.log('--- BẮT ĐẦU KIỂM TRA ĐỊNH DẠNG DXF & CYC CHO MÁY LUXIN ---');

try {
  // 1. Kiểm tra xuất DXF
  const dxfContent = generateDieCutDxf(mockPayload);
  const lines = dxfContent.split(/\r?\n/).filter(line => line.length > 0);

  console.log(`\n[DXF] Tổng số dòng: ${lines.length}`);
  
  // Kiểm tra header tối giản
  const hasTables = dxfContent.includes('TABLES');
  const hasBlocks = dxfContent.includes('BLOCKS');
  const hasHeader = dxfContent.includes('HEADER');
  
  if (hasHeader) {
    console.log('✔ [DXF] Có section HEADER.');
  } else {
    throw new Error('✘ [DXF] Lỗi: Thiếu section HEADER.');
  }

  if (!hasTables && !hasBlocks) {
    console.log('✔ [DXF] Không có section TABLES và BLOCKS (Đạt yêu cầu máy Luxin).');
  } else {
    throw new Error('✘ [DXF] Lỗi: Tìm thấy TABLES hoặc BLOCKS.');
  }

  // Kiểm tra khoảng trắng lùi dòng của mã nhóm
  let correctSpacing = true;
  let layerCheckPassed = true;
  let textLabelsCount = 0;
  let sheetTitleExist = false;

  for (let i = 0; i < lines.length; i += 2) {
    const codeLine = lines[i];
    const valLine = lines[i + 1];
    
    if (!valLine) break;

    // Check spacing
    const rawCode = codeLine.trim();
    const codeNum = Number(rawCode);
    if (!isNaN(codeNum) && codeNum < 100) {
      if (codeNum < 10) {
        if (!codeLine.startsWith('  ')) {
          correctSpacing = false;
          console.log(`  ⚠ Spacing sai ở dòng ${i + 1}: "${codeLine}" -> "${valLine}"`);
        }
      } else {
        if (!codeLine.startsWith(' ')) {
          correctSpacing = false;
          console.log(`  ⚠ Spacing sai ở dòng ${i + 1}: "${codeLine}" -> "${valLine}"`);
        }
      }
    }

    // Check layer name (mọi thực thể phải có layer "1")
    if (rawCode === '8') {
      if (valLine !== '1') {
        layerCheckPassed = false;
        console.log(`  ⚠ Layer sai ở dòng ${i + 2}: "${valLine}" (cần phải là "1")`);
      }
    }

    // Check label text
    if (rawCode === '1' && valLine.startsWith('N=')) {
      textLabelsCount++;
    }

    // Check if sheet title exists in texts
    if (rawCode === '1' && valLine.includes('Test Luxin Nesting')) {
      sheetTitleExist = true;
    }
  }

  if (correctSpacing) {
    console.log('✔ [DXF] Căn lề mã nhóm (spacing) hoàn toàn chính xác (2 khoảng trắng cho <10, 1 khoảng trắng cho <100).');
  } else {
    throw new Error('✘ [DXF] Lỗi: Căn lề mã nhóm không đạt chuẩn Luxin.');
  }

  if (layerCheckPassed) {
    console.log('✔ [DXF] Tất cả các chi tiết đều nằm trên LAYER "1" (Đạt yêu cầu máy Luxin).');
  } else {
    throw new Error('✘ [DXF] Lỗi: Có chi tiết không nằm trên LAYER "1".');
  }

  if (textLabelsCount === 2) {
    console.log('✔ [DXF] Đã xuất chính xác 2 nhãn tuần tự dạng "N=1", "N=2".');
  } else {
    throw new Error(`✘ [DXF] Lỗi: Số lượng nhãn N=x không khớp (tìm thấy ${textLabelsCount}).`);
  }

  if (!sheetTitleExist) {
    console.log('✔ [DXF] Không có tiêu đề Sheet Title dư thừa (Đạt yêu cầu máy Luxin).');
  } else {
    throw new Error('✘ [DXF] Lỗi: Xuất hiện tiêu đề Sheet Title dư thừa.');
  }

  // 2. Kiểm tra xuất CYC
  const cycContent = generateDieCutCyc(mockPayload);
  console.log('\n[CYC] Nội dung tệp CYC:');
  console.log(cycContent);

  const containsT3 = cycContent.includes('Value="3"');
  const containsT4 = cycContent.includes('Value="4"');
  const containsN1 = cycContent.includes('Name="N" Value="1"');
  const containsN2 = cycContent.includes('Name="N" Value="2"');

  if (containsT3 && containsT4 && containsN1 && containsN2) {
    console.log('✔ [CYC] Tệp CYC chứa đầy đủ mã dao T và nhãn N đồng bộ hoàn toàn với nhãn N của tệp DXF!');
  } else {
    throw new Error('✘ [CYC] Lỗi: Tệp CYC không đồng bộ hoặc thiếu thông tin.');
  }

  console.log('\n======================================================');
  console.log('✔ CHÚC MỪNG! TẤT CẢ KIỂM TRA ĐỀU ĐẠT CHUẨN LUXIN CNC VỚI ĐỘ CHÍNH XÁC 100%!');
  console.log('======================================================');
  process.exit(0);

} catch (error) {
  console.error('\n❌ KIỂM TRA THẤT BẠI!');
  console.error(error.message);
  process.exit(1);
}
