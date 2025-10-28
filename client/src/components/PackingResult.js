// client/src/components/PackingResult.js
import React, { useState, useEffect } from 'react';
import { usePacking } from '../context/PackingContext.js';

const PackingResult = () => {
  const { packingResult, isOptimizing, container, rectangles } = usePacking();
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [showPlacedList, setShowPlacedList] = useState(false);
  const [placedRectDetails, setPlacedRectDetails] = useState({});

  // Memoize details of original rectangle types for easy lookup
  useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);


  // Reset selected layer when a new result comes in or container changes
  useEffect(() => {
    setSelectedLayer(0);
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
          <p className="text-gray-500">Nhập thông số container và chọn hình chữ nhật để bắt đầu tối ưu</p>
        </div>
      </div>
    );
  }

  const { 
    layersUsed = 1, 
    layers: resultLayers,
    remainingRectangles = []
  } = packingResult;
  
  const currentLayerData = resultLayers ? resultLayers[selectedLayer] : null;
  const currentLayerRectangles = currentLayerData ? currentLayerData.rectangles : [];
  
  // Visualization scaling
  const maxVisualWidth = 800; 
  const maxVisualHeight = 500;
  const scale = Math.min(maxVisualWidth / container.width, maxVisualHeight / container.height);

  const displayWidth = Math.min(maxVisualWidth, container.width * scale);
  const displayHeight = Math.min(maxVisualHeight, container.height * scale);

  const containerAreaPerLayer = container.width * container.height;
  const layerUsedArea = currentLayerRectangles.reduce((sum, rect) => sum + (rect.width * rect.height), 0);
  const layerEfficiency = containerAreaPerLayer > 0 ? (layerUsedArea / containerAreaPerLayer * 100).toFixed(1) : 0;

  return (
    <div className="mb-8 card p-6">

      {/* Layer Selector & Visualization */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-6 mb-6">
        <div className="flex items-center justify-between mb-4 border-b pb-3">
          <h3 className="text-xl font-semibold text-gray-800">
            Tấm liệu {selectedLayer + 1}
          </h3>
          <div className="text-sm text-gray-600">
             Hiệu suất: <span className="font-bold text-primary-600">{layerEfficiency}%</span>
          </div>
        </div>
        
        {/* Layer Selector Buttons */}
        {layersUsed > 1 && (
            <div className="mb-4 flex items-center gap-3 overflow-x-auto pb-2">
                <span className="font-medium text-gray-700 flex-shrink-0">Chọn Tấm liệu:</span>
                {Array.from({ length: layersUsed }).map((_, index) => (
                <button
                    key={index}
                    onClick={() => setSelectedLayer(index)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 flex-shrink-0 border ${
                    selectedLayer === index 
                        ? 'bg-primary-600 text-white shadow-md border-primary-600' 
                        : 'bg-white text-gray-700 hover:bg-primary-50 border-gray-300'
                    }`}
                >
                    Tấm liệu {index + 1} ({resultLayers[index].rectangles.length} hình)
                </button>
                ))}
            </div>
        )}
        
        {/* Visualization Area */}
        <div className="flex justify-center p-4 overflow-x-auto overflow-y-auto">
          <div 
            className="relative border-4 border-gray-900 rounded-lg shadow-inner bg-gray-200 flex-shrink-0"
            style={{ 
              width: `${displayWidth}px`, 
              height: `${displayHeight}px`,
              minWidth: '300px',
              minHeight: '200px'
            }}
          >
            {/* Grid lines for better visualization */}
            <div className="absolute inset-0 opacity-20">
              {/* Vertical lines - 100mm grid */}
              {Array.from({length: Math.floor(container.width/100)}).map((_, i) => (
                <div 
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-400"
                  style={{ left: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
              {/* Horizontal lines - 100mm grid */}
              {Array.from({length: Math.floor(container.height/100)}).map((_, i) => (
                <div 
                  key={`h-${i}`}
                  className="absolute left-0 right-0 h-px bg-gray-400"
                  style={{ top: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
            </div>
            
            {/* Packed Rectangles */}
            {currentLayerRectangles.map((rect) => {
              const rectWidth = rect.width * scale;
              const rectHeight = rect.height * scale;
              const minDim = Math.min(rectWidth, rectHeight);
              const fontSize = Math.max(8, minDim * 0.15); 
              
              const originalRect = placedRectDetails[rect.typeId]; // Fetch original details
              const rectName = originalRect ? originalRect.name : `ID ${rect.typeId}`;
              
              const key = rect.id + '-' + rect.layer; 
              
              return (
                <div
                  key={key}
                  className="absolute border border-white shadow-xl flex items-center justify-center text-white font-bold transition-all duration-300 hover:scale-[1.03] hover:z-20 cursor-help"
                  style={{
                    left: `${rect.x * scale}px`,
                    top: `${rect.y * scale}px`,
                    width: `${rectWidth}px`,
                    height: `${rectHeight}px`,
                    backgroundColor: rect.color,
                    fontSize: `${fontSize}px`,
                    minWidth: '20px', 
                    minHeight: '15px', 
                    overflow: 'hidden'
                  }}
                  title={`[Tấm liệu ${rect.layer + 1}] ${rectName} (${rect.width}×${rect.height}mm) tại X:${rect.x} Y:${rect.y} ${rect.rotated ? '(Xoay 90°)' : ''}`}
                >
                  <div className="text-center leading-none p-0.5">
                    <div className="text-xs">{rect.width}×{rect.height}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Toggle Placed Items List */}
      <div className="mb-4">
        <button 
          onClick={() => setShowPlacedList(prev => !prev)}
          className="btn-secondary px-4 py-2 text-sm"
        >
          {showPlacedList ? 'Ẩn' : 'Hiện'} Danh sách các hình đã xếp ({currentLayerRectangles.length})
        </button>
      </div>
      
      {/* Detailed Placed Items List for the current layer - The list shows WHICH pieces were placed and WHERE */}
      {showPlacedList && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-y-auto max-h-96">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {currentLayerRectangles
              .sort((a, b) => (placedRectDetails[a.typeId]?.name || "").localeCompare(placedRectDetails[b.typeId]?.name || ""))
              .map((rect, index) => {
              const originalRect = placedRectDetails[rect.typeId];
              const rectName = originalRect ? originalRect.name : `ID ${rect.typeId}`;
              
              return (
                <div key={rect.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200 shadow-sm flex items-center gap-3">
                  <div 
                    className="w-6 h-6 rounded border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: rect.color }}
                  ></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 text-sm truncate" title={rectName}>
                      {rectName}
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {rect.width}×{rect.height}mm @ ({rect.x}, {rect.y})
                      {rect.rotated && <span className="ml-1 text-orange-500">(Xoay)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Remaining items across all layers */}
      {remainingRectangles.length > 0 && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="font-semibold text-yellow-800 mb-2">Chưa xếp được ({remainingRectangles.length}):</div>
          <div className="text-sm text-yellow-800">
            {remainingRectangles.map((r) => `${r.width}×${r.height}`).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
};

export default PackingResult;