import React, { useState, useEffect } from 'react';
import { usePacking } from '../context/PackingContext';

const PackingResult = () => {
  const { packingResult, isOptimizing, container } = usePacking();
  // State to track which layer is currently selected for visualization
  const [selectedLayer, setSelectedLayer] = useState(0);

  // Reset selected layer when a new result comes in or container changes
  useEffect(() => {
    setSelectedLayer(0);
  }, [packingResult, container.layers]);
  
  // Show loading/no result state first
  if (isOptimizing) {
    return (
      <div className="mb-8">
        <h2 className="text-gray-800 text-2xl font-semibold mb-6 flex items-center gap-2">
          🔄 Đang tối ưu...
        </h2>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-12 min-h-96 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="animate-spin text-6xl mb-6">⚙️</div>
            <p className="text-xl font-semibold text-blue-800 mb-2">Đang chạy thuật toán tối ưu</p>
            <p className="text-blue-600">Vui lòng chờ trong giây lát...</p>
            <div className="mt-4 w-64 bg-blue-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!packingResult || !packingResult.rectangles || packingResult.rectangles.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="text-gray-800 text-2xl font-semibold mb-6 flex items-center gap-2">
          📊 Kết quả sắp xếp
        </h2>
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-12 min-h-96 flex flex-col items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-6xl mb-4">📦</div>
            <p className="text-xl font-semibold text-gray-700 mb-2">Chưa có kết quả sắp xếp</p>
            <p className="text-gray-500">Nhập thông số container và chọn hình chữ nhật để bắt đầu tối ưu</p>
          </div>
        </div>
      </div>
    );
  }

  const { 
    rectangles: allRectangles, 
    efficiency, 
    usedArea, 
    totalArea: maxTotalArea, 
    wasteArea, 
    layersUsed = 1, 
    layers: resultLayers
  } = packingResult;
  
  // Lấy dữ liệu lớp hiện tại
  const currentLayerData = resultLayers ? resultLayers[selectedLayer] : null;
  const currentLayerRectangles = currentLayerData ? currentLayerData.rectangles : [];
  
  // Tính toán kích thước hiển thị
  const maxVisualWidth = 800; 
  const maxVisualHeight = 500;
  const scale = Math.min(maxVisualWidth / container.width, maxVisualHeight / container.height);

  const displayWidth = Math.min(maxVisualWidth, container.width * scale);
  const displayHeight = Math.min(maxVisualHeight, container.height * scale);

  // Tính toán thống kê cho lớp hiện tại
  const containerAreaPerLayer = container.width * container.height;
  const layerUsedArea = currentLayerRectangles.reduce((sum, rect) => sum + (rect.width * rect.height), 0);
  const layerEfficiency = containerAreaPerLayer > 0 ? (layerUsedArea / containerAreaPerLayer) * 100 : 0;
  const layerWasteArea = containerAreaPerLayer - layerUsedArea;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-gray-800 text-2xl font-semibold flex items-center gap-2">
          📊 Kết quả sắp xếp
        </h2>
        <div className="text-sm text-gray-500">
          Container: {container.width}×{container.height}mm | Max Lớp: {container.layers} | **Lớp dùng:** {layersUsed}
        </div>
      </div>
      
      {/* Layer Selector */}
      <div className="mb-4 flex items-center gap-3 overflow-x-auto pb-2">
        <span className="font-medium text-gray-700 flex-shrink-0">Chọn lớp:</span>
        {Array.from({ length: layersUsed }).map((_, index) => (
          <button
            key={index}
            onClick={() => setSelectedLayer(index)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 flex-shrink-0 ${
              selectedLayer === index 
                ? 'bg-primary-600 text-white shadow-md' 
                : 'bg-gray-200 text-gray-700 hover:bg-primary-100'
            }`}
          >
            Lớp {index + 1} ({resultLayers[index].rectangles.length} hình)
          </button>
        ))}
      </div>
      
      {/* Container Visualization */}
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-300 p-6 mb-6">
        <div className="text-center mb-4">
          <h3 className="text-xl font-semibold text-gray-800">
             Container Layout - Lớp {selectedLayer + 1}
          </h3>
          <p className="text-sm text-gray-600">
            Kích thước: {container.width}×{container.height}mm | Tỷ lệ hiển thị: 1:{Math.round(1/scale)}
          </p>
        </div>
        
        <div className="flex justify-center p-4 overflow-x-auto overflow-y-auto">
          <div 
            className="relative border-2 border-gray-900 rounded-lg shadow-inner bg-gradient-to-br from-gray-50 to-gray-100 flex-shrink-0"
            style={{ 
              width: `${displayWidth}px`, 
              height: `${displayHeight}px`,
              minWidth: '300px',
              minHeight: '200px'
            }}
          >
            {/* Grid lines for better visualization */}
            <div className="absolute inset-0 opacity-20">
              {/* Using a 100mm grid overlay */}
              {Array.from({length: Math.floor(container.width/100)}).map((_, i) => (
                <div 
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-300"
                  style={{ left: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
              {Array.from({length: Math.floor(container.height/100)}).map((_, i) => (
                <div 
                  key={`h-${i}`}
                  className="absolute left-0 right-0 h-px bg-gray-300"
                  style={{ top: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
            </div>
            
            {/* Packed Rectangles for the current layer */}
            {currentLayerRectangles.map((rect) => {
              const rectWidth = rect.width * scale;
              const rectHeight = rect.height * scale;
              // Dynamically adjust font size to ensure text visibility and fit
              const minDim = Math.min(rectWidth, rectHeight);
              const fontSize = Math.max(8, minDim * 0.15); 
              
              // Unique key for array map
              const key = rect.id + '-' + rect.layer; 
              
              return (
                <div
                  key={key}
                  className="absolute border border-white shadow-lg flex items-center justify-center text-white font-bold drop-shadow-lg transition-all duration-300 hover:scale-[1.03] hover:z-20 hover:shadow-xl cursor-help"
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
                  title={`[Lớp ${rect.layer + 1}] ${rect.name} (${rect.width}×${rect.height}mm) tại X:${rect.x} Y:${rect.y} ${rect.rotated ? '(Xoay 90°)' : ''}`}
                >
                  <div className="text-center leading-tight p-1">
                    <div className="text-xs">
                      {rect.width}×{rect.height}
                    </div>
                    <div className="text-xs opacity-90">mm</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-800 mb-1">
            {efficiency.toFixed(1)}%
          </div>
          <div className="text-sm text-green-600 font-medium">
            Hiệu suất tổng thể
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-800 mb-1">
            {allRectangles.length}
          </div>
          <div className="text-sm text-blue-600 font-medium">
            Tổng số hình đã xếp
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-purple-800 mb-1">
            {layerUsedArea.toLocaleString()}
          </div>
          <div className="text-sm text-purple-600 font-medium">
            Diện tích Lớp {selectedLayer + 1} (mm²)
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-orange-800 mb-1">
            {wasteArea.toLocaleString()}
          </div>
          <div className="text-sm text-orange-600 font-medium">
            Diện tích lãng phí (mm²)
          </div>
        </div>
      </div>

      {/* Detailed Results */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          📋 Chi tiết thống kê
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-3">Thông tin Container</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Kích thước:</span>
                <span className="font-medium">{container.width} × {container.height} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Diện tích mỗi lớp:</span>
                <span className="font-medium">{containerAreaPerLayer.toLocaleString()} mm²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Số lớp tối đa:</span>
                <span className="font-medium">{container.layers}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-3">Thống kê Sắp xếp (Tổng thể)</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Tỷ lệ sử dụng:</span>
                <span className="font-medium text-green-600">{efficiency.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tổng diện tích sử dụng:</span>
                <span className="font-medium">{usedArea.toLocaleString()} mm²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tổng diện tích lãng phí:</span>
                <span className="font-medium text-orange-600">{wasteArea.toLocaleString()} mm²</span>
              </div>
            </div>
          </div>

          <div>
             <h4 className="font-medium text-gray-700 mb-3">Kết quả Tối ưu Lớp</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Số lớp **đã dùng**:</span>
                <span className="font-medium text-primary-600">{layersUsed} / {container.layers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Hiệu suất lớp đang xem:</span>
                <span className="font-medium text-green-600">{layerEfficiency.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Số hình trên lớp đang xem:</span>
                <span className="font-medium">{currentLayerRectangles.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PackingResult;