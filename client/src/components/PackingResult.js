// client/src/components/PackingResult.js - (Đã sửa lỗi)
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePacking } from '../context/PackingContext.js';
import DraggableRectangle from './DraggableRectangle.js';
import EditModeControls from './EditModeControls.js';
import { packingService } from '../services/packingService.js';

const PackingResult = () => {
  const { packingResult, isOptimizing, container, rectangles } = usePacking();
  
  const [selectedPlate, setSelectedPlate] = useState(0);
  const [placedRectDetails, setPlacedRectDetails] = useState({});
  const [visualScale, setVisualScale] = useState(1);
  
  // Edit Mode States
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedRectangles, setEditedRectangles] = useState([]);
  const [selectedRectIds, setSelectedRectIds] = useState([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapThreshold, setSnapThreshold] = useState(10);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalRectangles, setOriginalRectangles] = useState([]);
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const containerRef = useRef(null);
  const [containerBounds, setContainerBounds] = useState(null);

  // Update container bounds
  useEffect(() => {
    if (containerRef.current) {
      const bounds = containerRef.current.getBoundingClientRect();
      setContainerBounds(bounds);
    }
    const handleResize = () => {
      if (containerRef.current) {
        const bounds = containerRef.current.getBoundingClientRect();
        setContainerBounds(bounds);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Update scale on resize
  useEffect(() => {
    const updateScale = () => {
      const containerWidth = container.width || 600;
      const containerLength = container.length || 500;
      const isLandscape = containerWidth > containerLength;
      const vizWidth = isLandscape ? containerWidth : containerLength;
      const vizLength = isLandscape ? containerLength : containerWidth;

      const screenWidth = window.innerWidth;
      let maxVisualWidth, maxVisualLength;
      
      if (screenWidth >= 1920) {
        maxVisualWidth = screenWidth * 0.52;
        maxVisualLength = window.innerHeight * 0.65;
      } else if (screenWidth >= 1536) {
        maxVisualWidth = screenWidth * 0.50;
        maxVisualLength = window.innerHeight * 0.62;
      } else if (screenWidth >= 1280) {
        maxVisualWidth = screenWidth * 0.48;
        maxVisualLength = window.innerHeight * 0.58;
      } else {
        maxVisualWidth = screenWidth * 0.46;
        maxVisualLength = window.innerHeight * 0.55;
      }
      
      const scale = Math.min(maxVisualWidth / vizWidth, maxVisualLength / vizLength);
      setVisualScale(scale);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [container.width, container.length]);
  
  // Tra cứu thông tin chi tiết (màu sắc, tên)
  useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color, width: rect.width, length: rect.length };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);

  // Reset selectedPlate nếu packingResult thay đổi
  useEffect(() => {
    if (packingResult?.plates?.length > 0 && selectedPlate >= packingResult.plates.length) {
      setSelectedPlate(0);
    }
  }, [packingResult, selectedPlate]);

  // Khởi tạo state chỉnh sửa
  useEffect(() => {
    if (packingResult?.plates && packingResult.plates.length > 0) {
      const safeIndex = Math.max(0, Math.min(selectedPlate, packingResult.plates.length - 1));
      const currentPlate = packingResult.plates[safeIndex];
      
      if (currentPlate && currentPlate.layers) {
        const rects = currentPlate.layers.flatMap(layer => layer.rectangles.filter(Boolean));
        setEditedRectangles(rects.map(r => ({...r})));
        setOriginalRectangles(rects.map(r => ({...r})));
      } else {
        setEditedRectangles([]);
        setOriginalRectangles([]);
      }
      setHasUnsavedChanges(false);
      setIsEditMode(false);
      setSelectedRectIds([]);
    } else {
      setEditedRectangles([]);
      setOriginalRectangles([]);
    }
  }, [packingResult, selectedPlate]);
  
  // Ghi nhớ danh sách tấm liệu
  const categorizedPlates = useMemo(() => {
    if (!packingResult?.plates) return [];
    const pure = [];
    const mixed = [];
    packingResult.plates.forEach((plate, index) => {
      const type = plate.type || (plate.description && plate.description.startsWith('Tấm thuần') ? 'pure' : 'mixed');
      if (type === 'pure') {
        pure.push({ ...plate, originalIndex: index, displayIndex: pure.length + 1, type });
      } else {
        mixed.push({ ...plate, originalIndex: index, displayIndex: mixed.length + 1, type });
      }
    });
    return [...pure, ...mixed];
  }, [packingResult]);

  // Ghi nhớ tổng số lớp
  const totalLayersUsed = useMemo(() => {
    if (!packingResult?.plates) return 0;
    return packingResult.plates.reduce((sum, plate) => {
      return sum + (plate.layers ? plate.layers.length : 0);
    }, 0);
  }, [packingResult]);

  // --- Các hàm xử lý (Handlers) ---
  const handleToggleEditMode = useCallback(() => {
    if (isEditMode && hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn thoát không?')) {
        setEditedRectangles([...originalRectangles]);
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
      }
    } else {
      setIsEditMode(!isEditMode);
      setSelectedRectIds([]);
    }
  }, [isEditMode, hasUnsavedChanges, originalRectangles]);

  const handleSelectRectangle = useCallback((id, addToSelection = false) => {
    if (!isEditMode) return;
    setSelectedRectIds(prev => {
      if (addToSelection) {
        return prev.includes(id) ? prev.filter(rid => rid !== id) : [...prev, id];
      }
      return [id];
    });
  }, [isEditMode]);

  const handleDragRectangle = useCallback((updatedRect) => {
    setEditedRectangles(prev => 
      prev.map(r => r.id === updatedRect.id ? updatedRect : r)
    );
    setHasUnsavedChanges(true);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedRectIds.length === 0) return;
    if (window.confirm(`Bạn có chắc muốn xóa ${selectedRectIds.length} hình đã chọn?`)) {
      setEditedRectangles(prev => 
        prev.filter(r => !selectedRectIds.includes(r.id))
      );
      setSelectedRectIds([]);
      setHasUnsavedChanges(true);
    }
  }, [selectedRectIds]);

  const handleRotateSelected = useCallback(() => {
    if (selectedRectIds.length === 0) return;
    setEditedRectangles(prev => 
      prev.map(r => {
        if (selectedRectIds.includes(r.id)) {
          return { ...r, width: r.length, length: r.width, rotated: !r.rotated };
        }
        return r;
      })
    );
    setHasUnsavedChanges(true);
  }, [selectedRectIds]);

  const handleAlignSelected = useCallback((alignType) => {
    if (selectedRectIds.length < 2) return;
    const selectedRects = editedRectangles.filter(r => selectedRectIds.includes(r.id));
    setEditedRectangles(prev => {
      const updated = [...prev];
      if (alignType === 'left') {
        const minX = Math.min(...selectedRects.map(r => r.x));
        selectedRects.forEach(r => {
          const idx = updated.findIndex(ur => ur.id === r.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], x: minX };
        });
      } else if (alignType === 'top') {
        const minY = Math.min(...selectedRects.map(r => r.y));
        selectedRects.forEach(r => {
          const idx = updated.findIndex(ur => ur.id === r.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], y: minY };
        });
      } else if (alignType === 'center') {
        const avgX = selectedRects.reduce((sum, r) => sum + r.x + r.width / 2, 0) / selectedRects.length;
        selectedRects.forEach(r => {
          const idx = updated.findIndex(ur => ur.id === r.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], x: avgX - r.width / 2 };
        });
      }
      return updated;
    });
    setHasUnsavedChanges(true);
  }, [selectedRectIds, editedRectangles]);

  const handleSaveChanges = useCallback(() => {
    setOriginalRectangles([...editedRectangles]);
    setHasUnsavedChanges(false);
    alert('Đã lưu thay đổi thành công!');
  }, [editedRectangles]);

  const handleCancelEdit = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn hủy không?')) {
        setEditedRectangles([...originalRectangles]);
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
      }
    } else {
      setIsEditMode(false);
      setSelectedRectIds([]);
    }
  }, [hasUnsavedChanges, originalRectangles]);

  // Click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isEditMode && containerRef.current && !e.target.closest('.rectangle-item')) {
        if (!e.ctrlKey && !e.metaKey) {
          setSelectedRectIds([]);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditMode]);

  // --- TÍNH TOÁN CÁC BIẾN LOGIC TRƯỚC KHI RENDER ---
  const { layersPerPlate = 1, efficiency: totalEfficiency = 0 } = packingResult || {};
  const platesNeeded = categorizedPlates.length;
  
  const safeIndex = selectedPlate >= platesNeeded ? 0 : selectedPlate;
  const currentPlateMeta = categorizedPlates[safeIndex];
  
  // Sử dụng useMemo để tránh re-render không cần thiết
  const currentPlateLayers = useMemo(() => {
    if (!packingResult?.plates || !currentPlateMeta) return [];
    const currentPlateData = packingResult.plates[currentPlateMeta.originalIndex];
    return currentPlateData?.layers || [];
  }, [packingResult, currentPlateMeta]);
  
  // Danh sách hình chữ nhật cuối cùng để render
  const displayRectangles = useMemo(() => {
    if (isEditMode) return editedRectangles;
    return currentPlateLayers.flatMap(layer => layer.rectangles?.filter(Boolean) || []);
  }, [isEditMode, editedRectangles, currentPlateLayers]);

  // --- HÀM XUẤT PDF ---
  const handleExportPdf = async () => {
    // 1. Kiểm tra xem có 'packingResult' không
    // (packingResult này đến từ hook 'usePacking' của bạn)
    if (!packingResult || !packingResult.plates || !container || packingResult.plates.length === 0) {
      setExportError('Không có dữ liệu kết quả để xuất.');
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      // 2. Lấy 'container' và 'allLayouts' từ kết quả
      const { plates } = packingResult;
      
      // 3. Truyền "container" (từ hook) và "plates" (từ packingResult)
      const response = await packingService.exportMultiPagePdf(container, plates);

      if (!response.success) {
        setExportError(response.error || 'Lỗi không xác định khi xuất file.');
      }
      // Nếu success thì file đã tự động tải về

    } catch (error) {
      console.error('Lỗi handleExportPdf:', error);
      setExportError('Lỗi nghiêm trọng: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  // --- TÍNH TOÁN CÁC BIẾN ĐỂ RENDER ---
  const plateType = currentPlateMeta?.type === 'pure' ? 'Thuần' : 'Hỗn Hợp';
  const plateDescription = currentPlateMeta?.description || `${plateType} #${currentPlateMeta?.displayIndex || 1}`;

  const singleLayerArea = container.width * container.length;
  const actualLayersUsed = currentPlateLayers.length;
  const totalPlateArea = singleLayerArea * actualLayersUsed;

  const plateUsedArea = displayRectangles.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
  const plateEfficiency = totalPlateArea > 0 ? (plateUsedArea / totalPlateArea * 100).toFixed(1) : 0;

  const containerWidth = container.width;
  const containerLength = container.length;
  const isLandscape = containerWidth > containerLength;
  const vizWidth = isLandscape ? containerWidth : containerLength;
  const vizLength = isLandscape ? containerLength : containerWidth;
  const scale = visualScale;
  const displayWidth = vizWidth * scale;
  const displayLength = vizLength * scale;
  const gridWidth = isLandscape ? container.width : container.length;
  const gridLength = isLandscape ? container.length : container.width;

  // --- Early Returns (PHẢI ĐẶT SAU TẤT CẢ HOOKS) ---
  if (isOptimizing) {
    return (
      <div className="mb-4 card p-6 md:p-8 min-h-[300px] md:min-h-[400px] flex flex-col justify-center items-center">
        <div className="text-center">
          <div className="animate-spin-slow text-4xl md:text-6xl mb-4 md:mb-6 text-primary-500">⚙️</div>
          <p className="text-lg md:text-xl font-semibold text-gray-800 mb-2">Đang chạy thuật toán tối ưu</p>
          <p className="text-sm md:text-base text-gray-600">Vui lòng chờ trong giây lát...</p>
        </div>
      </div>
    );
  }

  if (!packingResult || !packingResult.plates || packingResult.plates.length === 0) {
    return (
      <div className="mb-4 card p-6 md:p-8 min-h-[300px] md:min-h-[400px] flex flex-col justify-center items-center">
        <h2 className="text-gray-800 text-xl md:text-2xl font-semibold mb-4 md:mb-6">
          📊 Kết quả sắp xếp
        </h2>
        <div className="text-center text-gray-500">
          <div className="text-4xl md:text-6xl mb-4">📦</div>
          <p className="text-lg md:text-xl font-semibold text-gray-700 mb-2">Chưa có kết quả sắp xếp</p>
          <p className="text-sm md:text-base text-gray-500">Nhập thông số tấm liệu và chọn size để bắt đầu tối ưu</p>
        </div>
      </div>
    );
  }

  if (!currentPlateMeta) {
    return (
      <div className="mb-4 card p-6 text-center text-red-600">
        Lỗi: Không tìm thấy thông tin tấm liệu
      </div>
    );
  }

  // --- LỆNH RETURN JSX CUỐI CÙNG ---
  return (
    <div className="mb-4 card p-1 md:p-4">
      {/* Edit Mode Controls */}
      <EditModeControls
        isEditMode={isEditMode}
        onToggleEditMode={handleToggleEditMode}
        selectedRectangles={selectedRectIds}
        onDeleteSelected={handleDeleteSelected}
        onRotateSelected={handleRotateSelected}
        onAlignSelected={handleAlignSelected}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        snapThreshold={snapThreshold}
        onSnapThresholdChange={setSnapThreshold}
        onSaveChanges={handleSaveChanges}
        onCancelEdit={handleCancelEdit}
        hasUnsavedChanges={hasUnsavedChanges}
        onExportAllPdf={handleExportPdf}
        isExporting={isExporting}
        totalPlates={platesNeeded}
      />
      {exportError && (
        <div className="my-2 p-2 bg-red-100 text-red-700 text-sm border border-red-300 rounded">
          <strong>Lỗi xuất PDF:</strong> {exportError}
        </div>
      )}
      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-2 md:p-3 mb-3 md:mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 border-b pb-2 gap-2">
          <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-800" title={currentPlateMeta.description}>
            {plateDescription} ({actualLayersUsed}/{layersPerPlate} lớp)
          </h3>
          <div className="text-xs md:text-sm lg:text-base text-gray-600">
            Hiệu suất (Tấm này): <span className="font-bold text-primary-600">{plateEfficiency}%</span>
          </div>
        </div>
        
        {platesNeeded > 1 && (
          <div className="mb-3 flex items-center gap-2 md:gap-3 overflow-x-auto pb-2">
            <span className="font-medium text-gray-700 flex-shrink-0 text-xs md:text-sm">Chọn Tấm liệu:</span>
            {categorizedPlates.map((plateMeta, index) => (
              <button
                key={plateMeta.originalIndex}
                onClick={() => setSelectedPlate(index)}
                className={`px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium transition-all duration-200 flex-shrink-0 border ${
                  selectedPlate === index 
                    ? 'bg-primary-600 text-white shadow-md border-primary-600' 
                    : 'bg-white text-gray-700 hover:bg-primary-50 border-gray-300'
                }`}
                title={plateMeta.description}
              >
                {plateMeta.type === 'pure' ? `Thuần ${plateMeta.displayIndex}` : `Hỗn Hợp ${plateMeta.displayIndex}`}
              </button>
            ))}
          </div>
        )}
        
        <div className="flex justify-center p-2 overflow-x-auto overflow-y-auto">
          <div 
            ref={containerRef}
            className="relative border-4 border-gray-900 rounded-lg shadow-inner bg-gray-200 flex-shrink-0"
            style={{ 
              maxWidth: '100%',
              width: `${displayWidth}px`, 
              height: `${displayLength}px`,
              minWidth: 'min(300px, 90vw)',
              minHeight: 'min(200px, 40vh)'
            }}
          >
            {/* Grid */}
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
            
            {/* Rectangles */}
            {displayRectangles.map((rect) => {
              if (!rect || typeof rect.width !== 'number' || typeof rect.length !== 'number') {
                return null;
              }

              if (isEditMode) {
                return (
                  <DraggableRectangle
                    key={rect.id}
                    rect={rect}
                    scale={scale}
                    isLandscape={isLandscape}
                    onDrag={handleDragRectangle}
                    snapEnabled={snapEnabled}
                    snapThreshold={snapThreshold}
                    isSelected={selectedRectIds.includes(rect.id)}
                    onSelect={(id) => handleSelectRectangle(id, window.event?.ctrlKey || window.event?.metaKey)}
                    containerBounds={containerBounds}
                    allRectangles={displayRectangles}
                  />
                );
              }

              // Static display (non-edit mode)
              const rectWidth = rect.width * scale;
              const rectLength = rect.length * scale;
              const rectX = isLandscape ? rect.x * scale : rect.y * scale;
              const rectY = isLandscape ? rect.y * scale : rect.x * scale;
              const finalWidth = isLandscape ? rectWidth : rectLength;
              const finalLength = isLandscape ? rectLength : rectWidth;
              const minDim = Math.min(finalWidth, finalLength);
              const fontSize = Math.max(8, Math.min(16, minDim * 0.15));
              const originalRect = placedRectDetails[rect.typeId] || {};
              const originalDims = (originalRect.width && originalRect.length)
                ? `${originalRect.width}×${originalRect.length}mm` 
                : 'Kích thước gốc không xác định';
              const rectName = originalRect.name || `ID ${rect.typeId}`;
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
                    backgroundColor: rect.color || (placedRectDetails[rect.typeId]?.color),
                    fontSize: `${fontSize}px`,
                    minWidth: '20px',
                    minHeight: '15px',
                    overflow: 'hidden',
                    opacity: opacity,
                    zIndex: zIndex
                  }}
                  title={`[Tấm ${rect.plateIndex + 1}, Lớp ${rect.layer + 1}] ${rectName} (${originalDims}) tại X:${rect.x} Y:${rect.y} ${rect.rotated ? '(Xoay 90°)' : ''}`}
                >
                  <div className="text-[0.65em] md:text-xs">{rect.width}×{rect.length}</div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="mt-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            <span className="text-gray-500 font-medium">Tổng cộng {totalLayersUsed} lớp</span>
          </div>
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            Hiệu suất tổng thể: <span className="text-base md:text-xl text-blue-600">{totalEfficiency.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PackingResult;