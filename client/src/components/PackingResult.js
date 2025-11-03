// client/src/components/PackingResult.js
import React, { useState, useEffect, useMemo } from 'react';
import { usePacking } from '../context/PackingContext.js';

const PackingResult = () => {
  const { packingResult, isOptimizing, container, rectangles } = usePacking();
  
  // selectedPlate là index trong mảng packingResult.plates
  const [selectedPlate, setSelectedPlate] = useState(0); 
  const [placedRectDetails, setPlacedRectDetails] = useState({});
  
  // Memoize details of original rectangle types for easy lookup
  useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color, width: rect.width, length: rect.length };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);

  // Reset selected plate and ensure it defaults to a valid index
  useEffect(() => {
    if (packingResult?.plates?.length > 0 && selectedPlate >= packingResult.plates.length) {
      setSelectedPlate(0);
    }
  }, [packingResult, selectedPlate]);
  
  // Phân loại các tấm liệu thành Pure và Mixed Plates
  const categorizedPlates = useMemo(() => {
    if (!packingResult?.plates) return []; // Sửa: Trả về mảng rỗng thay vì object rỗng

    const pure = [];
    const mixed = [];

    packingResult.plates.forEach((plate, index) => {
      // Logic phân loại dựa trên trường 'type' có trong object plate.
      // Dùng description làm fallback.
      const type = plate.type || (plate.description && plate.description.startsWith('Tấm thuần') ? 'pure' : 'mixed');

      if (type === 'pure') {
        pure.push({ ...plate, originalIndex: index, displayIndex: pure.length + 1, type });
      } else {
        mixed.push({ ...plate, originalIndex: index, displayIndex: mixed.length + 1, type });
      }
    });
    
    // Kết hợp các tấm thuần trước, sau đó là tấm hỗn hợp
    return [...pure, ...mixed];
  }, [packingResult]);


  // =================================================================
  // 1. LOADING STATE
  // =================================================================
  if (isOptimizing) {
    return (
      <div className="mb-8 card p-8 min-h-[400px] flex flex-col justify-center items-center">
        <div className="text-center">
          <div className="animate-spin-slow text-6xl mb-6 text-primary-500">⚙️</div>
          <p className="text-xl font-semibold text-gray-800 mb-2">Đang chạy thuật toán tối ưu</p>
          <p className="text-gray-600">Vui lòng chờ trong giây lát...</p>
        </div>
      </div>
    );
  }

  // =================================================================
  // 2. NO RESULT STATE 
  // =================================================================
  if (!packingResult || !packingResult.plates || packingResult.plates.length === 0) {
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

  // =================================================================
  // 3. RENDER RESULT STATE 
  // =================================================================

  const { 
    layersPerPlate = 1,     
    efficiency: totalEfficiency = 0 
  } = packingResult;

  const platesNeeded = categorizedPlates.length; // Tổng số tấm liệu
  
  // Lấy dữ liệu cho tấm liệu (plate) đang được chọn
  const currentPlateMeta = categorizedPlates[selectedPlate];
  const currentPlateData = packingResult.plates[currentPlateMeta.originalIndex];

  const currentPlateLayers = currentPlateData.layers || [];
  
  // Hiển thị tên tấm liệu
  const plateType = currentPlateMeta.type === 'pure' ? 'Thuần' : 'Hỗn Hợp';
  const plateDisplayName = `${plateType} #${currentPlateMeta.displayIndex}`;

  // --- Tính toán hiệu suất của TẤM LIỆU (PLATE) ĐANG CHỌN ---
  const singleLayerArea = container.width * container.length;
  // Sửa: Dùng số lớp thực tế để tính toán diện tích tổng của tấm, không dùng layersPerPlate
  const actualLayersUsed = currentPlateLayers.length; 
  const totalPlateArea = singleLayerArea * actualLayersUsed; 

  const plateUsedArea = currentPlateLayers
    .flatMap(layer => layer.rectangles.filter(Boolean)) 
    .reduce((sum, rect) => sum + (rect.width * rect.length), 0); 
  
  const plateEfficiency = totalPlateArea > 0 
    ? (plateUsedArea / totalPlateArea * 100).toFixed(1) 
    : 0;
  // --- Cài đặt hiển thị (Visualization) ---
  const containerWidth = container.width;
  const containerLength = container.length;

  const isLandscape = containerWidth > containerLength;
  const vizWidth = isLandscape ? containerWidth : containerLength;
  const vizLength = isLandscape ? containerLength : containerWidth;

  const maxVisualWidth = 700; 
  const maxVisualLength = 500; 
  const scale = Math.min(maxVisualWidth / vizWidth, maxVisualLength / vizLength);

  const displayWidth = vizWidth * scale;
  const displayLength = vizLength * scale;
  
  const gridWidth = isLandscape ? container.width : container.length;
  const gridLength = isLandscape ? container.length : container.width;

  return (
    <div className="mb-8 card p-3"> 
      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-1 mb-4">
        
        {/* TIÊU ĐỀ TẤM LIỆU */}
        <div className="flex items-center justify-between mb-3 border-b pb-1"> 
          {/* HIỂN THỊ SỐ LỚP THỰC TẾ TRÊN TỔNG SỐ LỚP TỐI ĐA */}
          <h3 className="text-l font-semibold text-gray-800" title={currentPlateMeta.description}>
            {plateDisplayName} ({actualLayersUsed}/{layersPerPlate} lớp)
          </h3>
          <div className="text-l text-gray-600">
             Hiệu suất (Tấm này): <span className="font-bold text-primary-600">{plateEfficiency}%</span>
          </div>
        </div>
        
        {/* CHỌN TẤM LIỆU */}
        {platesNeeded > 1 && (
            <div className="mb-3 flex items-center gap-3 overflow-x-auto pb-2">
                <span className="font-medium text-gray-700 flex-shrink-0">Chọn Tấm liệu:</span>
                {categorizedPlates.map((plateMeta, index) => (
                <button
                    key={plateMeta.originalIndex}
                    // Cập nhật selectedPlate bằng index trong mảng categorizedPlates
                    onClick={() => setSelectedPlate(index)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 flex-shrink-0 border ${
                    selectedPlate === index 
                        ? 'bg-primary-600 text-white shadow-md border-primary-600' 
                        : 'bg-white text-gray-700 hover:bg-primary-50 border-gray-300'
                    }`}
                    title={plateMeta.description}
                >
                    {/* Dùng trường type đã được xác định */}
                    {plateMeta.type === 'pure' ? `Thuần ${plateMeta.displayIndex}` : `Hỗn Hợp ${plateMeta.displayIndex}`}
                </button>
                ))}
            </div>
        )}
        
        {/* KHU VỰC HIỂN THỊ */}
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
            {/* Đường lưới */}
            <div className="absolute inset-0 opacity-20">
              {Array.from({length: Math.floor(gridWidth/100)}).map((_, i) => (
                <div 
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-400"
                  style={{ left: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
              {Array.from({length: Math.floor(gridLength/100)}).map((_, i) => (
                <div 
                  key={`h-${i}`}
                  className="absolute left-0 right-0 h-px bg-gray-400"
                  style={{ top: `${(i + 1) * 100 * scale}px` }}
                ></div>
              ))}
            </div>
            
            {/* HIỂN THỊ HÌNH CHỮ NHẬT */}
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
              
              const originalRect = placedRectDetails[rect.typeId] || {};
              
              const originalDims = (originalRect.width && originalRect.length)
                ? `${originalRect.width}×${originalRect.length}mm` 
                : 'Kích thước gốc không xác định';

              const rectName = originalRect.name || `ID ${rect.typeId}`;
              
              // Hiển thị các lớp (layer)
              const opacity = 1 - (rect.layer / layersPerPlate) * 0.4; 
              const zIndex = 10 + (layersPerPlate - rect.layer); 
              
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
                    {/* Hiển thị kích thước đã xoay (nếu có) */}
                    <div className="text-xs">{rect.width}×{rect.length} (L{rect.layer + 1})</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Thông tin hiệu suất tổng thể */}
        <div className="mt-3 flex justify-end">
            <div className="text-sm text-gray-700 font-semibold">
                Hiệu suất tổng thể: <span className="text-xl text-blue-600">{totalEfficiency.toFixed(1)}%</span> 
                <span className="text-gray-500 font-medium ml-2"> (trên {platesNeeded} tấm)</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default PackingResult;