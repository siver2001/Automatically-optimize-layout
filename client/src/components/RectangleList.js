import React, { useCallback, useEffect } from 'react';
import { usePacking } from '../context/PackingContext';

const RectangleList = () => {
  const { 
    rectangles, 
    selectedRectangles, 
    quantities, 
    selectRectangle, 
    selectAllRectangles, 
    clearSelection,
    setQuantity, 
    startOptimization
  } = usePacking();
  
  // Set default quantity to 1 for new items when the list loads/changes
  useEffect(() => {
    rectangles.forEach(rect => {
      if (quantities[rect.id] === undefined) {
        setQuantity(rect.id, 1); 
      }
    });
  }, [rectangles, quantities, setQuantity]);

  // Use useCallback for handler to avoid unnecessary re-renders
  const handleQuantityChange = useCallback((rectId, value) => {
    // Ensure quantity is non-negative integer
    const quantity = Math.max(0, parseInt(value) || 0);
    setQuantity(rectId, quantity);
  }, [setQuantity]);

  // Filter selected rectangles and calculate total quantity for display
  const selectedRectsWithQuantities = rectangles
    .filter(rect => selectedRectangles.includes(rect.id))
    .map(rect => ({
      ...rect,
      quantity: quantities[rect.id] || 0
    }))
    .filter(rect => rect.quantity > 0); // Only show/count if quantity > 0
    
  const totalSelectedTypes = selectedRectsWithQuantities.length;
  const totalRectanglesCount = selectedRectsWithQuantities.reduce((sum, rect) => sum + rect.quantity, 0);

  // Calculate total area for the selected rectangles
  const totalSelectedArea = selectedRectsWithQuantities.reduce((sum, rect) => 
    sum + (rect.width * rect.height * rect.quantity), 0
  );

  // Tính tỷ lệ để hiển thị hình chữ nhật theo đúng tỷ lệ
  const getRectangleStyle = (rect) => {
    const maxWidth = 120;
    const maxHeight = 80;
    const aspectRatio = rect.width / rect.height;
    
    let displayWidth, displayHeight;
    if (aspectRatio > 1) {
      // Rộng hơn cao: scale theo chiều rộng max
      displayWidth = Math.min(maxWidth, rect.width / 4); // Adjusted scale for better preview
      displayHeight = displayWidth / aspectRatio;
    } else {
      // Cao hơn rộng: scale theo chiều cao max
      displayHeight = Math.min(maxHeight, rect.height / 4);
      displayWidth = displayHeight * aspectRatio;
    }
    
    return {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      backgroundColor: rect.color,
      minWidth: '25px', // Reduced min size for better display in the list
      minHeight: '20px'
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
          disabled={totalRectanglesCount === 0}
          className="btn-primary text-sm px-6 py-2 disabled:opacity-50"
        >
          🚀 Tối ưu sắp xếp ({totalRectanglesCount} hình)
        </button>
      </div>
      
      {/* Rectangle Grid - Added overflow-x-auto for horizontal scroll on smaller screens/windows */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
        <div className="flex space-x-4 pb-4 overflow-x-auto custom-scrollbar">
          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-xl p-4 flex-shrink-0 w-52 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl border-2 ${
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
      {totalSelectedTypes > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-blue-800 font-semibold text-lg flex items-center gap-2">
              📋 Đã chọn {totalSelectedTypes} loại hình chữ nhật
            </h3>
            <div className="text-blue-600 text-sm">
              Tổng số lượng: {totalRectanglesCount} | Tổng diện tích: {totalSelectedArea.toLocaleString()} mm²
            </div>
          </div>
          
          {/* Use smaller grid columns for density */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-48 overflow-y-auto pr-2">
            {selectedRectsWithQuantities.map(rect => (
              <div key={rect.id} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-8 h-6 rounded border border-gray-300"
                    style={{ backgroundColor: rect.color }}
                  ></div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-800 text-sm truncate">
                      {rect.name}
                    </div>
                    <div className="text-xs text-gray-600">
                      {rect.width}×{rect.height}mm 
                      <span className="ml-2 text-blue-600 font-semibold">
                        (×{rect.quantity})
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