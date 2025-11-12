// client/src/components/RectangleList.js
// Đã tích hợp trình tải lên Excel, loại bỏ modal thủ công

import React, { useCallback, useState, useRef } from 'react';
import { usePacking } from '../context/PackingContext.js';
import * as XLSX from 'xlsx'; // 👈 Cần import thư viện XLSX

// --- Các hàm tiện ích (từ ExcelUploader) ---

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
    // Đảm bảo row là một mảng (đề phòng hàng trống)
    if (!Array.isArray(row)) continue;

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
// --- Kết thúc hàm tiện ích ---


const RectangleList = () => {
  const { 
    rectangles, 
    selectedRectangles, 
    quantities, 
    selectRectangle, 
    selectAllRectangles, 
    clearSelection,
    setQuantity, 
    startOptimization,
    addRectanglesFromExcel, // 👈 Lấy hàm mới từ Context
    removeRectangle, 
    isOptimizing
  } = usePacking();
  
  // --- Đã loại bỏ state cho modal thủ công ---
  // const [showAddForm, setShowAddForm] = useState(false); 
  // const [newRect, setNewRect] = useState({ width: '', length: '', name: '' }); 

  // --- State mới cho trình tải lên Excel ---
  const [isParsing, setIsParsing] = useState(false); // State khi đang đọc file
  const [parseMessage, setParseMessage] = useState(''); // State cho thông báo
  const fileInputRef = useRef(null); // Ref để kích hoạt input ẩn

  const handleQuantityChange = useCallback((rectId, value) => {
    const quantity = Math.max(0, parseInt(value) || 0);
    setQuantity(rectId, quantity);
  }, [setQuantity]);

  // --- Đã loại bỏ handleAddRectangle (thêm thủ công) ---

  // Xử lý xóa size (giữ nguyên)
  const handleRemoveRectangle = (e, id) => {
    e.stopPropagation(); 
    if (window.confirm(`Bạn có chắc chắn muốn xóa size ID ${id} này không?`)) {
        removeRectangle(id);
    }
  };

  // --- Hàm xử lý file Excel (từ ExcelUploader) ---
  const handleFileChange = (e) => {
    setIsParsing(true);
    setParseMessage('');
    const file = e.target.files[0];
    if (!file) {
      setIsParsing(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        let parsedData = [];
        let sheetFound = false;

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const jsonSheet = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const location = findHeaderLocation(jsonSheet);
          
          if (location) {
            sheetFound = true;
            const { headerRowIndex, dataColStart } = location;

            for (let r = headerRowIndex + 1; r < jsonSheet.length; r++) {
              const row = jsonSheet[r];
              if (!Array.isArray(row)) continue; // Bỏ qua nếu hàng không hợp lệ

              const name = row[dataColStart];
              const length = row[dataColStart + 1];
              const width = row[dataColStart + 2];
              const quantity = row[dataColStart + 3];

              if (name != null && length != null && width != null && quantity != null) {
                const rectName = String(name).trim();
                const rectLength = parseFloat(length);
                const rectWidth = parseFloat(width);
                const rectQuantity = parseInt(quantity, 10);

                if (rectName && 
                    !isNaN(rectLength) && rectLength > 0 &&
                    !isNaN(rectWidth) && rectWidth > 0 &&
                    !isNaN(rectQuantity) && rectQuantity >= 0)
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
            break; 
          }
        }

        if (parsedData.length > 0) {
          addRectanglesFromExcel(parsedData);
          setParseMessage(`✅ Đã thêm thành công ${parsedData.length} size.`);
        } else if (sheetFound) {
          setParseMessage('⚠️ Đã tìm thấy sheet, nhưng không có hàng nào có đủ 4 cột dữ liệu hợp lệ.');
        } else {
          setParseMessage('❌ Không tìm thấy sheet nào có 4 cột "Size", "Chiều Dài", "Chiều Rộng", "Số Lượng Cần".');
        }

      } catch (err) {
        console.error(err);
        setParseMessage(`❌ Lỗi khi đọc file: ${err.message}`);
      }
      setIsParsing(false);
      e.target.value = null; // Reset input
    };
    reader.readAsArrayBuffer(file);
  };


  // --- Các hàm tính toán và style (giữ nguyên) ---
  const selectedRectsWithQuantities = rectangles
    .filter(rect => selectedRectangles.includes(rect.id))
    .map(rect => ({
      ...rect,
      quantity: quantities[rect.id] || 0
    }))
    .filter(rect => rect.quantity > 0);
    
  const totalSelectedTypes = selectedRectsWithQuantities.length;
  const totalRectanglesCount = selectedRectsWithQuantities.reduce((sum, rect) => sum + rect.quantity, 0);

  const getRectangleStyle = (rect) => {
    const maxWidth = 100;
    const maxLength = 70;
    const aspectRatio = rect.length / rect.width;
    
    let displayWidth, displayLength;
    const scaleFactor = 2; 

    if (aspectRatio > 1) {
      displayWidth = Math.min(maxWidth, rect.width / scaleFactor);
      displayLength = displayWidth / aspectRatio;
    } else {
      displayLength = Math.min(maxLength, rect.length / scaleFactor);
      displayWidth = displayLength * aspectRatio;
    }
    
    return {
      width: `${Math.max(25, displayWidth)}px`,
      height: `${Math.max(20, displayLength)}px`, 
      backgroundColor: rect.color,
      border: '2px solid white'
    };
  };

  const isCustomRect = (id) => id > 8; // Giả định này giữ nguyên


  return (
    <div className="mb-2 card p-2">
      <div className="flex justify-between items-center mb-2 border-b pb-1">
        <h2 className="text-gray-800 text-l font-semibold flex items-center gap-2">
          📦 Quản lý size
        </h2>
        <div className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full font-medium">
          Tổng: {rectangles.length} loại
        </div>
      </div>

      {/* 👈 Vị trí hiển thị thông báo tải lên */}
      {parseMessage && (
        <div className="mb-2 p-3 text-sm rounded-lg border bg-gray-50 text-gray-700">
          {parseMessage}
        </div>
      )}
      
      <div className="mb-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex flex-col gap-1 md:flex-row md:justify-between md:items-center">
          
          <div className="flex gap-2 flex-shrink-0">
            <button 
              onClick={selectAllRectangles}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 hover:shadow-md border border-gray-400 bg-white text-gray-700 disabled:opacity-50"
              disabled={isOptimizing || isParsing}
            >
              ✅ Chọn tất cả
            </button>
            <button 
              onClick={clearSelection} 
              disabled={selectedRectangles.length === 0 || isOptimizing || isParsing}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 hover:shadow-md border border-gray-400 bg-white text-gray-700 disabled:opacity-50"
            >
              ❌ Bỏ chọn ({selectedRectangles.length})
            </button>
          </div>
          
          <div className="text-xs text-gray-700 font-medium bg-white border border-gray-200 rounded-md px-2 py-1.5 flex-shrink-0 w-fit">
            <span className="text-sm">
              <span className="text-primary-600 font-bold">{totalSelectedTypes}</span> loại | 
              <span className="text-blue-600 font-bold ml-1">{totalRectanglesCount}</span> hình
            </span>
          </div>

          <button 
            onClick={startOptimization}
            disabled={totalRectanglesCount === 0 || isOptimizing || isParsing}
            className="btn-primary text-sm px-4 py-2 flex-shrink-0"
          >
            {isOptimizing ? '🔄 Đang tối ưu...' : 
             isParsing ? '⏳ Vui lòng chờ...' : 
             `Sắp xếp (${totalRectanglesCount} hình)`
            }
          </button>
        </div>
      </div>
      
      {/* 👈 Input file ẩn */}
      <input
        ref={fileInputRef}
        id="excel-upload"
        type="file"
        className="hidden"
        accept=".xlsx, .xls, .csv"
        onChange={handleFileChange}
        disabled={isOptimizing || isParsing}
      />

      <div className="rounded-xl p-4 border border-gray-200">
        <div className="flex space-x-[1vw] pb-[1vw] overflow-x-auto custom-scrollbar">
          
          <div 
            className={`
              bg-gray-100 rounded-lg p-3 flex-shrink-0 w-40 relative transition-all duration-300 
              border-2 border-dashed border-gray-400 flex flex-col items-center justify-center
              ${isOptimizing || isParsing 
                ? 'opacity-50 cursor-not-allowed' 
                : 'cursor-pointer hover:bg-gray-200 hover:shadow-lg'
              }
            `}
            onClick={() => {
                if (!isOptimizing && !isParsing) {
                  setParseMessage(''); // Xóa thông báo cũ
                  fileInputRef.current.click(); // 👈 Kích hoạt input file
                }
            }}
            style={{minHeight: '140px'}} 
          >
            {/* 👈 Nội dung động */}
            {isParsing ? (
              <>
                <div className="text-4xl text-gray-600 animate-spin">🔄</div>
                <div className="text-sm font-semibold text-gray-600 mt-1 text-center">Đang đọc file...</div>
              </>
            ) : (
              <>
                <div className="text-4xl text-gray-600">+</div>
                <div className="text-sm font-semibold text-gray-600 mt-1 text-center">Tải lên Excel</div>
              </>
            )}
          </div>


          {/* Rectangle Cards (giữ nguyên logic map) */}
          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-lg p-3 flex-shrink-0 w-40 cursor-pointer relative transition-all duration-300 hover:shadow-lg border-2 h-[12rem] flex flex-col justify-between ${
                selectedRectangles.includes(rect.id) 
                  ? 'border-primary-500 shadow-md scale-105' 
                  : 'border-gray-200 hover:border-primary-300'
              } ${isOptimizing || isParsing ? 'opacity-70 pointer-events-none' : ''}`} // 👈 Vô hiệu hóa khi đang parsing
              onClick={() => selectRectangle(rect.id)}
            >
              {/* Nút xóa (giữ nguyên) */}
              {isCustomRect(rect.id) && (
                <button
                  onClick={(e) => handleRemoveRectangle(e, rect.id)}
                  className="absolute top-1 right-1 text-red-500 hover:text-red-700 bg-white rounded-full p-1 leading-none shadow-md transition-colors z-10"
                  title="Xóa size tùy chỉnh này"
                  disabled={isOptimizing || isParsing} // 👈 Vô hiệu hóa
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
              <div className="flex justify-center mb-3">
                <div 
                  className="rounded shadow-md flex items-center justify-center text-white font-bold text-xs drop-shadow-lg"
                  style={getRectangleStyle(rect)}
                >
                  <div className="text-center">
                    <div className="text-xs leading-tight">
                      {rect.width}×{rect.length}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="text-center">
                <div className="h-10 flex flex-col justify-center">
                    <div className="font-semibold text-gray-800 mb-1 text-sm truncate" title={rect.name}>
                        {rect.name}
                    </div>
                    <div className="text-xs text-gray-600">
                        {rect.width}×{rect.length}mm
                    </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span className="text-xs text-gray-500">SL:</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={quantities[rect.id] || 0}
                    onChange={(e) => handleQuantityChange(rect.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 px-1 py-1 text-xs border border-gray-300 rounded text-center focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                    disabled={isOptimizing || isParsing} // 👈 Vô hiệu hóa
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
    </div>
  );
};

export default RectangleList;