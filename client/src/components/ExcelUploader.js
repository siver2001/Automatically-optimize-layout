import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { usePacking } from '../context/PackingContext.js'; // Đường dẫn có thể cần sửa

// Hàm tiện ích tạo màu ngẫu nhiên
const generateRandomColor = () => {
  const randomHue = Math.floor(Math.random() * 360);
  return `hsl(${randomHue}, 70%, 60%)`;
};

// Hàm tìm tiêu đề
// Nó sẽ tìm 4 cột BẤT KỲ nằm cạnh nhau có chứa các từ khóa
const findHeaderLocation = (jsonSheet) => {
  const headerKeywords = ['size', 'chiều dài', 'chiều rộng', 'số lượng'];
  
  for (let r = 0; r < jsonSheet.length; r++) {
    const row = jsonSheet[r];
    for (let c = 0; c < row.length - 3; c++) {
      const cell1 = (row[c] || '').toString().toLowerCase().trim();
      const cell2 = (row[c+1] || '').toString().toLowerCase().trim();
      const cell3 = (row[c+2] || '').toString().toLowerCase().trim();
      const cell4 = (row[c+3] || '').toString().toLowerCase().trim();
      
      if (cell1.includes(headerKeywords[0]) &&
          cell2.includes(headerKeywords[1]) &&
          cell3.includes(headerKeywords[2]) &&
          cell4.includes(headerKeywords[3])) 
      {
        // Đã tìm thấy!
        return { headerRowIndex: r, dataColStart: c };
      }
    }
  }
  return null; // Không tìm thấy
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
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        let parsedData = [];
        let sheetFound = false;

        // Duyệt qua tất cả các sheet
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          // Chuyển sheet thành mảng (để dễ tìm header)
          const jsonSheet = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const location = findHeaderLocation(jsonSheet);
          
          if (location) {
            sheetFound = true;
            const { headerRowIndex, dataColStart } = location;

            // Lặp từ hàng ngay sau header
            for (let r = headerRowIndex + 1; r < jsonSheet.length; r++) {
              const row = jsonSheet[r];
              
              const name = row[dataColStart];
              const length = row[dataColStart + 1];
              const width = row[dataColStart + 2];
              const quantity = row[dataColStart + 3];

              // Yêu cầu: "Hàng nào có cả 4 dữ liệu"
              if (name != null && length != null && width != null && quantity != null) {
                const rectName = String(name).trim();
                const rectLength = parseFloat(length);
                const rectWidth = parseFloat(width);
                const rectQuantity = parseInt(quantity, 10);

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
    reader.readAsArrayBuffer(file);
  };

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