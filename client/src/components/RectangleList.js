// client/src/components/RectangleList.js
import React, { useCallback, useState } from 'react';
import { usePacking } from '../context/PackingContext.js';

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
    addRectangle, 
    removeRectangle, 
    isOptimizing
  } = usePacking();
  
  const [showAddForm, setShowAddForm] = useState(false); // State để hiển thị form thêm size
  const [newRect, setNewRect] = useState({ width: '', length: '', name: '' }); // State cho input size mới

  const handleQuantityChange = useCallback((rectId, value) => {
    const quantity = Math.max(0, parseInt(value) || 0);
    setQuantity(rectId, quantity);
  }, [setQuantity]);

  // Xử lý thêm size mới
  const handleAddRectangle = (e) => {
    e.preventDefault();
    const width = parseFloat(newRect.width);
    const length = parseFloat(newRect.length);

    if (width > 0 && length > 0) {
      addRectangle({
        width: width,
        length: length,
        name: newRect.name || `${width}x${length}mm (Custom)`,
      });
      setNewRect({ width: '', length: '', name: '' }); // Reset form
      setShowAddForm(false); // Đóng form
    } else {
      alert('Vui lòng nhập chiều rộng và chiều dài hợp lệ (> 0).');
    }
  };

  // Xử lý xóa size tùy chỉnh
  const handleRemoveRectangle = (e, id) => {
    e.stopPropagation(); // Ngăn chặn việc toggle selection
    if (window.confirm(`Bạn có chắc chắn muốn xóa size ID ${id} này không?`)) {
        removeRectangle(id);
    }
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
    const maxWidth = 100; // Reduced for more compact cards
    const maxLength = 70; // Reduced for more compact cards
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

  // Các ID từ 1 đến 8 là size mặc định (không cho phép xóa)
  const isCustomRect = (id) => id > 8;


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
      
      <div className="mb-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
        
        <div className="flex flex-col gap-1 md:flex-row md:justify-between md:items-center">
          
          <div className="flex gap-2 flex-shrink-0">
            <button 
              onClick={selectAllRectangles}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 hover:shadow-md border border-gray-400 bg-white text-gray-700 disabled:opacity-50"
              disabled={isOptimizing}
            >
              ✅ Chọn tất cả
            </button>
            <button 
              onClick={clearSelection} 
              disabled={selectedRectangles.length === 0 || isOptimizing}
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
            <span className="text-xs text-red-600 font-bold ml-3">
            </span>
          </div>

          <button 
            onClick={startOptimization}
            disabled={totalRectanglesCount === 0 || isOptimizing}
            className="btn-primary text-sm px-4 py-2 flex-shrink-0"
          >
            {isOptimizing ? 
              '🔄 Đang tối ưu...' : 
              `Sắp xếp (${totalRectanglesCount} hình)`
            }
          </button>
          </div>
      </div>
      
      {/* Rectangle Grid - Enhanced Card Design */}
      <div className="rounded-xl p-4 border border-gray-200">
        <div className="flex space-x-[1vw] pb-[1vw] overflow-x-auto custom-scrollbar">
          
          {/* ADD NEW RECTANGLE CARD */}
          <div 
            className="bg-gray-100 rounded-lg p-3 flex-shrink-0 w-40 cursor-pointer relative transition-all duration-300 hover:bg-gray-200 hover:shadow-lg border-2 border-dashed border-gray-400 flex flex-col items-center justify-center"
            onClick={() => {
                if (!isOptimizing) setShowAddForm(true);
            }}
            style={{minHeight: '140px'}} 
          >
            <div className="text-4xl text-gray-600">+</div>
            <div className="text-sm font-semibold text-gray-600 mt-1">Thêm Size Tùy chỉnh</div>
          </div>


          {/* Rectangle Cards */}
          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-lg p-3 flex-shrink-0 w-40 cursor-pointer relative transition-all duration-300 hover:shadow-lg border-2 h-[12rem] flex flex-col justify-between ${
                selectedRectangles.includes(rect.id) 
                  ? 'border-primary-500 shadow-md scale-105' 
                  : 'border-gray-200 hover:border-primary-300'
              } ${isOptimizing ? 'opacity-70 pointer-events-none' : ''}`}
              onClick={() => selectRectangle(rect.id)}
            >
              {/* Remove Button for Custom Rectangles */}
              {isCustomRect(rect.id) && (
                <button
                  onClick={(e) => handleRemoveRectangle(e, rect.id)}
                  className="absolute top-1 right-1 text-red-500 hover:text-red-700 bg-white rounded-full p-1 leading-none shadow-md transition-colors z-10"
                  title="Xóa size tùy chỉnh này"
                  disabled={isOptimizing}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              )}

              {/* Rectangle Preview */}
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
              
              {/* Rectangle Info - Đã thêm DIV bọc ngoài để cố định chiều cao */}
              <div className="text-center">
                <div className="h-10 flex flex-col justify-center">
                    <div className="font-semibold text-gray-800 mb-1 text-sm truncate" title={rect.name}>
                        {rect.name}
                    </div>
                    <div className="text-xs text-gray-600"> {/* Đã bỏ mb-3 */}
                        {rect.width}×{rect.length}mm
                    </div>
                </div>
                
                {/* Quantity Input */}
                <div className="flex items-center justify-center gap-2 mt-3"> {/* FIX: Thêm mt-3 */}
                  <span className="text-xs text-gray-500">SL:</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={quantities[rect.id] || 0}
                    onChange={(e) => handleQuantityChange(rect.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 px-1 py-1 text-xs border border-gray-300 rounded text-center focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                    disabled={isOptimizing}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* ADD NEW RECTANGLE MODAL/FORM */}
      {showAddForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">➕ Thêm Size Tùy chỉnh</h3>
            <form onSubmit={handleAddRectangle} className="space-y-4">
              <div>
                <label className="label">Tên Size (Tùy chọn)</label>
                <input
                  type="text"
                  value={newRect.name}
                  onChange={(e) => setNewRect(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ví dụ: 13#"
                  className="input-field"
                  disabled={isOptimizing} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Chiều rộng (mm)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={newRect.width}
                    onChange={(e) => setNewRect(prev => ({ ...prev, width: e.target.value }))}
                    placeholder="Width (mm)"
                    className="input-field"
                    required
                    disabled={isOptimizing} 
                  />
                </div>
                <div>
                  <label className="label">Chiều dài (mm)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={newRect.length}
                    onChange={(e) => setNewRect(prev => ({ ...prev, length: e.target.value }))}
                    placeholder="Length (mm)"
                    className="input-field"
                    required
                    disabled={isOptimizing} 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="btn-secondary px-4 py-2 text-sm"
                  disabled={isOptimizing} 
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn-primary px-4 py-2 text-sm"
                  disabled={isOptimizing} 
                >
                  {/* Thay đổi text của nút khi đang tối ưu */}
                  {isOptimizing ? 'Đang tính toán...' : 'Thêm Size'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RectangleList;