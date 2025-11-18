import React, { useState } from 'react';
import ExcelJS from 'exceljs'; // <-- Đã thay đổi
import { usePacking } from '../context/PackingContext.js';

// Hàm tiện ích tạo màu ngẫu nhiên (Giữ nguyên)
const generateRandomColor = () => {
  const randomHue = Math.floor(Math.random() * 360);
  return `hsl(${randomHue}, 70%, 60%)`;
};

// Hàm tìm tiêu đề (Phiên bản cho ExcelJS)
const findHeaderLocation = (worksheet) => {
  const headerKeywords = ['size', 'chiều dài', 'chiều rộng', 'số lượng'];
  
  // ExcelJS row và cell được đánh số từ 1
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    // Tối đa số cột có thể kiểm tra
    const maxCol = row.cellCount > 3 ? row.cellCount - 3 : row.cellCount; 

    for (let c = 1; c <= maxCol; c++) {
      const cell1 = (row.getCell(c).value || '').toString().toLowerCase().trim();
      const cell2 = (row.getCell(c + 1).value || '').toString().toLowerCase().trim();
      const cell3 = (row.getCell(c + 2).value || '').toString().toLowerCase().trim();
      const cell4 = (row.getCell(c + 3).value || '').toString().toLowerCase().trim();
      
      if (cell1.includes(headerKeywords[0]) &&
          cell2.includes(headerKeywords[1]) &&
          cell3.includes(headerKeywords[2]) &&
          cell4.includes(headerKeywords[3])) 
      {
        // Đã tìm thấy! Trả về chỉ số (1-based)
        return { headerRowIndex: r, dataColStart: c };
      }
    }
  }
  return null; // Không tìm thấy
};

// Hàm tiện ích để lấy giá trị thực từ cell (ExcelJS có thể trả về object)
const parseCell = (cellValue) => {
  if (cellValue && typeof cellValue === 'object') {
    if (cellValue.result) return cellValue.result; // Từ công thức
    if (cellValue.text) return cellValue.text; // Từ rich text
  }
  return cellValue; // Giá trị nguyên thủy
};


const ExcelUploader = () => {
  const { addRectanglesFromExcel } = usePacking();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleFileChange = (e) => {
    setLoading(true);
    setMessage('');
    const file = e.target.files[0];
    if (!file) {
      setLoading(false);
      return;
    }

    const reader = new FileReader();

    // Sửa reader.onload để thành hàm async
    reader.onload = async (event) => {
      try {
        const data = event.target.result; // Đây là một ArrayBuffer
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(data); // <-- Dùng API của ExcelJS

        let parsedData = [];
        let sheetFound = false;

        // Duyệt qua tất cả các sheet
        for (const worksheet of workbook.worksheets) {
          const location = findHeaderLocation(worksheet);
          
          if (location) {
            sheetFound = true;
            const { headerRowIndex, dataColStart } = location;

            // Lặp từ hàng ngay sau header (chỉ số 1-based)
            for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
              const row = worksheet.getRow(r);
              
              // Lấy giá trị cell bằng API của ExcelJS
              const name = row.getCell(dataColStart).value;
              const length = row.getCell(dataColStart + 1).value;
              const width = row.getCell(dataColStart + 2).value;
              const quantity = row.getCell(dataColStart + 3).value;

              // Parse giá trị (vì có thể là object)
              const pName = parseCell(name);
              const pLength = parseCell(length);
              const pWidth = parseCell(width);
              const pQuantity = parseCell(quantity);

              // Yêu cầu: "Hàng nào có cả 4 dữ liệu"
              if (pName != null && pLength != null && pWidth != null && pQuantity != null) {
                const rectName = String(pName).trim();
                const rectLength = parseFloat(pLength);
                const rectWidth = parseFloat(pWidth);
                const rectQuantity = parseInt(pQuantity, 10);

                // Kiểm tra dữ liệu sau khi chuyển đổi
                if (rectName && 
                    !isNaN(rectLength) && rectLength > 0 &&
                    !isNaN(rectWidth) && rectWidth > 0 &&
                    !isNaN(rectQuantity) && rectQuantity >= 0) // Chấp nhận số lượng 0
                {
                  parsedData.push({
                    rect: {
                      name: rectName,
                      length: rectLength,
                      width: rectWidth,
                      color: generateRandomColor()
                    },
                    quantity: rectQuantity
                  });
                }
              }
            }
            break; // Đã tìm thấy và xử lý sheet, thoát khỏi vòng lặp
          }
        }

        // Phần logic hiển thị message giữ nguyên
        if (parsedData.length > 0) {
          addRectanglesFromExcel(parsedData);
          setMessage(`✅ Đã thêm thành công ${parsedData.length} size.`);
        } else if (sheetFound) {
          setMessage('⚠️ Đã tìm thấy sheet, nhưng không có hàng nào có đủ 4 cột dữ liệu hợp lệ.');
        } else {
          setMessage('❌ Không tìm thấy sheet nào có 4 cột "Size", "Chiều Dài", "Chiều Rộng", "Số Lượng Cần".');
        }

      } catch (err) {
        console.error(err);
        setMessage(`❌ Lỗi khi đọc file: ${err.message}`);
      }
      setLoading(false);
      // Reset input để có thể tải lại cùng 1 file
      e.target.value = null; 
    };
    
    // Đọc file thành ArrayBuffer (ExcelJS cần cái này)
    reader.readAsArrayBuffer(file);
  };

  // Phần JSX render giữ nguyên
  return (
    <div className="my-4 p-4 border rounded-lg bg-gray-50">
      <label 
        htmlFor="excel-upload" 
        className={`
          cursor-pointer px-4 py-2 bg-green-600 text-white 
          font-semibold rounded-lg shadow-md
          hover:bg-green-700 transition duration-200
          ${loading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {loading ? 'Đang xử lý...' : '📤 Tải lên Excel'}
      </label>
      <input
        id="excel-upload"
        type="file"
        className="hidden"
        accept=".xlsx, .xls, .csv"
        onChange={handleFileChange}
        disabled={loading}
      />
      {message && (
        <p className="mt-2 text-sm text-gray-700">{message}</p>
      )}
    </div>
  );
};

export default ExcelUploader;