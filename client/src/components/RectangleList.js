import React, { useCallback, useState, useRef } from 'react';
import { usePacking } from '../context/PackingContext.js';
import ExcelJS from 'exceljs';
import SplitRestrictionModal from './SplitRestrictionModal';
import OptimizationLoadingModal from './OptimizationLoadingModal';

// --- Các hàm tiện ích (Phiên bản ExcelJS) ---
const generateRandomColor = () => {
  const randomHue = Math.floor(Math.random() * 360);
  return `hsl(${randomHue}, 70%, 60%)`;
};

const findHeaderLocation = (worksheet) => {
  const headerKeywords = ['size', 'chiều dài', 'chiều rộng', 'số lượng'];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const maxCol = row.cellCount > 3 ? row.cellCount - 3 : row.cellCount; 
    for (let c = 1; c <= maxCol; c++) {
      const cell1 = (row.getCell(c).value || '').toString().toLowerCase().trim();
      const cell2 = (row.getCell(c + 1).value || '').toString().toLowerCase().trim();
      const cell3 = (row.getCell(c + 2).value || '').toString().toLowerCase().trim();
      const cell4 = (row.getCell(c + 3).value || '').toString().toLowerCase().trim();
      if (cell1.includes(headerKeywords[0]) && cell2.includes(headerKeywords[1]) &&
          cell3.includes(headerKeywords[2]) && cell4.includes(headerKeywords[3])) 
      {
        return { headerRowIndex: r, dataColStart: c };
      }
    }
  }
  return null;
};

const parseCell = (cellValue) => {
  if (cellValue && typeof cellValue === 'object') {
    if (cellValue.result) return cellValue.result; 
    if (cellValue.text) return cellValue.text; 
  }
  return cellValue; 
};
// --- Kết thúc hàm tiện ích ---

// 👇 Component Icon Check Xanh
const CheckIcon = () => (
  <svg className="w-4 h-4 text-green-500 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

// 👇 Component Mũi tên phải (cho sub-menu)
const ChevronRightIcon = () => (
    <svg className="w-4 h-4 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
);

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
    addRectanglesFromExcel, 
    removeRectangle, 
    isOptimizing,
    packingStrategy,
    setPackingStrategy,
    unsplitableRectIds,
    setUnsplitableRectIds,
    optimizationProgress,
  } = usePacking();
  
  // --- State mới cho trình tải lên Excel ---
  const [isParsing, setIsParsing] = useState(false); 
  const [parseMessage, setParseMessage] = useState(''); 
  const fileInputRef = useRef(null); 
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

  const handleQuantityChange = useCallback((rectId, value) => {
    const quantity = Math.max(0, parseInt(value) || 0);
    setQuantity(rectId, quantity);
  }, [setQuantity]);

  const handleRemoveRectangle = (e, id) => {
    e.stopPropagation(); 
    if (window.confirm(`Bạn có chắc chắn muốn xóa size ID ${id} này không?`)) {
        removeRectangle(id);
    }
  };

  // --- Hàm xử lý file Excel ---
  const handleFileChange = (e) => {
    setIsParsing(true);
    setParseMessage('');
    const file = e.target.files[0];
    if (!file) {
      setIsParsing(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target.result; 
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(data); 

        let parsedData = [];
        let sheetFound = false;

        for (const worksheet of workbook.worksheets) {
          const location = findHeaderLocation(worksheet);
          if (location) {
            sheetFound = true;
            const { headerRowIndex, dataColStart } = location;
            for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
              const row = worksheet.getRow(r);
              const name = row.getCell(dataColStart).value;
              const length = row.getCell(dataColStart + 1).value;
              const width = row.getCell(dataColStart + 2).value;
              const quantity = row.getCell(dataColStart + 3).value;
              const pName = parseCell(name);
              const pLength = parseCell(length);
              const pWidth = parseCell(width);
              const pQuantity = parseCell(quantity);

              if (pName != null && pLength != null && pWidth != null && pQuantity != null) {
                const rectName = String(pName).trim();
                const rectLength = parseFloat(pLength);
                const rectWidth = parseFloat(pWidth);
                const rectQuantity = parseInt(pQuantity, 10);
                if (rectName && !isNaN(rectLength) && rectLength > 0 &&
                    !isNaN(rectWidth) && rectWidth > 0 && !isNaN(rectQuantity) && rectQuantity >= 0) 
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
      e.target.value = null; 
    };
    reader.readAsArrayBuffer(file);
  };

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

  const isCustomRect = (id) => id > 8; 

  // 👇 Helper xác định text hiển thị cho nút chính
  const getCurrentStrategyLabel = () => {
      if (packingStrategy === 'FULL_SIZE') return 'Size Nguyên';
      if (unsplitableRectIds.length > 0) return 'Tối ưu: Tuỳ chỉnh';
      return 'Tối ưu diện tích';
  }

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

      {parseMessage && (
        <div className="mb-2 p-1 text-sm rounded-lg border bg-gray-50 text-gray-700">
          {parseMessage}
        </div>
      )}
      
      <div className="mb-2 bg-blue-50 border border-blue-200 rounded-lg p-2">
        <div className="flex flex-col gap-1 md:flex-row md:justify-between md:items-center">
          
          <div className="flex gap-2 flex-shrink-0">
            <button 
              onClick={selectAllRectangles}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 hover:shadow-md border border-gray-400 bg-white text-gray-700 disabled:opacity-50"
              disabled={isOptimizing || isParsing}
            >
              ✅ Select All
            </button>
            <button 
              onClick={clearSelection} 
              disabled={selectedRectangles.length === 0 || isOptimizing || isParsing}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 hover:shadow-md border border-gray-400 bg-white text-gray-700 disabled:opacity-50"
            >
              ❌ Cancel
            </button>
          </div>
          
          <div className="text-xs text-gray-700 font-medium bg-white border border-gray-200 rounded-md px-2 py-1.5 flex-shrink-0 w-fit">
            <span className="text-sm">
              <span className="text-primary-600 font-bold">{totalSelectedTypes}</span> loại | 
              <span className="text-blue-600 font-bold ml-1">{totalRectanglesCount}</span> hình
            </span>
          </div>

          {/* 👇 CUSTOM NESTED DROPDOWN */}
          <div className="relative group inline-block">
             {/* Nút hiển thị chính */}
            <button 
                disabled={isOptimizing || isParsing}
                className={`
                    flex items-center justify-between w-fit px-3 py-2 text-sm font-medium bg-white border rounded-lg shadow-sm transition-all
                    ${isOptimizing ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-500 hover:shadow-md cursor-pointer'}
                    ${unsplitableRectIds.length > 0 ? 'border-yellow-400 text-yellow-800 bg-yellow-50' : 'border-gray-300 text-gray-700'}
                `}
            >
                <span>{getCurrentStrategyLabel()}</span>
                <svg className="w-4 h-4 ml-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            {/* Menu chính */}
            <div className="absolute left-0 top-full mb-1 w-max min-w-full bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-bottom z-50">
                <div className="py-1">
                    
                    {/* Option 1: Tối ưu diện tích (ĐƯA LÊN ĐẦU) */}
                    <div className="relative group/nested px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer flex items-center justify-between">
                        <div className="flex items-center w-full" onClick={() => setPackingStrategy('AREA_OPTIMIZED')}>
                            <span>Tối ưu diện tích</span>
                            {packingStrategy === 'AREA_OPTIMIZED' && <CheckIcon />}
                        </div>
                        <ChevronRightIcon />

                        {/* Sub-menu (Listbox trong listbox) - Giữ nguyên vị trí hiển thị bên phải */}
                        <div className="absolute right-full top-0 mr-1 w-max bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 invisible group-hover/nested:opacity-100 group-hover/nested:visible transition-all duration-200 transform origin-top-right">
                             <div className="py-1">
                                <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cấu hình size</div>
                                
                                {/* Sub-Option 1.1: Xếp tuỳ ý */}
                                <div 
                                    className="px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer flex items-center"
                                    onClick={(e) => {
                                        e.stopPropagation(); 
                                        setPackingStrategy('AREA_OPTIMIZED');
                                        setUnsplitableRectIds([]); 
                                    }}
                                >
                                    <span>Xếp tuỳ ý</span>
                                    {packingStrategy === 'AREA_OPTIMIZED' && unsplitableRectIds.length === 0 && <CheckIcon />}
                                </div>

                                {/* Sub-Option 1.2: Chọn size cấm chia */}
                                <div 
                                    className="px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer flex items-center"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPackingStrategy('AREA_OPTIMIZED');
                                        setIsSplitModalOpen(true); 
                                    }}
                                >
                                    <span>Chọn size nguyên</span>
                                    {packingStrategy === 'AREA_OPTIMIZED' && unsplitableRectIds.length > 0 && <CheckIcon />}
                                </div>
                             </div>
                        </div>
                    </div>

                    {/* Option 2: Size Nguyên  */}
                    <div 
                        className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer flex items-center"
                        onClick={() => setPackingStrategy('FULL_SIZE')}
                    >
                        <span>Size Nguyên</span>
                        {packingStrategy === 'FULL_SIZE' && <CheckIcon />}
                    </div>

                </div>
            </div>
          </div>

          <button 
            onClick={startOptimization}
            disabled={totalRectanglesCount === 0 || isOptimizing || isParsing}
            className={`
                btn-primary text-sm px-4 py-2 flex-shrink-0 transition-all 
                ${isOptimizing ? 'opacity-70 cursor-not-allowed' : ''}
            `}
          >
            {isOptimizing ? '🔄 Đang xử lý...' : 
             isParsing ? '⏳ Please, wait...' : 
             `Netting`
            }
          </button>
        </div>
      </div>
      
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
                  setParseMessage(''); 
                  fileInputRef.current.click(); 
                }
            }}
            style={{minHeight: '140px'}} 
          >
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

          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-lg p-3 flex-shrink-0 w-40 cursor-pointer relative transition-all duration-300 hover:shadow-lg border-2 h-[12rem] flex flex-col justify-between ${
                selectedRectangles.includes(rect.id) 
                  ? 'border-primary-500 shadow-md scale-105' 
                  : 'border-gray-200 hover:border-primary-300'
              } ${isOptimizing || isParsing ? 'opacity-70 pointer-events-none' : ''}`} 
              onClick={() => selectRectangle(rect.id)}
            >
              {isCustomRect(rect.id) && (
                <button
                  onClick={(e) => handleRemoveRectangle(e, rect.id)}
                  className="absolute top-1 right-1 text-red-500 hover:text-red-700 bg-white rounded-full p-1 leading-none shadow-md transition-colors z-10"
                  title="Xóa size tùy chỉnh này"
                  disabled={isOptimizing || isParsing} 
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
                    disabled={isOptimizing || isParsing} 
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SplitRestrictionModal
        isOpen={isSplitModalOpen}
        onClose={() => setIsSplitModalOpen(false)}
        rectangles={selectedRectsWithQuantities} 
        initialRestrictedIds={unsplitableRectIds}
        onSave={(newIds) => {
          setUnsplitableRectIds(newIds);
          setIsSplitModalOpen(false);
        }}
      />
      <OptimizationLoadingModal 
        isOpen={isOptimizing} 
        progress={optimizationProgress} 
      />
    </div>
  );
};

export default RectangleList;