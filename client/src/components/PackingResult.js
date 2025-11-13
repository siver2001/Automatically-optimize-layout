// client/src/components/PackingResult.js
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePacking } from '../context/PackingContext.js';
import DraggableRectangle from './DraggableRectangle.js';
import EditModeControls from './EditModeControls.js';
import RectangleContextMenu from './RectangleContextMenu.js';
import EditModeHelp from './EditModeHelp.js';
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

  // States cho logic mới
  const [pickedUpRect, setPickedUpRect] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState({ x: [], y: [] }); // ← THÊM MỚI
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    targetRect: null
  });

  
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
  
  // Tra cứu thông tin chi tiết
  useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color, width: rect.width, length: rect.length };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);

  // Reset selectedPlate
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
      setPickedUpRect(null);
      setContextMenu({ visible: false });
    } else {
      setEditedRectangles([]);
      setOriginalRectangles([]);
    }
  }, [packingResult, selectedPlate]);

  // === USE EFFECT THEO DÕI CHUỘT ===
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!pickedUpRect || !containerRef.current) return;

      const containerBounds = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerBounds.left;
      const relativeY = e.clientY - containerBounds.top;

      setMousePos({ x: relativeX, y: relativeY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pickedUpRect]);
  
  // === USE EFFECT KEYBOARD - ĐÃ SỬA ===
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isEditMode) return;

      // ESC để hủy bỏ
      if (e.key === 'Escape' && pickedUpRect) {
        e.preventDefault();
        setEditedRectangles(prev => [...prev, pickedUpRect]);
        setPickedUpRect(null);
        return;
      }

      // R để xoay
      if (pickedUpRect && (e.key.toLowerCase() === 'r')) {
        e.preventDefault(); 
        setPickedUpRect(prev => ({
          ...prev,
          width: prev.length,
          length: prev.width,
          rotated: !prev.rotated
        }));
      }

      // Delete để xóa - XỬ LÝ TRỰC TIẾP KHÔNG GỌI HÀM
      if (e.key === 'Delete' && selectedRectIds.length > 0 && !pickedUpRect) {
        e.preventDefault();
        if (window.confirm(`Bạn có chắc muốn xóa ${selectedRectIds.length} hình đã chọn?`)) {
          setEditedRectangles(prev => 
            prev.filter(r => !selectedRectIds.includes(r.id))
          );
          setSelectedRectIds([]);
          setHasUnsavedChanges(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEditMode, pickedUpRect, selectedRectIds]); // ✅ Đã loại bỏ handleDeleteSelected

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

  // --- HÀM XỬ LÝ ---
  const handleToggleEditMode = useCallback(() => {
    if (isEditMode && hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn thoát không?')) {
        setEditedRectangles([...originalRectangles]);
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
        setPickedUpRect(null);
      }
    } else {
      setIsEditMode(!isEditMode);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setContextMenu({ visible: false });
    }
  }, [isEditMode, hasUnsavedChanges, originalRectangles]);

  // Hàm nhấc lên
  const handlePickUpRect = useCallback((clickedRect) => {
    if (!isEditMode || pickedUpRect) return;

    const rectToPickUp = editedRectangles.find(r => r.id === clickedRect.id);
    if (rectToPickUp) {
      setPickedUpRect(rectToPickUp);
      setEditedRectangles(prev => prev.filter(r => r.id !== clickedRect.id));
      setSelectedRectIds([]);
      setContextMenu({ visible: false });
    }
  }, [isEditMode, pickedUpRect, editedRectangles]);

  // === LOGIC ĐẶT XUỐNG VỚI SNAP THÔNG MINH ===
  const handleContainerClick = useCallback((e) => {
    if (!isEditMode || !containerRef.current) return;

    if (contextMenu.visible) {
      setContextMenu({ visible: false });
      return;
    }

    const isClickOnRect = e.target.closest('.rectangle-item');
    if (isClickOnRect) return;

    // ĐANG CẦM HÌNH -> ĐẶT XUỐNG
    if (pickedUpRect) {
      e.stopPropagation();
      
      const containerBounds = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - containerBounds.left;
      const clickY = e.clientY - containerBounds.top;

      let newX = (clickX / visualScale) - (pickedUpRect.width / 2);
      let newY = (clickY / visualScale) - (pickedUpRect.length / 2);

      newX = Math.max(0, Math.min(newX, container.width - pickedUpRect.width));
      newY = Math.max(0, Math.min(newY, container.length - pickedUpRect.length));

      // SNAP THÔNG MINH (ĐÃ SỬA)
      if (snapEnabled && snapThreshold > 0) {
        const threshold = snapThreshold; // Khoảng cách để "dính" (mm)
        const GRID_SIZE = 50; // Grid cố định 50mm
        
        let bestSnapX = null;
        let bestSnapY = null;
        let bestDistX = threshold;
        let bestDistY = threshold;
        
        const guidesX = [];
        const guidesY = [];

        // 1. Snap với CÁC HÌNH KHÁC (ưu tiên cao nhất)
        editedRectangles.forEach(rect => {
          // Snap cạnh trái với cạnh trái
          const distLeftToLeft = Math.abs(newX - rect.x);
          if (distLeftToLeft < bestDistX) {
            bestSnapX = rect.x;
            bestDistX = distLeftToLeft;
          }

          // Snap cạnh trái với cạnh phải (kế bên)
          const distLeftToRight = Math.abs(newX - (rect.x + rect.width));
          if (distLeftToRight < bestDistX) {
            bestSnapX = rect.x + rect.width;
            bestDistX = distLeftToRight;
          }

          // Snap cạnh phải với cạnh phải
          const distRightToRight = Math.abs((newX + pickedUpRect.width) - (rect.x + rect.width));
          if (distRightToRight < bestDistX) {
            bestSnapX = rect.x + rect.width - pickedUpRect.width;
            bestDistX = distRightToRight;
          }

          // Snap cạnh phải với cạnh trái (kế bên)
          const distRightToLeft = Math.abs((newX + pickedUpRect.width) - rect.x);
          if (distRightToLeft < bestDistX) {
            bestSnapX = rect.x - pickedUpRect.width;
            bestDistX = distRightToLeft;
          }

          // Snap trung tâm X
          const rectCenterX = rect.x + rect.width / 2;
          const newCenterX = newX + pickedUpRect.width / 2;
          const distCenterX = Math.abs(newCenterX - rectCenterX);
          if (distCenterX < bestDistX) {
            bestSnapX = rectCenterX - pickedUpRect.width / 2;
            bestDistX = distCenterX;
          }

          // Tương tự cho Y
          const distTopToTop = Math.abs(newY - rect.y);
          if (distTopToTop < bestDistY) {
            bestSnapY = rect.y;
            bestDistY = distTopToTop;
          }

          const distTopToBottom = Math.abs(newY - (rect.y + rect.length));
          if (distTopToBottom < bestDistY) {
            bestSnapY = rect.y + rect.length;
            bestDistY = distTopToBottom;
          }

          const distBottomToBottom = Math.abs((newY + pickedUpRect.length) - (rect.y + rect.length));
          if (distBottomToBottom < bestDistY) {
            bestSnapY = rect.y + rect.length - pickedUpRect.length;
            bestDistY = distBottomToBottom;
          }

          const distBottomToTop = Math.abs((newY + pickedUpRect.length) - rect.y);
          if (distBottomToTop < bestDistY) {
            bestSnapY = rect.y - pickedUpRect.length;
            bestDistY = distBottomToTop;
          }

          const rectCenterY = rect.y + rect.length / 2;
          const newCenterY = newY + pickedUpRect.length / 2;
          const distCenterY = Math.abs(newCenterY - rectCenterY);
          if (distCenterY < bestDistY) {
            bestSnapY = rectCenterY - pickedUpRect.length / 2;
            bestDistY = distCenterY;
          }
        });

        // 2. Snap với CẠNH CONTAINER (ưu tiên thứ 2)
        const distToLeft = Math.abs(newX);
        if (distToLeft < bestDistX) {
          bestSnapX = 0;
          bestDistX = distToLeft;
        }

        const distToRight = Math.abs((newX + pickedUpRect.width) - container.width);
        if (distToRight < bestDistX) {
          bestSnapX = container.width - pickedUpRect.width;
          bestDistX = distToRight;
        }

        const distToTop = Math.abs(newY);
        if (distToTop < bestDistY) {
          bestSnapY = 0;
          bestDistY = distToTop;
        }

        const distToBottom = Math.abs((newY + pickedUpRect.length) - container.length);
        if (distToBottom < bestDistY) {
          bestSnapY = container.length - pickedUpRect.length;
          bestDistY = distToBottom;
        }

        // 3. Snap với GRID (ưu tiên thấp nhất, chỉ khi không snap được gì khác)
        if (bestSnapX === null) {
          const gridSnapX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
          if (Math.abs(newX - gridSnapX) < threshold) {
            bestSnapX = gridSnapX;
          }
        }

        if (bestSnapY === null) {
          const gridSnapY = Math.round(newY / GRID_SIZE) * GRID_SIZE;
          if (Math.abs(newY - gridSnapY) < threshold) {
            bestSnapY = gridSnapY;
          }
        }

        // Áp dụng snap (nếu có)
        if (bestSnapX !== null) {
          newX = bestSnapX;
          guidesX.push(bestSnapX);
        }
        if (bestSnapY !== null) {
          newY = bestSnapY;
          guidesY.push(bestSnapY);
        }

        // Lưu snap guides để hiển thị
        setSnapGuides({ x: guidesX, y: guidesY });

        // Đảm bảo không ra ngoài container sau khi snap
        newX = Math.max(0, Math.min(newX, container.width - pickedUpRect.width));
        newY = Math.max(0, Math.min(newY, container.length - pickedUpRect.length));
      } else {
        setSnapGuides({ x: [], y: [] });
      }

      setEditedRectangles(prev => [
        ...prev,
        { ...pickedUpRect, x: newX, y: newY }
      ]);
      setPickedUpRect(null);
      setHasUnsavedChanges(true);

    } else {
      // BỎ CHỌN
      if (!e.ctrlKey && !e.metaKey) {
        setSelectedRectIds([]);
      }
    }
  }, [isEditMode, pickedUpRect, contextMenu.visible, visualScale, snapEnabled, snapThreshold, editedRectangles, container.width, container.length]);

  const handleDeleteSelected = useCallback((id = null) => {
    const idsToDelete = id ? [id] : selectedRectIds;
    
    if (idsToDelete.length === 0) return;
    
    if (window.confirm(`Bạn có chắc muốn xóa ${idsToDelete.length} hình đã chọn?`)) {
      setEditedRectangles(prev => 
        prev.filter(r => !idsToDelete.includes(r.id))
      );
      setSelectedRectIds([]);
      setHasUnsavedChanges(true);
    }
  }, [selectedRectIds]);

  const handleRotateSelected = useCallback((id = null) => {
    const idsToRotate = id ? [id] : selectedRectIds;
    
    if (idsToRotate.length === 0) return;

    setEditedRectangles(prev => 
      prev.map(r => {
        if (idsToRotate.includes(r.id)) {
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
        setPickedUpRect(null);
      }
    } else {
      setIsEditMode(false);
      setSelectedRectIds([]);
      setPickedUpRect(null);
    }
  }, [hasUnsavedChanges, originalRectangles]);

  const handleContextMenu = (e, rect) => {
    e.preventDefault(); 
    if (!isEditMode || pickedUpRect) return;

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetRect: rect
    });
    setSelectedRectIds([rect.id]);
  };
  
  // --- TÍNH TOÁN ---
  const { layersPerPlate = 1, efficiency: totalEfficiency = 0 } = packingResult || {};
  const platesNeeded = categorizedPlates.length;
  
  const safeIndex = selectedPlate >= platesNeeded ? 0 : selectedPlate;
  const currentPlateMeta = categorizedPlates[safeIndex];
  
  const currentPlateLayers = useMemo(() => {
    if (!packingResult?.plates || !currentPlateMeta) return [];
    const currentPlateData = packingResult.plates[currentPlateMeta.originalIndex];
    return currentPlateData?.layers || [];
  }, [packingResult, currentPlateMeta]);
  
  const displayRectangles = useMemo(() => {
    if (isEditMode) return editedRectangles;
    return currentPlateLayers.flatMap(layer => layer.rectangles?.filter(Boolean) || []);
  }, [isEditMode, editedRectangles, currentPlateLayers]);

  // --- HÀM XUẤT PDF ---
  const handleExportPdf = async () => {
    if (!packingResult || !packingResult.plates || !container || packingResult.plates.length === 0) {
      setExportError('Không có dữ liệu kết quả để xuất.');
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      const { plates } = packingResult;
      const response = await packingService.exportMultiPagePdf(container, plates);
      if (!response.success) {
        setExportError(response.error || 'Lỗi không xác định khi xuất file.');
      }
    } catch (error) {
      console.error('Lỗi handleExportPdf:', error);
      setExportError('Lỗi nghiêm trọng: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  // --- TÍNH TOÁN RENDER ---
  let plateDescription = currentPlateMeta?.description || `Tấm #${currentPlateMeta?.displayIndex || 1}`;
  if (plateDescription) {
    plateDescription = plateDescription.replace(/\|.*?\)/, ')');
  }

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

  
  // --- EARLY RETURNS ---
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

  // --- RETURN JSX ---
  return (
    <div className="mb-4 card p-1 md:p-2">
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

      {isEditMode && <EditModeHelp isVisible={isEditMode} />}
      
      {exportError && (
        <div className="my-2 p-2 bg-red-100 text-red-700 text-sm border border-red-300 rounded">
          <strong>Lỗi xuất PDF:</strong> {exportError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-2 md:p-1 mb-3 md:mb-4">
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
            className="relative border-4 border-gray-900 rounded-lg shadow-inner bg-gray-200 flex-shrink-0 overflow-hidden"
            style={{ 
              maxWidth: '100%',
              width: `${displayWidth}px`, 
              height: `${displayLength}px`,
              minWidth: 'min(300px, 90vw)',
              minHeight: 'min(200px, 40vh)',
              cursor: isEditMode ? (pickedUpRect ? 'crosshair' : 'default') : 'default'
            }}
            onClick={handleContainerClick}
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
                    isSelected={selectedRectIds.includes(rect.id)}
                    onPickUp={handlePickUpRect}
                    onContextMenu={handleContextMenu}
                  />
                );
              }

              // Static display
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
            
            {/* RENDER HÌNH ĐANG CẦM */}
            {pickedUpRect && (
              <>
                {/* Snap guides - CẢI TIẾN */}
                {snapEnabled && (
                  <div className="absolute inset-0 pointer-events-none z-40">
                    {/* Đường snap dọc (X) - MÀU ĐỎ khi đang snap */}
                    {snapGuides.x.map((x, i) => (
                      <div 
                        key={`snap-x-${i}`}
                        className="absolute top-0 bottom-0 w-1 bg-red-500 opacity-70"
                        style={{ left: `${x * scale}px` }}
                      />
                    ))}
                    {/* Đường snap ngang (Y) - MÀU ĐỎ khi đang snap */}
                    {snapGuides.y.map((y, i) => (
                      <div 
                        key={`snap-y-${i}`}
                        className="absolute left-0 right-0 h-1 bg-red-500 opacity-70"
                        style={{ top: `${y * scale}px` }}
                      />
                    ))}
                    
                    {/* Crosshair chuột - MÀU XANH */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-400 opacity-30"
                      style={{ 
                        left: `${mousePos.x}px`,
                        display: mousePos.x > 0 ? 'block' : 'none'
                      }}
                    />
                    <div 
                      className="absolute left-0 right-0 h-0.5 bg-blue-400 opacity-30"
                      style={{ 
                        top: `${mousePos.y}px`,
                        display: mousePos.y > 0 ? 'block' : 'none'
                      }}
                    />
                  </div>
                )}
                
                {/* Hình đang được cầm */}
                <div
                  className="absolute border-4 border-dashed border-blue-500 bg-opacity-70 z-50 flex items-center justify-center text-white font-bold shadow-2xl animate-pulse"
                  style={{
                    left: `${mousePos.x - (isLandscape ? pickedUpRect.length * scale / 2 : pickedUpRect.width * scale / 2)}px`,
                    top: `${mousePos.y - (isLandscape ? pickedUpRect.width * scale / 2 : pickedUpRect.length * scale / 2)}px`,
                    width: `${isLandscape ? pickedUpRect.length * scale : pickedUpRect.width * scale}px`,
                    height: `${isLandscape ? pickedUpRect.width * scale : pickedUpRect.length * scale}px`,
                    backgroundColor: pickedUpRect.color,
                    pointerEvents: 'none',
                    transform: snapGuides.x.length > 0 || snapGuides.y.length > 0 ? 'scale(1.08)' : 'scale(1.05)'
                  }}
                >
                  <div className="text-sm font-bold bg-black bg-opacity-50 px-2 py-1 rounded">
                    {pickedUpRect.width}×{pickedUpRect.length}
                    <div className="text-xs opacity-75">
                      R để xoay | ESC hủy
                      {(snapGuides.x.length > 0 || snapGuides.y.length > 0) && <span className="text-red-300"> | SNAPPED!</span>}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="mt-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            <span className="text-gray-500 font-medium">Tổng cộng {totalLayersUsed} lớp</span>
          </div>
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            Hiệu suất tổng thể: <span className="text-base md:text-xl text-blue-600">{totalEfficiency.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* CONTEXT MENU */}
      <RectangleContextMenu
        menu={{ ...contextMenu, onClose: () => setContextMenu({ visible: false }) }}
        onRotate={handleRotateSelected}
        onDelete={handleDeleteSelected}
      />
    </div>
  );
};

export default PackingResult;