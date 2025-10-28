import React, { useState } from 'react';
import { usePacking } from '../context/PackingContext';

const RectangleList = () => {
  const { 
    rectangles, 
    selectedRectangles, 
    selectRectangle, 
    selectAllRectangles, 
    clearSelection,
    updateRectangle,
    startOptimization
  } = usePacking();
  
  const [quantities, setQuantities] = useState({});

  const handleQuantityChange = (rectId, quantity) => {
    setQuantities(prev => ({
      ...prev,
      [rectId]: Math.max(0, parseInt(quantity) || 0)
    }));
  };

  const selectedRects = rectangles.filter(rect => selectedRectangles.includes(rect.id));
  const totalSelected = selectedRects.length;

  // Tính tỷ lệ để hiển thị hình chữ nhật theo đúng tỷ lệ
  const getRectangleStyle = (rect) => {
    const maxWidth = 120;
    const maxHeight = 80;
    const aspectRatio = rect.width / rect.height;
    
    let displayWidth, displayHeight;
    if (aspectRatio > 1) {
      // Rộng hơn cao
      displayWidth = Math.min(maxWidth, rect.width / 3);
      displayHeight = displayWidth / aspectRatio;
    } else {
      // Cao hơn rộng
      displayHeight = Math.min(maxHeight, rect.height / 3);
      displayWidth = displayHeight * aspectRatio;
    }
    
    return {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      backgroundColor: rect.color,
      minWidth: '40px',
      minHeight: '30px'
    };
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-gray-800 text-2xl font-semibold flex items-center gap-2">
          📦 Quản lý Hình chữ nhật
        </h2>
        <div className="text-sm text-gray-500">
          Tổng: {rectangles.length} loại
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <button 
          onClick={selectAllRectangles}
          className="btn-secondary text-sm px-4 py-2"
        >
          ✅ Chọn tất cả
        </button>
        <button 
          onClick={clearSelection} 
          disabled={selectedRectangles.length === 0}
          className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
        >
          ❌ Bỏ chọn ({selectedRectangles.length})
        </button>
        <button 
          onClick={startOptimization}
          disabled={selectedRectangles.length === 0}
          className="btn-primary text-sm px-6 py-2 disabled:opacity-50"
        >
          🚀 Tối ưu sắp xếp
        </button>
      </div>
      
      {/* Rectangle Grid */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-xl p-4 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl border-2 ${
                selectedRectangles.includes(rect.id) 
                  ? 'border-primary-500 shadow-lg ring-2 ring-primary-200' 
                  : 'border-gray-200 hover:border-primary-300'
              }`}
              onClick={() => selectRectangle(rect.id)}
            >
              {/* Rectangle Preview */}
              <div className="flex justify-center mb-3">
                <div 
                  className="rounded-lg shadow-md border-2 border-white flex items-center justify-center text-white font-bold text-xs drop-shadow-lg"
                  style={getRectangleStyle(rect)}
                >
                  <div className="text-center">
                    <div className="text-xs leading-tight">
                      {rect.width}×{rect.height}
                    </div>
                    <div className="text-xs opacity-90">mm</div>
                  </div>
                </div>
              </div>
              
              {/* Rectangle Info */}
              <div className="text-center">
                <div className="font-semibold text-gray-800 mb-1 text-sm">
                  {rect.name}
                </div>
                <div className="text-xs text-gray-600 mb-3">
                  {rect.width}mm × {rect.height}mm
                </div>
                
                {/* Quantity Input */}
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-gray-500">Số lượng:</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={quantities[rect.id] || 0}
                    onChange={(e) => handleQuantityChange(rect.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-md text-center focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Selected Summary */}
      {totalSelected > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-blue-800 font-semibold text-lg flex items-center gap-2">
              📋 Đã chọn {totalSelected} hình chữ nhật
            </h3>
            <div className="text-blue-600 text-sm">
              Tổng diện tích: {selectedRects.reduce((sum, rect) => 
                sum + (rect.width * rect.height * (quantities[rect.id] || 0)), 0
              ).toLocaleString()} mm²
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {selectedRects.map(rect => (
              <div key={rect.id} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-8 h-6 rounded border border-gray-300"
                    style={{ backgroundColor: rect.color }}
                  ></div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-800 text-sm">
                      {rect.name}
                    </div>
                    <div className="text-xs text-gray-600">
                      {rect.width}×{rect.height}mm 
                      <span className="ml-2 text-blue-600">
                        (×{quantities[rect.id] || 0})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RectangleList;
