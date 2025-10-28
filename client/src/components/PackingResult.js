import React, { useState } from 'react';
import { usePacking } from '../context/PackingContext';

const PackingResult = () => {
  const { packingResult, isOptimizing, container } = usePacking();
  const [selectedLayer, setSelectedLayer] = useState(0);

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

  const { rectangles, efficiency, usedArea, totalArea, wasteArea } = packingResult;
  const scale = Math.min(600 / container.width, 400 / container.height);

  // Tính toán kích thước hiển thị
  const displayWidth = Math.min(600, container.width * scale);
  const displayHeight = Math.min(400, container.height * scale);

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-gray-800 text-2xl font-semibold flex items-center gap-2">
          📊 Kết quả sắp xếp
        </h2>
        <div className="text-sm text-gray-500">
          Container: {container.width}×{container.height}mm
        </div>
      </div>
      
      {/* Container Visualization */}
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-300 p-6 mb-6">
        <div className="text-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Container Layout</h3>
          <p className="text-sm text-gray-600">
            Tỷ lệ: 1:{Math.round(1/scale)} (1px = {Math.round(1/scale)}mm)
          </p>
        </div>
        
        <div className="flex justify-center">
          <div 
            className="relative border-2 border-gray-400 rounded-lg shadow-inner bg-gradient-to-br from-gray-50 to-gray-100"
            style={{ 
              width: `${displayWidth}px`, 
              height: `${displayHeight}px`,
              minWidth: '300px',
              minHeight: '200px'
            }}
          >
            {/* Grid lines for better visualization */}
            <div className="absolute inset-0 opacity-20">
              {Array.from({length: Math.ceil(container.width/100)}).map((_, i) => (
                <div 
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-300"
                  style={{ left: `${(i * 100 * scale)}px` }}
                ></div>
              ))}
              {Array.from({length: Math.ceil(container.height/100)}).map((_, i) => (
                <div 
                  key={`h-${i}`}
                  className="absolute left-0 right-0 h-px bg-gray-300"
                  style={{ top: `${(i * 100 * scale)}px` }}
                ></div>
              ))}
            </div>
            
            {/* Packed Rectangles */}
            {rectangles.map((rect, index) => {
              const rectWidth = rect.width * scale;
              const rectHeight = rect.height * scale;
              const fontSize = Math.max(8, Math.min(rectWidth, rectHeight) * 0.15);
              
              return (
                <div
                  key={index}
                  className="absolute border-2 border-white shadow-lg flex items-center justify-center text-white font-bold drop-shadow-lg cursor-pointer transition-all duration-300 hover:scale-105 hover:z-20 hover:shadow-xl"
                  style={{
                    left: `${rect.x * scale}px`,
                    top: `${rect.y * scale}px`,
                    width: `${rectWidth}px`,
                    height: `${rectHeight}px`,
                    backgroundColor: rect.color,
                    fontSize: `${fontSize}px`,
                    minWidth: '20px',
                    minHeight: '15px'
                  }}
                  title={`${rect.name}: ${rect.width}×${rect.height}mm`}
                >
                  <div className="text-center leading-tight">
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
            Hiệu suất sắp xếp
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-800 mb-1">
            {rectangles.length}
          </div>
          <div className="text-sm text-blue-600 font-medium">
            Số hình đã xếp
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-purple-800 mb-1">
            {usedArea.toLocaleString()}
          </div>
          <div className="text-sm text-purple-600 font-medium">
            Diện tích sử dụng (mm²)
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
          📋 Chi tiết kết quả
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-3">Thông tin Container</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Kích thước:</span>
                <span className="font-medium">{container.width} × {container.height} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Diện tích tổng:</span>
                <span className="font-medium">{totalArea.toLocaleString()} mm²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Số lớp:</span>
                <span className="font-medium">{container.layers}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-3">Thống kê sắp xếp</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Tỷ lệ sử dụng:</span>
                <span className="font-medium text-green-600">{efficiency.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Diện tích sử dụng:</span>
                <span className="font-medium">{usedArea.toLocaleString()} mm²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Diện tích lãng phí:</span>
                <span className="font-medium text-orange-600">{wasteArea.toLocaleString()} mm²</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PackingResult;
