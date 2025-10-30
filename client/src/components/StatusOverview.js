// client/src/components/StatusOverview.js
import React from 'react';
import { usePacking } from '../context/PackingContext.js';

const StatusOverview = () => {
  const { 
    container, 
    rectangles, 
    selectedRectangles, 
    quantities, 
    packingResult, 
    isOptimizing 
  } = usePacking();

  // Calculate area and count based on selected rectangles AND their quantity
  const selectedRectsWithQuantities = rectangles
    .filter(rect => selectedRectangles.includes(rect.id))
    .map(rect => ({
      ...rect,
      quantity: quantities[rect.id] || 0
    }));
    
  const selectedCountTotal = selectedRectsWithQuantities.reduce((sum, rect) => sum + rect.quantity, 0);
  
  // Area calculations
  // Tổng diện tích tối đa (cho mục đích so sánh ban đầu)
  const containerArea = container.width * container.length * container.layers; 
  const selectedArea = selectedRectsWithQuantities.reduce((sum, rect) => 
    sum + (rect.width * rect.length * rect.quantity), 0
  );

  const materialRatio = containerArea > 0 ? (selectedArea / containerArea * 100) : 0;
  
  // Dynamic Status Logic
  const getStatusColor = () => {
    if (isOptimizing) return 'from-blue-500 to-indigo-500';
    if (packingResult) return 'from-green-500 to-emerald-500';
    if (selectedCountTotal > 0) return 'from-yellow-500 to-orange-500';
    return 'from-gray-500 to-gray-600';
  };

  const getStatusText = () => {
    if (isOptimizing) return 'Đang chạy thuật toán tối ưu...';
    // Sử dụng platesNeeded để báo cáo số tấm cần thiết
    if (packingResult && packingResult.layersUsed > 0) return `Tối ưu hoàn thành. Cần ${packingResult.layersUsed} tấm liệu.`;
    if (packingResult && packingResult.layersUsed === 0 && selectedCountTotal > 0) return `Lỗi: Không thể xếp hình nào.`;
    if (selectedCountTotal > 0) return `Sẵn sàng tối ưu cho ${selectedCountTotal} hình.`;
    return 'Vui lòng chọn hình chữ nhật và cấu hình container.';
  };

  const getStatusIcon = () => {
    if (isOptimizing) return '⚙️';
    if (packingResult && packingResult.layersUsed > 0) return '✅';
    if (packingResult && packingResult.layersUsed === 0 && selectedCountTotal > 0) return '❌'; // Thêm biểu tượng lỗi
    if (selectedCountTotal > 0) return '🚀';
    return '📦';
  };
  
  const formattedContainerArea = (container.width * container.length).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="mb-8">
      <div className={`bg-gradient-to-r ${getStatusColor()} rounded-2xl p-6 text-white shadow-xl`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <span className={`text-4xl ${isOptimizing ? 'animate-spin-slow' : ''}`}>{getStatusIcon()}</span> 
            <div>
              <h2 className="text-2xl font-bold">TỔNG QUAN TRẠNG THÁI</h2>
              <p className="text-white/90 text-sm">{getStatusText()}</p>
            </div>
          </div>
        </div>

        {/* Enhanced Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-white/20">
          
          <div className="bg-white/10 rounded-lg p-3 text-center transition-all duration-300 hover:bg-white/20">
            <div className="text-2xl font-bold">{container.width || 0}x{container.length || 0}</div>
            <div className="text-xs text-white/80">Container (mm)</div>
          </div>
          
          <div className="bg-white/10 rounded-lg p-3 text-center transition-all duration-300 hover:bg-white/20">
            <div className="text-2xl font-bold">{formattedContainerArea}</div>
            <div className="text-xs text-white/80">Diện tích 1 Lớp (mm²)</div>
          </div>
          
          <div className="bg-white/10 rounded-lg p-3 text-center transition-all duration-300 hover:bg-white/20">
            <div className="text-2xl font-bold">{selectedCountTotal}</div>
            <div className="text-xs text-white/80">Tổng số hình đã chọn</div>
          </div>
          
          <div className="bg-white/10 rounded-lg p-3 text-center transition-all duration-300 hover:bg-white/20">
            <div className="text-2xl font-bold">{materialRatio.toFixed(1)}%</div>
            <div className="text-xs text-white/80">Tỷ lệ Vật liệu (Lý thuyết)</div>
          </div>
          
          <div className={`rounded-lg p-3 text-center transition-all duration-300 ${packingResult ? 'bg-white/20 hover:bg-white/30' : 'bg-transparent'}`}>
            <div className="text-2xl font-bold">
              {packingResult ? packingResult.efficiency.toFixed(1) + '%' : '--'}
            </div>
            <div className="text-xs text-white/80">Hiệu suất Tối ưu (Tổng thể)</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusOverview;