// client/src/components/RectangleList.js
import React, { useCallback, useEffect } from 'react';
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
    isOptimizing
  } = usePacking();
  
  useEffect(() => {
    rectangles.forEach(rect => {
      if (quantities[rect.id] === undefined) {
        setQuantity(rect.id, 1); 
      }
    });
  }, [rectangles, quantities, setQuantity]);

  const handleQuantityChange = useCallback((rectId, value) => {
    const quantity = Math.max(0, parseInt(value) || 0);
    setQuantity(rectId, quantity);
  }, [setQuantity]);

  const selectedRectsWithQuantities = rectangles
    .filter(rect => selectedRectangles.includes(rect.id))
    .map(rect => ({
      ...rect,
      quantity: quantities[rect.id] || 0
    }))
    .filter(rect => rect.quantity > 0);
    
  const totalSelectedTypes = selectedRectsWithQuantities.length;
  const totalRectanglesCount = selectedRectsWithQuantities.reduce((sum, rect) => sum + rect.quantity, 0);
  const totalSelectedArea = selectedRectsWithQuantities.reduce((sum, rect) => 
    sum + (rect.width * rect.length * rect.quantity), 0
  );

  const getRectangleStyle = (rect) => {
    const maxWidth = 100; // Reduced for more compact cards
    const maxLength = 70; // Reduced for more compact cards
    const aspectRatio = rect.width / rect.length;
    
    let displayWidth, displayLength;
    const scaleFactor = 3; 

    if (aspectRatio > 1) {
      displayWidth = Math.min(maxWidth, rect.width / scaleFactor);
      displayLength = displayWidth / aspectRatio;
    } else {
      displayLength = Math.min(maxLength, rect.length / scaleFactor);
      displayWidth = displayLength * aspectRatio;
    }
    
    return {
      width: `${Math.max(25, displayWidth)}px`,
      length: `${Math.max(20, displayLength)}px`,
      backgroundColor: rect.color,
      border: '2px solid white'
    };
  };

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
        
        {/* HÀNG DUY NHẤT TRÊN CÁC MÀN HÌNH LỚN HƠN */}
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          
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
          
          <div className="text-xs text-gray-700 font-medium bg-white border border-gray-200 rounded-md p-2 flex-1 min-w-[200px] flex justify-between items-center">
            <span className="text-sm">
              <span className="text-primary-600 font-bold">{totalSelectedTypes}</span> loại | 
              <span className="text-blue-600 font-bold ml-1">{totalRectanglesCount}</span> hình
            </span>
            <span className="text-xs text-red-600 font-bold ml-3">
              {totalSelectedArea.toLocaleString()} mm²
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
        <div className="flex space-x-4 pb-4 overflow-x-auto custom-scrollbar">
          {rectangles.map(rect => (
            <div
              key={rect.id}
              className={`bg-white rounded-lg p-3 flex-shrink-0 w-40 cursor-pointer transition-all duration-300 hover:shadow-lg border-2 ${
                selectedRectangles.includes(rect.id) 
                  ? 'border-primary-500 shadow-md scale-105' 
                  : 'border-gray-200 hover:border-primary-300'
              } ${isOptimizing ? 'opacity-70 pointer-events-none' : ''}`}
              onClick={() => selectRectangle(rect.id)}
            >
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
              
              {/* Rectangle Info */}
              <div className="text-center">
                <div className="font-semibold text-gray-800 mb-1 text-sm truncate">
                  {rect.name}
                </div>
                <div className="text-xs text-gray-600 mb-3">
                  {rect.width}×{rect.length}mm
                </div>
                
                {/* Quantity Input */}
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-gray-500">SL:</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={quantities[rect.id] || 0}
                    onChange={(e) => handleQuantityChange(rect.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 px-1 py-1 text-xs border border-gray-300 rounded text-center focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
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