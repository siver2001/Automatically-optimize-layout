// client/src/components/PackingResult.js

import React, { useState, useEffect } from 'react';
import { usePacking } from '../context/PackingContext.js';

const PackingResult = () => {
  const { packingResult, isOptimizing, container, rectangles } = usePacking();
  
  const [selectedPlate, setSelectedPlate] = useState(0); 
  const [placedRectDetails, setPlacedRectDetails] = useState({});
  // Đã xóa exportLoading state
  
  // Memoize details of original rectangle types for easy lookup
  useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color, width: rect.width, length: rect.length };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);


  // Reset selected plate when a new result comes in or container changes
  useEffect(() => {
    setSelectedPlate(0);
  }, [packingResult, container.layers]);
  
  if (isOptimizing) {
    return (
      <div className="mb-8 card p-8 min-h-[400px] flex flex-col justify-center items-center">
        <div className="text-center">
          <div className="animate-spin-slow text-6xl mb-6 text-primary-500">⚙️</div>
          <p className="text-xl font-semibold text-gray-800 mb-2">Đang chạy thuật toán tối ưu</p>
          <p className="text-gray-600">Vui lòng chờ trong giây lát...</p>
          <div className="mt-4 w-64 bg-gray-200 rounded-full h-2 mx-auto">
            <div className="bg-primary-500 h-2 rounded-full animate-pulse" style={{width: '75%'}}></div>
          </div>
        </div>
      </div>
    );
  }

  if (!packingResult || !packingResult.rectangles || packingResult.rectangles.length === 0) {
    return (
      <div className="mb-8 card p-8 min-h-[400px] flex flex-col justify-center items-center">
        <h2 className="text-gray-800 text-2xl font-semibold mb-6">
          📊 Kết quả sắp xếp
        </h2>
        <div className="text-center text-gray-500">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-xl font-semibold text-gray-700 mb-2">Chưa có kết quả sắp xếp</p>
          <p className="text-gray-500">Nhập thông số tấm liệu và chọn size để bắt đầu tối ưu</p>
        </div>
      </div>
    );
  }

  const { 
    layersUsed: platesNeeded = 0, 
    plates: resultPlates, 
    layersPerPlate = container.layers, 
  } = packingResult;
  
  const currentPlateData = resultPlates ? resultPlates[selectedPlate] : null;
  const currentPlateLayers = currentPlateData ? currentPlateData.layers : [];

  // Visualization scaling
  const containerWidth = container.width;
  const containerLength = container.length;

  const isLandscape = containerWidth > containerLength;
  const vizWidth = isLandscape ? containerWidth : containerLength;
  const vizLength = isLandscape ? containerLength : containerWidth;

  const maxVisualWidth = 500; 
  const maxVisualLength = 300; 
  const scale = Math.min(maxVisualWidth / vizWidth, maxVisualLength / vizLength);

  const displayWidth = vizWidth * scale;
  const displayLength = vizLength * scale;
  
  const gridWidth = isLandscape ? container.width : container.length;
  const gridLength = isLandscape ? container.length : container.width;

  // Tính hiệu suất của *mẫu* lớp đơn lẻ.
  const singleLayerArea = container.width * container.length;
  const plateUsedArea = currentPlateLayers.flatMap(layer => layer.rectangles.filter(Boolean))
    .reduce((sum, rect) => rect.layer === 0 ? sum + (rect.width * rect.length) : sum, 0);
  
  const plateEfficiency = singleLayerArea > 0 ? (plateUsedArea / singleLayerArea * 100).toFixed(1) : 0;
  
  // Đã xóa hàm handleExportDXF
  
  return (
    <div className="mb-8 card p-3"> 
      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-1 mb-4">
        <div className="flex items-center justify-between mb-3 border-b pb-1"> 
          <h3 className="text-l font-semibold text-gray-800">
            Tấm liệu {selectedPlate + 1} ({layersPerPlate} lớp)
          </h3>
          <div className="text-l text-gray-600">
             Hiệu suất (1 Lớp tối ưu): <span className="font-bold text-primary-600">{plateEfficiency}%</span>
          </div>
        </div>
        
        {/* Plate Selector Buttons */}
        {platesNeeded > 1 && (
            <div className="mb-3 flex items-center gap-3 overflow-x-auto pb-2">
                <span className="font-medium text-gray-700 flex-shrink-0">Chọn Tấm liệu:</span>
                {Array.from({ length: platesNeeded }).map((_, index) => (
                <button
                    key={index}
                    onClick={() => setSelectedPlate(index)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 flex-shrink-0 border ${
                    selectedPlate === index 
                        ? 'bg-primary-600 text-white shadow-md border-primary-600' 
                        : 'bg-white text-gray-700 hover:bg-primary-50 border-gray-300'
                    }`}
                >
                    Tấm liệu {index + 1}
                </button>
                ))}
            </div>
        )}
        
        {/* Visualization Area */}
        <div className="flex justify-center p-1 overflow-x-auto overflow-y-auto">
          <div 
            className="relative border-4 border-gray-900 rounded-lg shadow-inner bg-gray-200 flex-shrink-0"
            style={{ 
              width: `${displayWidth}px`, 
              height: `${displayLength}px`,
              minWidth: '300px',
              minHeight: '200px'
            }}
          >
            {/* Grid lines for better visualization */}
            <div className="absolute inset-0 opacity-20">
              {/* Vertical lines - 100mm grid */}
              {Array.from({length: Math.floor(gridWidth/100)}).map((_, i) => (
                <div 
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-400"
                  style={{ left: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
              {/* Horizontal lines - 100mm grid */}
              {Array.from({length: Math.floor(gridLength/100)}).map((_, i) => (
                <div 
                  key={`h-${i}`}
                  className="absolute left-0 right-0 h-px bg-gray-400"
                  style={{ top: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
            </div>
            
            {/* Packed Rectangles: Iterate over ALL LAYERS in the selected PLATE */}
            {currentPlateLayers
              .flatMap(layer => layer.rectangles.filter(Boolean)) 
              .map((rect) => {
              
              if (!rect || typeof rect.width !== 'number' || typeof rect.length !== 'number') {
                  return null;
              }
              
              const rectWidth = rect.width * scale;
              const rectLength = rect.length * scale;
              const rectX = isLandscape ? rect.x * scale : rect.y * scale;
              const rectY = isLandscape ? rect.y * scale : rect.x * scale;
              const finalWidth = isLandscape ? rectWidth : rectLength;
              const finalLength = isLandscape ? rectLength : rectWidth;
              
              const minDim = Math.min(finalWidth, finalLength);
              const fontSize = Math.max(8, minDim * 0.15); 
              
              const originalRect = placedRectDetails[rect.typeId];
              
              const originalDims = (originalRect && originalRect.width && originalRect.length)
                ? `${originalRect.width}×${originalRect.length}mm` 
                : 'Kích thước gốc không xác định';

              const rectName = originalRect ? originalRect.name : `ID ${rect.typeId}`;
              
              // Visually distinguish layers using opacity and z-index
              const layersCount = layersPerPlate;
              const opacity = 1 - (rect.layer / layersCount) * 0.4; 
              const zIndex = 10 + (layersCount - rect.layer); 
              
              return (
                <div
                  key={rect.id} 
                  className="absolute border border-white shadow-xl flex items-center justify-center text-white font-bold transition-all duration-300 hover:scale-[1.03] hover:z-20 cursor-help"
                  style={{
                    left: `${rectX}px`,
                    top: `${rectY}px`,
                    width: `${finalWidth}px`,
                    height: `${finalLength}px`,
                    backgroundColor: rect.color,
                    fontSize: `${fontSize}px`,
                    minWidth: '20px', 
                    minHeight: '15px', 
                    overflow: 'hidden',
                    opacity: opacity, 
                    zIndex: zIndex 
                  }}
                  title={`[Tấm ${rect.plateIndex + 1}, Lớp ${rect.layer + 1}] ${rectName} (${originalDims}) tại X:${rect.x} Y:${rect.y} ${rect.rotated ? '(Xoay 90°)' : ''}`}
                >
                  <div className="text-center leading-none p-0.5">
                    <div className="text-xs">{rect.width}×{rect.length} (L{rect.layer + 1})</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Đã xóa Nút Export DXF */}
        <div className="mt-3 flex justify-end">
          {/* Không có nút Export DXF */}
        </div>
      </div>
    </div>
  );
};

export default PackingResult;