import React from 'react';
import { usePacking } from '../context/PackingContext';

const StatusOverview = () => {
  const { 
    container, 
    rectangles, 
    selectedRectangles, 
    quantities, // Use quantities state
    packingResult, 
    isOptimizing 
  } = usePacking();

  const totalRectangles = rectangles.length;
  
  // Calculate area and count based on selected rectangles AND their quantity
  const selectedRectsWithQuantities = rectangles
    .filter(rect => selectedRectangles.includes(rect.id))
    .map(rect => ({
      ...rect,
      quantity: quantities[rect.id] || 0
    }));
    
  const selectedCountTotal = selectedRectsWithQuantities.reduce((sum, rect) => sum + rect.quantity, 0);
  
  const containerArea = container.width * container.height * container.layers; // Total area over all layers
  const selectedArea = selectedRectsWithQuantities.reduce((sum, rect) => 
    sum + (rect.width * rect.height * rect.quantity), 0
  );

  const getStatusColor = () => {
    if (isOptimizing) return 'from-blue-500 to-indigo-500';
    if (packingResult) return 'from-green-500 to-emerald-500';
    if (selectedCountTotal > 0) return 'from-yellow-500 to-orange-500';
    return 'from-gray-500 to-gray-600';
  };

  const getStatusText = () => {
    if (isOptimizing) return 'Đang tối ưu...';
    if (packingResult) return 'Đã hoàn thành';
    if (selectedCountTotal > 0) return `Sẵn sàng tối ưu (${selectedCountTotal} hình)`;
    return 'Chưa chọn hình chữ nhật';
  };

  const getStatusIcon = () => {
    if (isOptimizing) return '⚙️';
    if (packingResult) return '✅';
    if (selectedCountTotal > 0) return '🚀';
    return '📦';
  };

  return (
    <div className="mb-8">
      <div className={`bg-gradient-to-r ${getStatusColor()} rounded-xl p-6 text-white shadow-lg`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{getStatusIcon()}</span>
            <div>
              <h2 className="text-xl font-bold">Trạng thái hệ thống</h2>
              <p className="text-white/90">{getStatusText()}</p>
            </div>
          </div>
          {packingResult && (
            <div className="text-right">
              <div className="text-2xl font-bold">
                {packingResult.efficiency.toFixed(1)}%
              </div>
              <div className="text-sm text-white/90">Hiệu suất tổng thể</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/20 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{container.width || 0}</div>
            <div className="text-sm text-white/90">Container W (mm)</div>
          </div>
          
          <div className="bg-white/20 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{container.height || 0}</div>
            <div className="text-sm text-white/90">Container H (mm)</div>
          </div>
          
          <div className="bg-white/20 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{selectedCountTotal}</div>
            <div className="text-sm text-white/90">Tổng số hình đã chọn</div>
          </div>
          
          <div className="bg-white/20 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">
              {containerArea > 0 ? (selectedArea / containerArea * 100).toFixed(1) : 0}%
            </div>
            <div className="text-sm text-white/90">Tỷ lệ vật liệu</div>
          </div>
        </div>

        {packingResult && (
          <div className="mt-4 pt-4 border-t border-white/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-white/90">Số hình đã xếp:</span>
                <span className="font-semibold">{packingResult.rectangles.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/90">Diện tích sử dụng:</span>
                <span className="font-semibold">{packingResult.usedArea.toLocaleString()} mm²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/90">Diện tích lãng phí:</span>
                <span className="font-semibold">{packingResult.wasteArea.toLocaleString()} mm²</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusOverview;