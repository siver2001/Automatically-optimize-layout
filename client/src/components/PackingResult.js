// client/src/components/PackingResult.js
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePacking } from '../context/PackingContext.js';
import DraggableRectangle from './DraggableRectangle.js';
import EditModeControls from './EditModeControls.js';
import RectangleContextMenu from './RectangleContextMenu.js';
import HelpModal from './HelpModal.js';
import { packingService } from '../services/packingService.js';


// (Component này dùng để hiển thị các item vừa mới xóa, chưa lưu)
const SessionUnplacedItem = ({ rectInstance, details, onPickUp, isDisabled }) => {
  const rectType = details[rectInstance.typeId] || {};
  const name = rectType.name || `ID ${rectInstance.typeId}`;
  const color = rectInstance.color || rectType.color || '#3498db';

  const handleClick = () => {
    if (!isDisabled) {
      onPickUp(rectInstance);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className="w-full flex items-center p-2 rounded-md border bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      title={isDisabled ? "Bạn đang cầm một hình khác" : `Nhấc lại ${name} (${rectInstance.width}x${rectInstance.length})`}
    >
      <div
        className="w-8 h-6 rounded-sm border border-gray-400 flex-shrink-0"
        style={{ backgroundColor: color }}
      ></div>
      <div className="ml-3 text-left min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
        <div className="text-xs text-gray-500">
          {rectInstance.width} × {rectInstance.length} {rectInstance.rotated && '(xoay)'}
        </div>
      </div>
    </button>
  );
};

// --- Component: Hiển thị item trong Kho Hàng Tồn (Global) ---
// (Component này hiển thị item đã nhóm theo SỐ LƯỢNG)
const GroupedInventoryItem = ({ item, onPickUp, isDisabled }) => {
  const { details, instances } = item;
  const quantity = instances.length;
  
  // Ẩn nếu không còn hàng
  if (quantity === 0) return null; 

  const rectInstance = instances[0]; // Lấy 1 item mẫu để hiển thị
  const name = details.name || `ID ${rectInstance.typeId}`;
  const color = rectInstance.color || details.color || '#3498db';

  const handleClick = () => {
    if (!isDisabled) {
      onPickUp(rectInstance.typeId); // Nhấc theo typeId
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className="w-full flex items-center p-2 rounded-md border bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      title={isDisabled ? "Bạn đang cầm một hình khác" : `Nhấc 1 ${name} (${rectInstance.width}x${rectInstance.length})`}
    >
      <div
        className="w-8 h-6 rounded-sm border border-gray-400 flex-shrink-0"
        style={{ backgroundColor: color }}
      ></div>
      <div className="ml-3 text-left min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
        <div className="text-xs text-gray-500">
          {rectInstance.width} × {rectInstance.length}
        </div>
      </div>
      {/* Badge Số Lượng */}
      <div className="ml-2 flex-shrink-0 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
        {quantity}
      </div>
    </button>
  );
};

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
  const [sessionUnplacedRects, setSessionUnplacedRects] = useState([]);

  const [globalInventory, setGlobalInventory] = useState(new Map());
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const containerRef = useRef(null);

  const mainAreaRef = useRef(null);

  // States cho logic mới
  const [pickedUpRect, setPickedUpRect] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState({ x: [], y: [] });
  const [ghostRectPosition_data, setGhostRectPosition_data] = useState(null); 
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    targetRect: null
  });

  // ✅ SỬA 2: Thêm state cho panel "Kho đã gỡ"
  const [isUnplacedPanelOpen, setIsUnplacedPanelOpen] = useState(true);

  const [pickUpOrigin, setPickUpOrigin] =useState(null); 
  const [editablePlates, setEditablePlates] = useState([]);
  useEffect(() => {
    if (packingResult?.plates) {
      // Deep copy các tấm liệu để đảm bảo không bị tham chiếu
      const deepCopiedPlates = packingResult.plates.map((plate, index) => ({
        ...plate,
        originalIndex: index, // Thêm originalIndex để truy vết
        layers: plate.layers.map(layer => ({
          ...layer,
          rectangles: layer.rectangles.filter(Boolean).map(r => ({ ...r }))
        }))
      }));
      setEditablePlates(deepCopiedPlates);
    } else {
      setEditablePlates([]);
    }
  }, [packingResult]); // Chỉ chạy khi packingResult (từ context) thay đổi

  // --- TÍNH TOÁN RENDER (Chuyển lên đầu để dùng chung) ---
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
  
  useEffect(() => {
    const updateScale = () => {
      if (!vizWidth || !vizLength) return;

      let maxVisualWidth, maxVisualLength;
      const screenWidth = window.innerWidth;
      
      // ✅ LOGIC MỚI:
      // 1. Nếu đang ở chế độ CHỈNH SỬA VÀ có ref
      if (isEditMode && mainAreaRef.current) {
        // Đo chiều rộng THỰC TẾ của cột 'flex-1'
        const availableWidth = mainAreaRef.current.clientWidth;
        
        // Nếu DOM chưa paint (width=0), tạm dừng
        if (availableWidth === 0) return;

        maxVisualWidth = availableWidth * 0.95; // 95% của cột 'flex-1'
        maxVisualLength = window.innerHeight * 0.65; // Giữ nguyên

      } else {
        // 2. Nếu ở chế độ XEM (gốc)
        // Sử dụng logic GỐC của bạn
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
      }
      
      const newScale = Math.min(maxVisualWidth / vizWidth, maxVisualLength / vizLength);
      setVisualScale(newScale);
    };
    
    // Dùng setTimeout để đảm bảo React đã render xong layout
    // (đổi từ w-full sang flex-1) TRƯỚC KHI chúng ta đo.
    const timerId = setTimeout(updateScale, 50); 
    
    window.addEventListener('resize', updateScale);
    
    return () => {
        clearTimeout(timerId);
        window.removeEventListener('resize', updateScale);
    }
  }, [
      container.width, 
      container.length, 
      vizWidth, 
      vizLength, 
      isEditMode, // Chạy lại khi BẬT/TẮT chế độ
      isUnplacedPanelOpen // Chạy lại khi ẨN/HIỆN kho
  ]);
  
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

  // Ghi nhớ danh sách tấm liệu
  // (Không đổi, nhưng categorizedPlates giờ sẽ được dùng để tìm index)
  const categorizedPlates = useMemo(() => {
    if (!packingResult?.plates) return [];
    const pure = [];
    const mixed = [];
    // QUAN TRỌNG: Dùng 'editablePlates' hoặc 'packingResult' đều được
    // miễn là 'originalIndex' được gán đúng
    packingResult.plates.forEach((plate, index) => {
      const type = plate.type || (plate.description && plate.description.startsWith('Tấm thuần') ? 'pure' : 'mixed');
      if (type === 'pure') {
        pure.push({ ...plate, originalIndex: index, displayIndex: pure.length + 1, type });
      } else {
        mixed.push({ ...plate, originalIndex: index, displayIndex: mixed.length + 1, type });
      }
    });
    return [...pure, ...mixed];
  }, [packingResult]); // Giữ nguyên dependency này

  useEffect(() => {
    if (editablePlates.length > 0 && categorizedPlates.length > 0) {
      const safeIndex = Math.max(0, Math.min(selectedPlate, categorizedPlates.length - 1));
      const currentPlateMeta = categorizedPlates[safeIndex];
      const currentPlateData = editablePlates.find(p => p.originalIndex === currentPlateMeta.originalIndex);

      if (currentPlateData && currentPlateData.layers) {
        const rects = currentPlateData.layers.flatMap(layer => layer.rectangles.filter(Boolean));
        setEditedRectangles(rects.map(r => ({...r})));
        setOriginalRectangles(rects.map(r => ({...r})));
      } else {
        setEditedRectangles([]);
        setOriginalRectangles([]);
      }
      
      // CHỈ reset kho tạm (session)
      setSessionUnplacedRects([]); 
      
      setHasUnsavedChanges(false);
      setIsEditMode(false);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setContextMenu({ visible: false });
    } else {
      setEditedRectangles([]);
      setOriginalRectangles([]);
    }
  }, [editablePlates, selectedPlate, categorizedPlates]);


  // [NÂNG CẤP 2] Tách logic snap ra hàm riêng (Không đổi)
  const calculateSnapPosition = useCallback((
    idealDataX,
    idealDataY,
    rectToSnap,
    allRects,
    container,
    snapEnabled,
    snapThreshold
  ) => {
    let newX = idealDataX;
    let newY = idealDataY;
    const guidesX = [];
    const guidesY = [];

    if (!snapEnabled || snapThreshold <= 0) {
      newX = Math.max(0, Math.min(newX, container.width - rectToSnap.width));
      newY = Math.max(0, Math.min(newY, container.length - rectToSnap.length));
      return { snappedX: newX, snappedY: newY, guidesX, guidesY };
    }
    
    const threshold = snapThreshold;
    const GRID_SIZE = 50; 
    
    let bestSnapX = null;
    let bestSnapY = null;
    let bestDistX = threshold;
    let bestDistY = threshold;

    // 1. Snap với CÁC HÌNH KHÁC
    allRects.forEach(rect => {
      const distLeftToLeft = Math.abs(newX - rect.x);
      if (distLeftToLeft < bestDistX) {
        bestSnapX = rect.x;
        bestDistX = distLeftToLeft;
      }
      const distLeftToRight = Math.abs(newX - (rect.x + rect.width));
      if (distLeftToRight < bestDistX) {
        bestSnapX = rect.x + rect.width;
        bestDistX = distLeftToRight;
      }
      const distRightToRight = Math.abs((newX + rectToSnap.width) - (rect.x + rect.width));
      if (distRightToRight < bestDistX) {
        bestSnapX = rect.x + rect.width - rectToSnap.width;
        bestDistX = distRightToRight;
      }
      const distRightToLeft = Math.abs((newX + rectToSnap.width) - rect.x);
      if (distRightToLeft < bestDistX) {
        bestSnapX = rect.x - rectToSnap.width;
        bestDistX = distRightToLeft;
      }
      const rectCenterX = rect.x + rect.width / 2;
      const newCenterX = newX + rectToSnap.width / 2;
      const distCenterX = Math.abs(newCenterX - rectCenterX);
      if (distCenterX < bestDistX) {
        bestSnapX = rectCenterX - rectToSnap.width / 2;
        bestDistX = distCenterX;
      }
      
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
      const distBottomToBottom = Math.abs((newY + rectToSnap.length) - (rect.y + rect.length));
      if (distBottomToBottom < bestDistY) {
        bestSnapY = rect.y + rect.length - rectToSnap.length;
        bestDistY = distBottomToBottom;
      }
      const distBottomToTop = Math.abs((newY + rectToSnap.length) - rect.y);
      if (distBottomToTop < bestDistY) {
        bestSnapY = rect.y - rectToSnap.length;
        bestDistY = distBottomToTop;
      }
      const rectCenterY = rect.y + rect.length / 2;
      const newCenterY = newY + rectToSnap.length / 2;
      const distCenterY = Math.abs(newCenterY - rectCenterY);
      if (distCenterY < bestDistY) {
        bestSnapY = rectCenterY - rectToSnap.length / 2;
        bestDistY = distCenterY;
      }
    });

    // 2. Snap với CẠNH CONTAINER
    const distToLeft = Math.abs(newX);
    if (distToLeft < bestDistX) {
      bestSnapX = 0;
      bestDistX = distToLeft;
    }
    const distToRight = Math.abs((newX + rectToSnap.width) - container.width);
    if (distToRight < bestDistX) {
      bestSnapX = container.width - rectToSnap.width;
      bestDistX = distToRight;
    }
    const distToTop = Math.abs(newY);
    if (distToTop < bestDistY) {
      bestSnapY = 0;
      bestDistY = distToTop;
    }
    const distToBottom = Math.abs((newY + rectToSnap.length) - container.length);
    if (distToBottom < bestDistY) {
      bestSnapY = container.length - rectToSnap.length;
      bestDistY = distToBottom;
    }

    // 3. Snap với GRID
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

    // Đảm bảo không ra ngoài container sau khi snap
    newX = Math.max(0, Math.min(newX, container.width - rectToSnap.width));
    newY = Math.max(0, Math.min(newY, container.length - rectToSnap.length));
    
    return { snappedX: newX, snappedY: newY, guidesX, guidesY };
  }, []); 


  // [NÂNG CẤP 3] Cập nhật useEffect để tính snap KHI DI CHUỘT (Không đổi)
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!pickedUpRect || !containerRef.current) return;

      const containerBounds = containerRef.current.getBoundingClientRect();
      const relativeX_visual = e.clientX - containerBounds.left;
      const relativeY_visual = e.clientY - containerBounds.top;
      
      setMousePos({ x: relativeX_visual, y: relativeY_visual });

      const clickX_unscaled_visual = relativeX_visual / visualScale;
      const clickY_unscaled_visual = relativeY_visual / visualScale;
      const dataMouseX = isLandscape ? clickX_unscaled_visual : clickY_unscaled_visual;
      const dataMouseY = isLandscape ? clickY_unscaled_visual : clickX_unscaled_visual;

      const idealDataX = dataMouseX - (pickedUpRect.width / 2);
      const idealDataY = dataMouseY - (pickedUpRect.length / 2);
      
      const { snappedX, snappedY, guidesX, guidesY } = calculateSnapPosition(
        idealDataX,
        idealDataY,
        pickedUpRect,
        editedRectangles,
        container,
        snapEnabled,
        snapThreshold
      );

      setSnapGuides({ x: guidesX, y: guidesY });
      setGhostRectPosition_data({ x: snappedX, y: snappedY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pickedUpRect, visualScale, isLandscape, calculateSnapPosition, editedRectangles, container, snapEnabled, snapThreshold]);

  // ✅ CẬP NHẬT: Xóa hình và chuyển vào kho TẠM (session)
  const handleDeleteSelected = useCallback((id = null) => {
    
    // Ưu tiên 1: Xóa hình đang "cầm"
    if (pickedUpRect && id === null) {
      if (window.confirm(`Bạn có chắc muốn gỡ hình đang cầm? (Nó sẽ được chuyển vào kho 'Hình đã gỡ')`)) {
        // Chuyển nó vào kho TẠM
        setSessionUnplacedRects(prev => [...prev, pickedUpRect]);
        setPickedUpRect(null);
        setPickUpOrigin(null);
        setGhostRectPosition_data(null);
        setSnapGuides({ x: [], y: [] });
        setHasUnsavedChanges(true);
      }
      return;
    }

    // Ưu tiên 2: Xóa hình được chọn
    const finalId = (typeof id === 'object' && id !== null) ? null : id;
    const idsToDelete = finalId ? [finalId] : selectedRectIds;
    
    const warningMessage = idsToDelete.length === 1
      ? 'Bạn có chắc xoá size này chứ?'
      : `Bạn có chắc xoá ${idsToDelete.length} size này chứ?`;

    if (window.confirm(warningMessage)) {
      
      const rectsToUnplace = editedRectangles.filter(r => idsToDelete.includes(r.id));
      // Chuyển vào kho TẠM
      setSessionUnplacedRects(prev => [...prev, ...rectsToUnplace]);

      // BƯỚC 2: XÓA KHỎI TẤM LIỆU (Đây là dòng mấu chốt)
      setEditedRectangles(prev => 
        prev.filter(r => !idsToDelete.includes(r.id))
      );
      
      setSelectedRectIds([]);
      setHasUnsavedChanges(true);
    }
  }, [selectedRectIds, editedRectangles, pickedUpRect]);

  // === USE EFFECT KEYBOARD ===
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isEditMode) return;

      if (e.key === 'Escape' && pickedUpRect) {
        e.preventDefault();
        
        // Trả hình về nơi nó được nhấc lên
        if (pickUpOrigin === 'board') {
          setEditedRectangles(prev => [...prev, pickedUpRect]);
        
        } else if (pickUpOrigin === 'unplaced-session') {
          // Trả lại vào kho TẠM
          setSessionUnplacedRects(prev => [...prev, pickedUpRect]);
        
        } else if (pickUpOrigin === 'unplaced-global') {
          // Trả lại vào kho GLOBAL
          setGlobalInventory(prevInventory => {
            const newInventory = new Map(prevInventory);
            const typeId = pickedUpRect.typeId;
            if (!newInventory.has(typeId)) {
              newInventory.set(typeId, {
                details: placedRectDetails[typeId] || { name: `ID ${typeId}` },
                instances: []
              });
            }
            newInventory.get(typeId).instances.push(pickedUpRect);
            return newInventory;
          });
        }
        
        setPickedUpRect(null);
        setPickUpOrigin(null);
        setGhostRectPosition_data(null);
        setSnapGuides({ x: [], y: [] });
        return;
      }

      // ... (Phần còn lại của handleKeyDown không đổi)
      if (pickedUpRect && (e.key.toLowerCase() === 'r')) {
        e.preventDefault(); 
        setPickedUpRect(prev => ({
          ...prev,
          width: prev.length,
          length: prev.width,
          rotated: !prev.rotated
        }));
      }
      if (e.key === 'Delete' && pickedUpRect) {
        e.preventDefault();
        handleDeleteSelected(null);
        return; 
      }
      if (e.key === 'Delete' && selectedRectIds.length > 0 && !pickedUpRect) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEditMode, pickedUpRect, selectedRectIds, pickUpOrigin, handleDeleteSelected, placedRectDetails]); 

  // Ghi nhớ tổng số lớp (Không đổi)
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
        setSessionUnplacedRects([]); // Hủy kho tạm
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

  // Hàm nhấc lên (Không đổi)
  const handlePickUpRect = useCallback((clickedRect) => {
    if (!isEditMode || pickedUpRect) return;

    const rectToPickUp = editedRectangles.find(r => r.id === clickedRect.id);
    if (rectToPickUp) {
      setPickedUpRect(rectToPickUp);
      setGhostRectPosition_data({ x: rectToPickUp.x, y: rectToPickUp.y }); 
      setEditedRectangles(prev => prev.filter(r => r.id !== clickedRect.id));
      setSelectedRectIds([]);
      setContextMenu({ visible: false });
      setPickUpOrigin('board');
    }
  }, [isEditMode, pickedUpRect, editedRectangles]);

  // [NÂNG CẤP 4] Cập nhật logic ĐẶT XUỐNG (Không đổi)
  const handleContainerClick = useCallback((e) => {
    if (!isEditMode || !containerRef.current) return;

    if (contextMenu.visible) {
      setContextMenu({ visible: false });
      return;
    }

    const isClickOnRect = e.target.closest('.rectangle-item');
    if (isClickOnRect) return;

    if (pickedUpRect) {
      e.stopPropagation();
      const containerBounds = containerRef.current.getBoundingClientRect();
      const clickX_visual = e.clientX - containerBounds.left;
      const clickY_visual = e.clientY - containerBounds.top;
      
      const clickX_unscaled_visual = clickX_visual / visualScale;
      const clickY_unscaled_visual = clickY_visual / visualScale;

      const dataClickX = isLandscape ? clickX_unscaled_visual : clickY_unscaled_visual;
      const dataClickY = isLandscape ? clickY_unscaled_visual : clickX_unscaled_visual;

      const idealDataX = dataClickX - (pickedUpRect.width / 2);
      const idealDataY = dataClickY - (pickedUpRect.length / 2);

      const { snappedX, snappedY } = calculateSnapPosition(
        idealDataX,
        idealDataY,
        pickedUpRect,
        editedRectangles,
        container,
        snapEnabled,
        snapThreshold
      );
      
      setEditedRectangles(prev => [
        ...prev,
        { ...pickedUpRect, x: snappedX, y: snappedY }
      ]);
      setPickedUpRect(null);
      setHasUnsavedChanges(true);
      setPickUpOrigin(null);
      setGhostRectPosition_data(null);
      setSnapGuides({ x: [], y: [] });

    } else {
      if (!e.ctrlKey && !e.metaKey) {
        setSelectedRectIds([]);
      }
    }
  }, [
    isEditMode, 
    pickedUpRect, 
    contextMenu.visible, 
    visualScale, 
    snapEnabled, 
    snapThreshold, 
    editedRectangles, 
    container, 
    isLandscape,
    calculateSnapPosition
  ]);

  
  // ✅ KẾT THÚC THAY ĐỔI 6

  const handleRotateSelected = useCallback((id = null) => {
    // Nếu id là một object (event), bỏ qua nó và dùng selectedRectIds
    const finalId = (typeof id === 'object' && id !== null) ? null : id;
    const idsToRotate = finalId ? [finalId] : selectedRectIds;
    
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
    // 1. Cập nhật 'originalRectangles' (trạng thái đã lưu của tấm liệu)
    setOriginalRectangles([...editedRectangles]);
    
    // 2. Gộp kho TẠM (session) vào kho VĨNH VIỄN (global)
    if (sessionUnplacedRects.length > 0) {
      setGlobalInventory(prevInventory => {
        const newInventory = new Map(prevInventory);
        
        sessionUnplacedRects.forEach(rect => {
          const typeId = rect.typeId;
          // Lấy thông tin chi tiết (tên, màu...) từ map đã tra cứu
          const details = placedRectDetails[typeId] || { 
              name: `ID ${typeId}`, 
              color: rect.color,
              width: rect.width,
              length: rect.length
          };

          if (!newInventory.has(typeId)) {
            // Nếu chưa có nhóm này, tạo nhóm mới
            newInventory.set(typeId, {
              details: details,
              instances: []
            });
          }
          // Thêm instance hình chữ nhật vào nhóm
          newInventory.get(typeId).instances.push(rect);
        });
        
        return newInventory;
      });
    }

    // 3. Xóa kho TẠM vì đã gộp xong
    setSessionUnplacedRects([]); 
    setHasUnsavedChanges(false);

    // 4. Tìm và cập nhật tấm liệu trong state 'editablePlates'
    const safeIndex = Math.max(0, Math.min(selectedPlate, categorizedPlates.length - 1));
    const currentPlateMeta = categorizedPlates[safeIndex];
    const originalPlateIndex = currentPlateMeta?.originalIndex;

    setEditablePlates(prevPlates => {
      const newPlates = [...prevPlates];
      const plateToUpdateIndex = newPlates.findIndex(p => p.originalIndex === originalPlateIndex);

      if (plateToUpdateIndex !== -1) {
        // ... (Logic cập nhật tấm liệu không đổi) ...
        const updatedLayers = [{
          layer: 0,
          rectangles: editedRectangles.map(r => ({...r, layer: 0}))
        }];
        const singleLayerArea = container.width * container.length;
        const actualLayersUsed = 1;
        const totalPlateArea = singleLayerArea * actualLayersUsed;
        const plateUsedArea = editedRectangles.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        const plateEfficiency = totalPlateArea > 0 ? (plateUsedArea / totalPlateArea * 100) : 0;

        const updatedPlate = {
          ...newPlates[plateToUpdateIndex],
          layers: updatedLayers,
          efficiency: plateEfficiency,
          description: (newPlates[plateToUpdateIndex].description || `Tấm ${originalPlateIndex + 1}`)
                          .replace(" (Đã chỉnh sửa)", "") + " (Đã chỉnh sửa)"
        };
        
        newPlates[plateToUpdateIndex] = updatedPlate;
        return newPlates;
      }
      return prevPlates;
    });

    alert('Đã lưu thay đổi thành công!');
  }, [
    editedRectangles, 
    sessionUnplacedRects, // Thêm dependency
    placedRectDetails, // Thêm dependency
    selectedPlate, 
    categorizedPlates, 
    container.width, 
    container.length
  ]);

  // ✅ CẬP NHẬT: handleCancelEdit chỉ xóa kho TẠM
  const handleCancelEdit = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn hủy không?')) {
        setEditedRectangles([...originalRectangles]);
        setSessionUnplacedRects([]); // Xóa kho tạm
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
        setPickedUpRect(null);
      }
    } else {
      setIsEditMode(false);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setSessionUnplacedRects([]); // Đảm bảo kho tạm trống khi thoát
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
  // ✅ MỚI: Hàm nhấc hình từ kho TẠM (session)
  const handlePickUpFromSession = useCallback((clickedRect) => {
    if (!isEditMode || pickedUpRect) return; 

    const rectToPickUp = sessionUnplacedRects.find(r => r.id === clickedRect.id);
    
    if (rectToPickUp) {
      setPickedUpRect(rectToPickUp);
      setGhostRectPosition_data({ x: 0, y: 0 }); 
      setSessionUnplacedRects(prev => prev.filter(r => r.id !== clickedRect.id));
      setSelectedRectIds([]);
      setContextMenu({ visible: false });
      setPickUpOrigin('unplaced-session'); // Đặt origin mới
    }
  }, [isEditMode, pickedUpRect, sessionUnplacedRects]);

  // ✅ MỚI: Hàm nhấc hình từ kho GLOBAL (inventory)
  const handlePickUpFromGlobal = useCallback((typeId) => {
    if (!isEditMode || pickedUpRect) return;

    setGlobalInventory(prevInventory => {
      const newInventory = new Map(prevInventory);
      const item = newInventory.get(typeId);

      if (item && item.instances.length > 0) {
        // Lấy 1 instance ra khỏi mảng
        const rectToPickUp = item.instances.pop(); 
        
        setPickedUpRect(rectToPickUp);
        setGhostRectPosition_data({ x: 0, y: 0 }); // Sẽ cập nhật ngay khi di chuột
        
        
        setSelectedRectIds([]);
        setContextMenu({ visible: false });
        setPickUpOrigin('unplaced-global'); // Đặt origin mới
      }
      
      return newInventory;
    });
  }, [isEditMode, pickedUpRect]);

  // --- TÍNH TOÁN ---
  const { layersPerPlate = 1, efficiency: totalEfficiency = 0 } = packingResult || {};
  const platesNeeded = categorizedPlates.length;
  const safeIndex = selectedPlate >= platesNeeded ? 0 : selectedPlate;
  const currentPlateMeta = categorizedPlates[safeIndex];
  
  // =========================================================================
  // === ✅ THAY ĐỔI 5: 'currentPlateLayers' đọc từ 'editablePlates' === (Không đổi từ file gốc)
  // =========================================================================
  const currentPlateLayers = useMemo(() => {
    if (!editablePlates || !currentPlateMeta) return [];
    // Tìm data trong state 'editablePlates'
    const currentPlateData = editablePlates.find(p => p.originalIndex === currentPlateMeta.originalIndex);
    return currentPlateData?.layers || [];
  }, [editablePlates, currentPlateMeta]); // Dependency đã đổi
  
  const displayRectangles = useMemo(() => {
    if (isEditMode) return editedRectangles;
    // 'originalRectangles' giờ là trạng thái đã lưu, nên đây là đúng
    return originalRectangles; 
  }, [isEditMode, editedRectangles, originalRectangles]);

  // =========================================================================
  // === ✅ THAY ĐỔI 6: 'handleExportPdf' dùng 'editablePlates' === (Không đổi từ file gốc)
  // =========================================================================
  const handleExportPdf = async () => {
    // Kiểm tra state mới 'editablePlates'
    if (!editablePlates || editablePlates.length === 0) {
      setExportError('Không có dữ liệu kết quả để xuất.');
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      // const { plates } = packingResult; // <-- Lấy dữ liệu CŨ
      const platesToExport = editablePlates; // <-- Lấy dữ liệu MỚI (đã chỉnh sửa)
      
      // 'packingService' nhận 'container' và 'platesToExport'
      const response = await packingService.exportMultiPagePdf(container, platesToExport);
      
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

  // --- TÍNH TOÁN RENDER (cho tấm hiện tại) ---
  // Tìm description từ 'editablePlates' để hiển thị "(Đã chỉnh sửa)"
  const plateDescriptionData = editablePlates.find(p => p.originalIndex === currentPlateMeta?.originalIndex);
  let plateDescription = plateDescriptionData?.description || `Tấm #${currentPlateMeta?.displayIndex || 1}`;
  if (plateDescription) {
    plateDescription = plateDescription.replace(/\|.*?\)/, ')');
  }

  const singleLayerArea = container.width * container.length;
  const actualLayersUsed = currentPlateLayers.length; // Sẽ tự động cập nhật (từ Thay đổi 5)
  const totalPlateArea = singleLayerArea * actualLayersUsed;
  
  // 'displayRectangles' đã đúng (hiển thị 'originalRectangles' khi không edit)
  const plateUsedArea = displayRectangles.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
  const plateEfficiency = totalPlateArea > 0 ? (plateUsedArea / totalPlateArea * 100).toFixed(1) : 0;
  
  // --- EARLY RETURNS --- (Không đổi)
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

  // Tổng số lượng hàng tồn kho
  const totalGlobalInventory = Array.from(globalInventory.values())
                                .reduce((sum, item) => sum + item.instances.length, 0);

  // --- RETURN JSX ---
  return (
    <div className="mb-4 card p-1 md:p-2">
      {/* ✅ SỬA 4: Truyền props isPaletteOpen và onTogglePalette */}
      <EditModeControls
        isEditMode={isEditMode}
        onToggleEditMode={handleToggleEditMode}
        selectedRectangles={selectedRectIds}
        onDeleteSelected={handleDeleteSelected} // Đã được cập nhật
        onRotateSelected={handleRotateSelected}
        onAlignSelected={handleAlignSelected}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        snapThreshold={snapThreshold}
        onSnapThresholdChange={setSnapThreshold}
        onSaveChanges={handleSaveChanges} // Đã được cập nhật
        onCancelEdit={handleCancelEdit} // Đã được cập nhật
        hasUnsavedChanges={hasUnsavedChanges}
        onExportAllPdf={handleExportPdf} // Đã được cập nhật
        isExporting={isExporting}
        totalPlates={platesNeeded}
        isPaletteOpen={isUnplacedPanelOpen}
        onTogglePalette={() => setIsUnplacedPanelOpen(!isUnplacedPanelOpen)}
        pickedUpRect={pickedUpRect}
        onShowHelp={() => setIsHelpModalOpen(true)}
      />

      
      {exportError && (
        <div className="my-2 p-2 bg-red-100 text-red-700 text-sm border border-red-300 rounded">
          <strong>Lỗi xuất PDF:</strong> {exportError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-2 md:p-1 mb-3 md:mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 border-b pb-2 gap-2">
          {/* Tiêu đề tấm liệu (sẽ tự cập nhật 'Đã chỉnh sửa') */}
          <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-800" title={currentPlateMeta.description}>
            {plateDescription} ({actualLayersUsed}/{layersPerPlate} lớp)
          </h3>
          {/* Hiệu suất (sẽ tự cập nhật) */}
          <div className="text-xs md:text-sm lg:text-base text-gray-600">
            Hiệu suất (Tấm này): <span className="font-bold text-primary-600">{plateEfficiency}%</span>
          </div>
        </div>
        
        {/* Nút chọn tấm liệu (Không đổi) */}
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
        
        <div className={`flex ${isEditMode ? 'flex-col lg:flex-row' : 'flex-col'} gap-4`}>
          
          {/* ✅ CỘT 1: KHO (Đã cập nhật) */}
          {isEditMode && isUnplacedPanelOpen && (
            <div className="lg:w-1/4 xl:w-1/5 p-2 border-r border-gray-200">
              <div className="max-h-[400px] lg:max-h-[500px] overflow-y-auto pr-1 space-y-4">

                {/* 1. Kho Tạm (Session) */}
                <div>
                  <h4 className="font-semibold text-yellow-800 mb-1 text-base">
                    ♻️ Hình đã gỡ ({sessionUnplacedRects.length})
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    {sessionUnplacedRects.length > 0
                      ? "Các hình này sẽ vào Kho Tồn khi bạn Lưu."
                      : "Các hình bạn xóa sẽ xuất hiện ở đây."}
                  </p>
                  
                  {sessionUnplacedRects.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      {sessionUnplacedRects.map(rect => (
                        <SessionUnplacedItem
                          key={rect.id}
                          rectInstance={rect}
                          details={placedRectDetails}
                          onPickUp={handlePickUpFromSession} // Dùng hàm mới
                          isDisabled={!!pickedUpRect}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Kho Hàng Tồn (Global) */}
                <div>
                  <h4 className="font-semibold text-blue-800 mb-1 text-base">
                    📦 Kho Hàng Tồn ({totalGlobalInventory})
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    {totalGlobalInventory > 0
                      ? "Hàng tồn đã lưu, có thể dùng cho mọi tấm."
                      : "Chưa có hàng tồn."}
                  </p>
                  
                  {totalGlobalInventory > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      {Array.from(globalInventory.entries()).map(([typeId, item]) => (
                        <GroupedInventoryItem
                          key={typeId}
                          item={item} // { details, instances }
                          onPickUp={handlePickUpFromGlobal} // Dùng hàm mới
                          isDisabled={!!pickedUpRect}
                        />
                      ))}
                    </div>
                  )}
                </div>
              
              </div>
            </div>
          )}

          {/* 📦 CỘT 2: CONTAINER (Luôn hiển thị) */}
          <div 
            ref={mainAreaRef}
            className={`${isEditMode ? 'flex-1 min-w-0' : 'w-full'}`}
          >
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
                  
                  const maxLayers = Math.max(1, ...displayRectangles.map(r => r.layer + 1));
                  const opacity = 1 - (rect.layer / maxLayers) * 0.4;
                  const zIndex = 10 + (maxLayers - rect.layer);
                  
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
                
                {/* RENDER HÌNH ĐANG CẦM (Ghost) */}
                {pickedUpRect && (() => {
                  const pickedDisplayWidth = pickedUpRect.width * scale;
                  const pickedDisplayLength = pickedUpRect.length * scale;
                  const pickedFinalWidth = isLandscape ? pickedDisplayWidth : pickedDisplayLength;
                  const pickedFinalHeight = isLandscape ? pickedDisplayLength : pickedDisplayWidth;

                  let visualLeft = mousePos.x - (pickedFinalWidth / 2);
                  let visualTop = mousePos.y - (pickedFinalHeight / 2);
                  
                  if (ghostRectPosition_data) {
                    visualLeft = (isLandscape ? ghostRectPosition_data.x : ghostRectPosition_data.y) * scale;
                    visualTop = (isLandscape ? ghostRectPosition_data.y : ghostRectPosition_data.x) * scale;
                  }

                  const isSnapped = snapGuides.x.length > 0 || snapGuides.y.length > 0;

                  return (
                    <>
                      {/* Snap guides */}
                      {snapEnabled && (
                        <div className="absolute inset-0 pointer-events-none z-40">
                          {snapGuides.x.map((x, i) => ( 
                            <div 
                              key={`snap-x-${i}`}
                              className="absolute bg-red-500 opacity-70"
                              style={isLandscape 
                                ? { left: `${x * scale}px`, top: 0, bottom: 0, width: '1px' }
                                : { top: `${x * scale}px`, left: 0, right: 0, height: '1px' }
                              }
                            />
                          ))}
                          {snapGuides.y.map((y, i) => ( 
                            <div 
                              key={`snap-y-${i}`}
                              className="absolute bg-red-500 opacity-70"
                              style={isLandscape
                                ? { top: `${y * scale}px`, left: 0, right: 0, height: '1px' }
                                : { left: `${y * scale}px`, top: 0, bottom: 0, width: '1px' }
                              }
                            />
                          ))}
                          
                          {/* Crosshair chuột */}
                          <div 
                            className="absolute top-0 bottom-0 w-0.5 bg-blue-400 opacity-30"
                            style={{ left: `${mousePos.x}px`, display: mousePos.x > 0 ? 'block' : 'none' }}
                          />
                          <div 
                            className="absolute left-0 right-0 h-0.5 bg-blue-400 opacity-30"
                            style={{ top: `${mousePos.y}px`, display: mousePos.y > 0 ? 'block' : 'none' }}
                          />
                        </div>
                      )}
                      
                      {/* Hình đang được cầm (Ghost) */}
                      <div
                        className={`absolute border-4 bg-opacity-70 z-50 flex items-center justify-center text-white font-bold shadow-2xl ${
                          isSnapped ? 'border-red-500' : 'border-dashed border-blue-500 animate-pulse'
                        }`}
                        style={{
                          left: `${visualLeft}px`,
                          top: `${visualTop}px`,
                          width: `${pickedFinalWidth}px`,
                          height: `${pickedFinalHeight}px`,
                          backgroundColor: pickedUpRect.color,
                          pointerEvents: 'none',
                          transition: isSnapped ? 'all 50ms ease-out' : 'none' // Hiệu ứng "nhảy"
                        }}
                      >
                        <div className="text-sm font-bold bg-black bg-opacity-50 px-2 py-1 rounded">
                          {pickedUpRect.width}×{pickedUpRect.length}
                          <div className="text-xs opacity-75">
                            R để xoay | ESC hủy
                            {isSnapped && <span className="text-red-300"> | SNAPPED!</span>}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer (Không đổi) */}
        <div className="mt-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            <span className="text-gray-500 font-medium">Tổng cộng {totalLayersUsed} lớp</span>
          </div>
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            Hiệu suất tổng thể: <span className="text-base md:text-xl text-blue-600">{totalEfficiency.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* CONTEXT MENU (Không đổi) */}
      <RectangleContextMenu
        menu={{ ...contextMenu, onClose: () => setContextMenu({ visible: false }) }}
        onRotate={handleRotateSelected}
        onDelete={handleDeleteSelected}
      />
      {isHelpModalOpen && (
        <HelpModal onClose={() => setIsHelpModalOpen(false)} />
      )}
    </div>
  );
};

export default PackingResult;