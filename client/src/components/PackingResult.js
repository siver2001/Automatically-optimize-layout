// client/src/components/PackingResult.js
import React from 'react';
import { Stage, Layer, Rect as KonvaRect, Text as KonvaText, Line as KonvaLine } from 'react-konva';
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
      title={isDisabled ? "Bạn đang cầm một size khác" : `Nhấc lại ${name} (${rectInstance.width}x${rectInstance.length})`}
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
const GroupedInventoryItem = ({ item, onPickUp, isDisabled }) => {
  const { details, instances } = item;
  const quantity = instances.length;

  if (quantity === 0) return null;

  const rectInstance = instances[0];
  const name = details.name || `ID ${rectInstance.typeId}`;
  const color = rectInstance.color || details.color || '#3498db';

  const handleClick = () => {
    if (!isDisabled) {
      onPickUp(rectInstance.typeId);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className="w-full flex items-center p-2 rounded-md border bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      title={isDisabled ? "Bạn đang cầm một size khác" : `Nhấc 1 ${name} (${rectInstance.width}x${rectInstance.length})`}
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
      <div className="ml-2 flex-shrink-0 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
        {quantity}
      </div>
    </button>
  );
};

const PackingResult = () => {
  const { packingResult, isOptimizing, container, rectangles } = usePacking();

  const [selectedPlate, setSelectedPlate] = React.useState(0);
  const [placedRectDetails, setPlacedRectDetails] = React.useState({});
  const [visualScale, setVisualScale] = React.useState(1);

  // Edit Mode States
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [editedRectangles, setEditedRectangles] = React.useState([]);
  const [selectedRectIds, setSelectedRectIds] = React.useState([]);
  const [snapEnabled, setSnapEnabled] = React.useState(true);
  const [snapThreshold, setSnapThreshold] = React.useState(10);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [originalRectangles, setOriginalRectangles] = React.useState([]);
  const [sessionUnplacedRects, setSessionUnplacedRects] = React.useState([]);

  const [globalInventory, setGlobalInventory] = React.useState(new Map());
  const [isHelpModalOpen, setIsHelpModalOpen] = React.useState(false);

  const [isExporting, setIsExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState(null);

  const containerRef = React.useRef(null);
  const mainAreaRef = React.useRef(null);

  const [pickedUpRect, setPickedUpRect] = React.useState(null);
  const [originalPickedUpState, setOriginalPickedUpState] = React.useState(null); // Store original state for cancel
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = React.useState({ x: [], y: [] });
  const [ghostRectPosition_data, setGhostRectPosition_data] = React.useState(null);
  const [contextMenu, setContextMenu] = React.useState({
    visible: false,
    x: 0,
    y: 0,
    targetRect: null
  });

  const [isUnplacedPanelOpen, setIsUnplacedPanelOpen] = React.useState(true);
  const [pickUpOrigin, setPickUpOrigin] = React.useState(null);
  const [editablePlates, setEditablePlates] = React.useState([]);

  // Sync packingResult to editablePlates
  React.useEffect(() => {
    if (packingResult?.plates) {
      const deepCopiedPlates = packingResult.plates.map((plate, index) => ({
        ...plate,
        originalIndex: index,
        layers: plate.layers.map(layer => ({
          ...layer,
          rectangles: layer.rectangles.filter(Boolean).map(r => ({ ...r }))
        }))
      }));
      setEditablePlates(deepCopiedPlates);
    } else {
      setEditablePlates([]);
    }
  }, [packingResult]);

  // --- TÍNH TOÁN RENDER ---
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

  React.useEffect(() => {
    const updateScale = () => {
      if (!vizWidth || !vizLength) return;

      let maxVisualWidth, maxVisualLength;
      const screenWidth = window.innerWidth;

      if (isEditMode && mainAreaRef.current) {
        const availableWidth = mainAreaRef.current.clientWidth;
        if (availableWidth === 0) return;
        maxVisualWidth = availableWidth * 0.95;
        maxVisualLength = window.innerHeight * 0.65;
      } else {
        if (screenWidth >= 1920) {
          maxVisualWidth = screenWidth * 0.52;
          maxVisualLength = window.innerHeight * 0.55;
        } else if (screenWidth >= 1536) {
          maxVisualWidth = screenWidth * 0.50;
          maxVisualLength = window.innerHeight * 0.52;
        } else if (screenWidth >= 1280) {
          maxVisualWidth = screenWidth * 0.48;
          maxVisualLength = window.innerHeight * 0.50;
        } else {
          maxVisualWidth = screenWidth * 0.46;
          maxVisualLength = window.innerHeight * 0.45;
        }
      }

      const newScale = Math.min(maxVisualWidth / vizWidth, maxVisualLength / vizLength);
      setVisualScale(newScale);
    };

    const timerId = setTimeout(updateScale, 50);
    window.addEventListener('resize', updateScale);
    return () => {
      clearTimeout(timerId);
      window.removeEventListener('resize', updateScale);
    }
  }, [container.width, container.length, vizWidth, vizLength, isEditMode, isUnplacedPanelOpen]);

  React.useEffect(() => {
    const details = rectangles.reduce((acc, rect) => {
      acc[rect.id] = { name: rect.name, color: rect.color, width: rect.width, length: rect.length };
      return acc;
    }, {});
    setPlacedRectDetails(details);
  }, [rectangles]);

  React.useEffect(() => {
    if (packingResult?.plates?.length > 0 && selectedPlate >= packingResult.plates.length) {
      setSelectedPlate(0);
    }
  }, [packingResult, selectedPlate]);

  const categorizedPlates = React.useMemo(() => {
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

  // --- LẤY SỐ LỚP ---
  const safeIndex = Math.max(0, Math.min(selectedPlate, categorizedPlates.length - 1));
  const currentPlateMeta = categorizedPlates[safeIndex];
  const currentPlateData = editablePlates.find(p => p.originalIndex === currentPlateMeta?.originalIndex);

  const currentPlateLayers = currentPlateData?.layers || [];
  const currentLayerCount = currentPlateLayers.length > 0 ? currentPlateLayers.length : 1;

  React.useEffect(() => {
    if (editablePlates.length > 0 && categorizedPlates.length > 0) {
      if (currentPlateData && currentPlateData.layers) {
        const layer0 = currentPlateData.layers.find(l => l.layerIndexInPlate === 0);
        const rects = layer0 ? layer0.rectangles.filter(Boolean) : [];

        const finalRects = rects.length > 0
          ? rects
          : (currentPlateData.layers[0]?.rectangles.filter(Boolean) || []);

        setEditedRectangles(finalRects.map(r => ({ ...r })));
        setOriginalRectangles(finalRects.map(r => ({ ...r })));
      } else {
        setEditedRectangles([]);
        setOriginalRectangles([]);
      }

      // CHỈ reset các biến tạm, KHÔNG reset isEditMode ở đây để tránh xung đột vòng lặp update
      setSessionUnplacedRects([]);
      setHasUnsavedChanges(false);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setOriginalPickedUpState(null);
      setContextMenu({ visible: false });

      // Khi chọn tấm khác hoặc dữ liệu thay đổi từ bên ngoài, tự động thoát Edit Mode an toàn
      setIsEditMode(false);

    } else {
      setEditedRectangles([]);
      setOriginalRectangles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editablePlates, selectedPlate, categorizedPlates]);

  // Snap calculation
  const calculateSnapPosition = React.useCallback((idealDataX, idealDataY, rectToSnap, allRects, container, snapEnabled, snapThreshold) => {
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

    allRects.forEach(rect => {
      const checkX = [rect.x, rect.x + rect.width, rect.x + rect.width - rectToSnap.width, rect.x - rectToSnap.width];
      checkX.forEach(val => { if (Math.abs(newX - val) < bestDistX) { bestSnapX = val; bestDistX = Math.abs(newX - val); } });
      const checkY = [rect.y, rect.y + rect.length, rect.y + rect.length - rectToSnap.length, rect.y - rectToSnap.length];
      checkY.forEach(val => { if (Math.abs(newY - val) < bestDistY) { bestSnapY = val; bestDistY = Math.abs(newY - val); } });
    });

    const borderX = [0, container.width - rectToSnap.width];
    borderX.forEach(val => { if (Math.abs(newX - val) < bestDistX) { bestSnapX = val; bestDistX = Math.abs(newX - val); } });
    const borderY = [0, container.length - rectToSnap.length];
    borderY.forEach(val => { if (Math.abs(newY - val) < bestDistY) { bestSnapY = val; bestDistY = Math.abs(newY - val); } });

    if (bestSnapX === null) {
      const gridSnapX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
      if (Math.abs(newX - gridSnapX) < threshold) { bestSnapX = gridSnapX; }
    }
    if (bestSnapY === null) {
      const gridSnapY = Math.round(newY / GRID_SIZE) * GRID_SIZE;
      if (Math.abs(newY - gridSnapY) < threshold) { bestSnapY = gridSnapY; }
    }

    if (bestSnapX !== null) { newX = bestSnapX; guidesX.push(bestSnapX); }
    if (bestSnapY !== null) { newY = bestSnapY; guidesY.push(bestSnapY); }

    newX = Math.max(0, Math.min(newX, container.width - rectToSnap.width));
    newY = Math.max(0, Math.min(newY, container.length - rectToSnap.length));

    return { snappedX: newX, snappedY: newY, guidesX, guidesY };
  }, []);

  React.useEffect(() => {
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
        idealDataX, idealDataY, pickedUpRect, editedRectangles, container, snapEnabled, snapThreshold
      );

      setSnapGuides({ x: guidesX, y: guidesY });
      setGhostRectPosition_data({ x: snappedX, y: snappedY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => { window.removeEventListener('mousemove', handleMouseMove); };
  }, [pickedUpRect, visualScale, isLandscape, calculateSnapPosition, editedRectangles, container, snapEnabled, snapThreshold]);

  // --- XÓA size (DỰA TRÊN SỐ LỚP) ---
  const handleDeleteSelected = React.useCallback((id = null) => {

    if (pickedUpRect && id === null) {
      if (window.confirm(`Bạn có chắc muốn gỡ size đang cầm? (Sẽ trả ${currentLayerCount} đơn vị về kho)`)) {
        const rectsToAdd = [];
        for (let i = 0; i < currentLayerCount; i++) {
          rectsToAdd.push({
            ...pickedUpRect,
            id: `${pickedUpRect.id}_copy_${Date.now()}_${i}`,
            plateLayerCount: currentLayerCount
          });
        }
        setSessionUnplacedRects(prev => [...prev, ...rectsToAdd]);
        setPickedUpRect(null);
        setOriginalPickedUpState(null);
        setPickUpOrigin(null);
        setGhostRectPosition_data(null);
        setSnapGuides({ x: [], y: [] });
        setHasUnsavedChanges(true);
      }
      return;
    }

    const finalId = (typeof id === 'object' && id !== null) ? null : id;
    const idsToDelete = finalId ? [finalId] : selectedRectIds;

    if (idsToDelete.length > 0 && window.confirm(`Xóa ${idsToDelete.length} size? (Sẽ thu hồi ${idsToDelete.length * currentLayerCount} đơn vị về kho)`)) {

      const rectsToUnplace = [];
      const targetRects = editedRectangles.filter(r => idsToDelete.includes(r.id));

      targetRects.forEach(rect => {
        for (let i = 0; i < currentLayerCount; i++) {
          rectsToUnplace.push({
            ...rect,
            id: `${rect.id}_return_${Date.now()}_${i}`,
            plateLayerCount: currentLayerCount
          });
        }
      });

      setSessionUnplacedRects(prev => [...prev, ...rectsToUnplace]);
      setEditedRectangles(prev => prev.filter(r => !idsToDelete.includes(r.id)));
      setSelectedRectIds([]);
      setHasUnsavedChanges(true);
    }
  }, [selectedRectIds, editedRectangles, pickedUpRect, currentLayerCount]);

  // Keyboard
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isEditMode) return;

      // Rotate with R
      if ((e.key === 'r' || e.key === 'R') && pickedUpRect) {
        setPickedUpRect(prev => ({
          ...prev,
          rotated: !prev.rotated,
          width: prev.length,
          length: prev.width
        }));
      }

      // Cancel with Escape
      if (e.key === 'Escape' && pickedUpRect) {
        e.preventDefault();
        if (pickUpOrigin === 'board') {
          // Restore ORIGINAL state (including rotation/dimensions)
          const rectToRestore = originalPickedUpState || pickedUpRect;
          setEditedRectangles(prev => [...prev, rectToRestore]);
        } else if (pickUpOrigin === 'unplaced-session') {
          setSessionUnplacedRects(prev => [...prev, pickedUpRect]);
        } else if (pickUpOrigin === 'unplaced-global') {
          setGlobalInventory(prev => {
            const newMap = new Map(prev);
            const item = newMap.get(pickedUpRect.typeId);
            if (item) {
              item.instances.push(pickedUpRect);
            } else {
              const details = placedRectDetails[pickedUpRect.typeId] || { name: 'Unknown', color: pickedUpRect.color, width: pickedUpRect.width, length: pickedUpRect.length };
              newMap.set(pickedUpRect.typeId, { details, instances: [pickedUpRect] });
            }
            return newMap;
          });
        }
        setPickedUpRect(null);
        setOriginalPickedUpState(null);
        setPickUpOrigin(null);
        setGhostRectPosition_data(null);
        setSnapGuides({ x: [], y: [] });
        return;
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
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [isEditMode, pickedUpRect, selectedRectIds, pickUpOrigin, handleDeleteSelected, placedRectDetails, currentLayerCount, ghostRectPosition_data, originalPickedUpState]);

  const handleToggleEditMode = React.useCallback(() => {
    if (isEditMode && hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn thoát không?')) {
        setEditedRectangles([...originalRectangles]);
        setSessionUnplacedRects([]);
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
        setPickedUpRect(null);
        setOriginalPickedUpState(null);
      }
    } else {
      setIsEditMode(!isEditMode);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setOriginalPickedUpState(null);
      setContextMenu({ visible: false });
    }
  }, [isEditMode, hasUnsavedChanges, originalRectangles]);

  const handlePickUpRect = React.useCallback((clickedRect) => {
    if (!isEditMode || pickedUpRect) return;

    const rectToPickUp = editedRectangles.find(r => r.id === clickedRect.id);
    if (rectToPickUp) {
      setPickedUpRect(rectToPickUp);
      setOriginalPickedUpState(rectToPickUp);
      setGhostRectPosition_data({ x: rectToPickUp.x, y: rectToPickUp.y });
      setEditedRectangles(prev => prev.filter(r => r.id !== clickedRect.id));
      setSelectedRectIds([]);
      setContextMenu({ visible: false });
      setPickUpOrigin('board');
    }
  }, [isEditMode, pickedUpRect, editedRectangles]);

  const handleContainerClick = React.useCallback((e) => {
    if (!isEditMode || !containerRef.current) return;
    if (contextMenu.visible) { setContextMenu({ visible: false }); return; }

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
        idealDataX, idealDataY, pickedUpRect, editedRectangles, container, snapEnabled, snapThreshold
      );

      setEditedRectangles(prev => [...prev, { ...pickedUpRect, x: snappedX, y: snappedY }]);
      setPickedUpRect(null);
      setOriginalPickedUpState(null);
      setHasUnsavedChanges(true);
      setPickUpOrigin(null);
      setGhostRectPosition_data(null);
      setSnapGuides({ x: [], y: [] });
    } else {
      if (!e.ctrlKey && !e.metaKey) setSelectedRectIds([]);
    }
  }, [isEditMode, pickedUpRect, contextMenu.visible, visualScale, snapEnabled, snapThreshold, editedRectangles, container, isLandscape, calculateSnapPosition]);

  const handleRotateSelected = React.useCallback((id = null) => {
    const finalId = (typeof id === 'object' && id !== null) ? null : id;
    const idsToRotate = finalId ? [finalId] : selectedRectIds;
    if (idsToRotate.length === 0) return;
    setEditedRectangles(prev =>
      prev.map(r => {
        if (idsToRotate.includes(r.id)) return { ...r, width: r.length, length: r.width, rotated: !r.rotated };
        return r;
      })
    );
    setHasUnsavedChanges(true);
  }, [selectedRectIds]);

  // --- HỢP NHẤT (MERGE) ---
  const handleMerge = React.useCallback(() => {
    if (!isEditMode) return;

    setEditedRectangles(prevRects => {
      const rects = prevRects.map(r => ({ ...r })); // Deep copy for safety
      let hasMerged = false;

      // Helper: Check if two rects are identical in size
      const areIdenticalSize = (r1, r2) => {
        const tolerance = 0.5; // 0.5mm tolerance
        return Math.abs(r1.width - r2.width) < tolerance && Math.abs(r1.length - r2.length) < tolerance;
      };

      // Helper: Check adjacency
      const areAdjacent = (r1, r2) => {
        const tolerance = 0.5;
        // Check Horizontal Adjacency (Side-by-side)
        // Same Y, Same Height, X touches
        const sameY = Math.abs(r1.y - r2.y) < tolerance;
        const sameHeight = Math.abs(r1.length - r2.length) < tolerance; // Height is length in this context usually
        const touchesX = Math.abs((r1.x + r1.width) - r2.x) < tolerance || Math.abs((r2.x + r2.width) - r1.x) < tolerance;

        if (sameY && sameHeight && touchesX) return 'horizontal';

        // Check Vertical Adjacency (Top-to-bottom)
        // Same X, Same Width, Y touches
        const sameX = Math.abs(r1.x - r2.x) < tolerance;
        const sameWidth = Math.abs(r1.width - r2.width) < tolerance;
        const touchesY = Math.abs((r1.y + r1.length) - r2.y) < tolerance || Math.abs((r2.y + r2.length) - r1.y) < tolerance;

        if (sameX && sameWidth && touchesY) return 'vertical';

        return null;
      };

      // Helper: Check if merged result matches original size
      const matchesOriginalSize = (width, length, typeId) => {
        const original = placedRectDetails[typeId];
        if (!original) return false;
        const tolerance = 0.5;

        // Check normal orientation
        const matchNormal = Math.abs(width - original.width) < tolerance && Math.abs(length - original.length) < tolerance;
        // Check rotated orientation
        const matchRotated = Math.abs(width - original.length) < tolerance && Math.abs(length - original.width) < tolerance;

        return matchNormal || matchRotated;
      };

      let keepMerging = true;
      let currentPool = rects;

      while (keepMerging) {
        keepMerging = false;
        const nextPool = [];
        const processedIndices = new Set();

        for (let i = 0; i < currentPool.length; i++) {
          if (processedIndices.has(i)) continue;

          let merged = false;
          for (let j = i + 1; j < currentPool.length; j++) {
            if (processedIndices.has(j)) continue;

            const r1 = currentPool[i];
            const r2 = currentPool[j];

            // 1. Check same Type ID (Name)
            if (r1.typeId === r2.typeId) {
              // 2. Check identical current size (optional, but good for symmetry)
              if (areIdenticalSize(r1, r2)) {
                const adjacency = areAdjacent(r1, r2);
                if (adjacency) {
                  // Calculate potential new dimensions
                  const newWidth = adjacency === 'horizontal' ? r1.width + r2.width : r1.width;
                  const newLength = adjacency === 'vertical' ? r1.length + r2.length : r1.length;

                  // 3. Check if new dimensions match ORIGINAL size
                  if (matchesOriginalSize(newWidth, newLength, r1.typeId)) {
                    // MERGE!
                    const newRect = {
                      ...r1,
                      id: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                      name: r1.name,
                      width: newWidth,
                      length: newLength,
                      x: Math.min(r1.x, r2.x),
                      y: Math.min(r1.y, r2.y),
                    };

                    nextPool.push(newRect);
                    processedIndices.add(i);
                    processedIndices.add(j);
                    merged = true;
                    hasMerged = true;
                    keepMerging = true;
                    break;
                  }
                }
              }
            }
          }

          if (!merged) {
            nextPool.push(currentPool[i]);
            processedIndices.add(i);
          }
        }
        currentPool = nextPool;
      }

      if (hasMerged) {
        setHasUnsavedChanges(true);
        return currentPool;
      }

      return prevRects;
    });
  }, [isEditMode, placedRectDetails]);


  // --- LƯU THAY ĐỔI & CẬP NHẬT DIỆN TÍCH ---
  const handleSaveChanges = React.useCallback(() => {
    setOriginalRectangles([...editedRectangles]);

    // Gộp kho TẠM vào GLOBAL
    if (sessionUnplacedRects.length > 0) {
      setGlobalInventory(prevInventory => {
        const newInventory = new Map(prevInventory);

        sessionUnplacedRects.forEach(rect => {
          const typeId = rect.typeId;
          const details = placedRectDetails[typeId] || {
            name: `ID ${typeId}`,
            color: rect.color,
            width: rect.width,
            length: rect.length
          };

          let item = newInventory.get(typeId);
          if (!item) {
            item = { details: details, instances: [] };
          } else {
            item = { ...item, instances: [...item.instances] };
          }
          item.instances.push(rect);
          newInventory.set(typeId, item);
        });
        return newInventory;
      });
    }

    setSessionUnplacedRects([]);
    setHasUnsavedChanges(false);

    const safeIndex = Math.max(0, Math.min(selectedPlate, categorizedPlates.length - 1));
    const currentPlateMeta = categorizedPlates[safeIndex];
    const originalPlateIndex = currentPlateMeta?.originalIndex;

    setEditablePlates(prevPlates => {
      const newPlates = [...prevPlates];
      const plateToUpdateIndex = newPlates.findIndex(p => p.originalIndex === originalPlateIndex);

      if (plateToUpdateIndex !== -1) {
        const oldPlate = newPlates[plateToUpdateIndex];
        const numLayers = oldPlate.layers.length;

        const updatedLayers = [];
        for (let i = 0; i < numLayers; i++) {
          updatedLayers.push({
            layerIndexInPlate: i,
            rectangles: editedRectangles.map(r => ({ ...r, layer: i }))
          });
        }

        const singleLayerArea = container.width * container.length;
        const totalPlateArea = singleLayerArea * numLayers;
        const layoutArea = editedRectangles.reduce((sum, rect) => sum + (rect.width * rect.length), 0);
        const plateUsedArea = layoutArea * numLayers;
        const plateEfficiency = totalPlateArea > 0 ? (plateUsedArea / totalPlateArea * 100) : 0;

        const updatedPlate = {
          ...oldPlate,
          layers: updatedLayers,
          efficiency: plateEfficiency,
          description: (oldPlate.description || `Tấm ${originalPlateIndex + 1}`)
            .replace(" (Đã chỉnh sửa)", "") + " (Đã chỉnh sửa)"
        };

        newPlates[plateToUpdateIndex] = updatedPlate;
        return newPlates;
      }
      return prevPlates;
    });

    setIsEditMode(false);
    setSelectedRectIds([]);
    setPickedUpRect(null);
    setOriginalPickedUpState(null);
    setContextMenu({ visible: false });

  }, [editedRectangles, sessionUnplacedRects, placedRectDetails, selectedPlate, categorizedPlates, container.width, container.length]);

  const handleCancelEdit = React.useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn hủy không?')) {
        setEditedRectangles([...originalRectangles]);
        setSessionUnplacedRects([]);
        setHasUnsavedChanges(false);
        setIsEditMode(false);
        setSelectedRectIds([]);
        setPickedUpRect(null);
        setOriginalPickedUpState(null);
      }
    } else {
      setIsEditMode(false);
      setSelectedRectIds([]);
      setPickedUpRect(null);
      setOriginalPickedUpState(null);
      setSessionUnplacedRects([]);
    }
  }, [hasUnsavedChanges, originalRectangles]);

  const handleContextMenu = (e, rect) => {
    e.preventDefault();
    if (!isEditMode || pickedUpRect) return;
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, targetRect: rect });
    setSelectedRectIds([rect.id]);
  };

  // --- NHẤC TỪ KHO TẠM ---
  const handlePickUpFromSession = React.useCallback((clickedRect) => {
    if (!isEditMode || pickedUpRect) return;

    const availableItems = sessionUnplacedRects.filter(r => r.typeId === clickedRect.typeId);

    if (availableItems.length < currentLayerCount) {
      alert(`Không đủ số lượng! Tấm này có ${currentLayerCount} lớp, nhưng kho tạm chỉ có ${availableItems.length} size.`);
      return;
    }

    const rectToPickUp = availableItems[0];
    const idsToRemove = availableItems.slice(0, currentLayerCount).map(r => r.id);

    if (rectToPickUp) {
      setPickedUpRect(rectToPickUp);
      setGhostRectPosition_data({ x: 0, y: 0 });
      // Filter tạo mảng mới nên an toàn
      setSessionUnplacedRects(prev => prev.filter(r => !idsToRemove.includes(r.id)));
      setSelectedRectIds([]);
      setContextMenu({ visible: false });
      setPickUpOrigin('unplaced-session');
    }
  }, [isEditMode, pickedUpRect, sessionUnplacedRects, currentLayerCount]);

  // --- NHẤC TỪ KHO GLOBAL (FIX BUG TRỪ ĐÔI) ---
  const handlePickUpFromGlobal = React.useCallback((typeId) => {
    if (!isEditMode || pickedUpRect) return;

    const inventoryItem = globalInventory.get(typeId);
    const availableCount = inventoryItem ? inventoryItem.instances.length : 0;

    if (availableCount < currentLayerCount) {
      alert(`Không đủ số lượng! Tấm này có ${currentLayerCount} lớp, nhưng kho tồn chỉ có ${availableCount} size.`);
      return;
    }

    // ✅ FIX QUAN TRỌNG: State Mutation Fix
    // Thay vì sửa trực tiếp item.instances, ta tạo bản sao
    setGlobalInventory(prevInventory => {
      const newInventory = new Map(prevInventory);
      const oldItem = newInventory.get(typeId);

      if (oldItem && oldItem.instances.length >= currentLayerCount) {
        // 1. Shallow copy object item để không sửa tham chiếu cũ
        const newItem = { ...oldItem };

        // 2. Lấy item để cầm
        const rectToPickUp = newItem.instances[newItem.instances.length - 1];

        // 3. Tạo mảng instances mới bằng slice (tạo mảng mới, không sửa mảng cũ)
        newItem.instances = newItem.instances.slice(0, newItem.instances.length - currentLayerCount);

        // 4. Cập nhật vào Map
        newInventory.set(typeId, newItem);

        // Side effects
        setPickedUpRect(rectToPickUp);
        setGhostRectPosition_data({ x: 0, y: 0 });
        setSelectedRectIds([]);
        setContextMenu({ visible: false });
        setPickUpOrigin('unplaced-global');
      }
      return newInventory;
    });
  }, [isEditMode, pickedUpRect, globalInventory, currentLayerCount]);

  const handleExportPdf = async () => {
    if (!editablePlates || editablePlates.length === 0) {
      setExportError('Không có dữ liệu kết quả để xuất.');
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      const platesToExport = editablePlates;
      const response = await packingService.exportMultiPagePdf(container, platesToExport);

      if (!response.success) setExportError(response.error || 'Lỗi không xác định khi xuất file.');
    } catch (error) {
      console.error('Lỗi handleExportPdf:', error);
      setExportError('Lỗi nghiêm trọng: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  // --- TÍNH HIỆU SUẤT REAL-TIME (ĐÃ SỬA) ---
  const singleLayerArea = container.width * container.length;

  // Diện tích sử dụng trên 1 layout (1 lớp)
  const currentPlateUsedArea = (isEditMode ? editedRectangles : originalRectangles).reduce((sum, rect) => sum + (rect.width * rect.length), 0);

  // ✅ Sửa: Chỉ chia cho diện tích của 1 lớp (singleLayerArea). 
  // Vì layout xếp giống nhau cho mọi lớp, nên hiệu suất 1 lớp cũng là hiệu suất cả tấm.
  const plateEfficiency = singleLayerArea > 0 ? (currentPlateUsedArea / singleLayerArea * 100).toFixed(1) : 0;

  const dynamicTotalStats = React.useMemo(() => {
    let totalUsedArea = 0;
    let totalArea = 0;
    let totalLayers = 0;

    editablePlates.forEach(plate => {
      if (plate.originalIndex === currentPlateMeta?.originalIndex) {
        const used = (isEditMode ? editedRectangles : originalRectangles).reduce((s, r) => s + (r.width * r.length), 0);
        const pLayers = currentLayerCount;
        totalUsedArea += (used * pLayers);
        totalArea += (singleLayerArea * pLayers);
        totalLayers += pLayers;
      } else {
        let plateUsed = 0;
        plate.layers.forEach(layer => {
          plateUsed += layer.rectangles.reduce((s, r) => s + (r.width * r.length), 0);
        });
        const pLayers = plate.layers.length;
        totalUsedArea += plateUsed;
        totalArea += (singleLayerArea * pLayers);
        totalLayers += pLayers;
      }
    });

    const efficiency = totalArea > 0 ? (totalUsedArea / totalArea * 100) : 0;
    return { efficiency, totalLayers };
  }, [editablePlates, editedRectangles, originalRectangles, currentPlateMeta, currentLayerCount, singleLayerArea, isEditMode]);

  // --- Display ---
  const displayRectangles = isEditMode ? editedRectangles : originalRectangles;
  let plateDescription = currentPlateData?.description || `Tấm #${currentPlateMeta?.displayIndex || 1}`;
  if (plateDescription) plateDescription = plateDescription.replace(/\|.*?\)/, ')');
  const platesNeeded = categorizedPlates.length;

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
      <div className="mb-4 card p-6 text-center text-red-600">Lỗi: Không tìm thấy thông tin tấm liệu</div>
    );
  }

  const totalGlobalInventory = Array.from(globalInventory.values())
    .reduce((sum, item) => sum + item.instances.length, 0);

  return (
    <div className="mb-4 card p-1 md:p-2">
      <EditModeControls
        isEditMode={isEditMode}
        onToggleEditMode={handleToggleEditMode}
        selectedRectangles={selectedRectIds}
        onDeleteSelected={handleDeleteSelected}
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
        isPaletteOpen={isUnplacedPanelOpen}
        onTogglePalette={() => setIsUnplacedPanelOpen(!isUnplacedPanelOpen)}
        pickedUpRect={pickedUpRect}
        onShowHelp={() => setIsHelpModalOpen(true)}
        onMerge={handleMerge}
      />

      {exportError && (
        <div className="my-2 p-2 bg-red-100 text-red-700 text-sm border border-red-300 rounded">
          <strong>Lỗi xuất PDF:</strong> {exportError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg border border-gray-300 p-2 md:p-1 mb-3 md:mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 border-b pb-2 gap-2">
          <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-800" title={currentPlateMeta.description}>
            {plateDescription} ({currentLayerCount} lớp)
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
                className={`px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium transition-all duration-200 flex-shrink-0 border ${selectedPlate === index
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
          {isEditMode && isUnplacedPanelOpen && (
            <div className="lg:w-1/4 xl:w-1/5 p-2 border-r border-gray-200">
              <div className="max-h-[400px] lg:max-h-[500px] overflow-y-auto pr-1 space-y-4">
                <div>
                  <h4 className="font-semibold text-yellow-800 mb-1 text-base">
                    ♻️ size đã gỡ ({sessionUnplacedRects.length})
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    {sessionUnplacedRects.length > 0
                      ? "Các size này sẽ vào Kho Tồn khi bạn Lưu."
                      : "Các size bạn xóa sẽ xuất hiện ở đây."}
                  </p>
                  {sessionUnplacedRects.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      {sessionUnplacedRects.map(rect => (
                        <SessionUnplacedItem
                          key={rect.id}
                          rectInstance={rect}
                          details={placedRectDetails}
                          onPickUp={handlePickUpFromSession}
                          isDisabled={!!pickedUpRect}
                        />
                      ))}
                    </div>
                  )}
                </div>

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
                          item={item}
                          onPickUp={handlePickUpFromGlobal}
                          isDisabled={!!pickedUpRect}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={mainAreaRef} className={`${isEditMode ? 'flex-1 min-w-0' : 'w-full'}`}>
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
                {/* MODE 1: EDIT MODE (Interactive DOM) */}
                {isEditMode ? (
                  <>
                    <div className="absolute inset-0 opacity-20 pointer-events-none">
                      {Array.from({ length: Math.floor(gridWidth / 100) }).map((_, i) => (
                        <div key={`v-${i}`} className="absolute top-0 bottom-0 w-px bg-gray-400" style={{ left: `${(i + 1) * 100 * scale}px` }}></div>
                      ))}
                      {Array.from({ length: Math.floor(gridLength / 100) }).map((_, i) => (
                        <div key={`h-${i}`} className="absolute left-0 right-0 h-px bg-gray-400" style={{ top: `${(i + 1) * 100 * scale}px` }}></div>
                      ))}
                    </div>
                    {displayRectangles.map((rect) => {
                      if (!rect || typeof rect.width !== 'number' || typeof rect.length !== 'number') return null;
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
                    })}
                  </>
                ) : (
                  /* MODE 2: VIEW MODE (High Performance Canvas) */
                  <Stage width={displayWidth} height={displayLength}>
                    <Layer>
                      {/* Grid Lines */}
                      {Array.from({ length: Math.floor(gridWidth / 100) }).map((_, i) => (
                        <KonvaLine
                          key={`v-${i}`}
                          points={[(i + 1) * 100 * scale, 0, (i + 1) * 100 * scale, displayLength]}
                          stroke="gray"
                          strokeWidth={1}
                          opacity={0.2}
                        />
                      ))}
                      {Array.from({ length: Math.floor(gridLength / 100) }).map((_, i) => (
                        <KonvaLine
                          key={`h-${i}`}
                          points={[0, (i + 1) * 100 * scale, displayWidth, (i + 1) * 100 * scale]}
                          stroke="gray"
                          strokeWidth={1}
                          opacity={0.2}
                        />
                      ))}

                      {/* Rectangles */}
                      {displayRectangles.map((rect) => {
                        if (!rect || typeof rect.width !== 'number' || typeof rect.length !== 'number') return null;

                        const rectWidth = rect.width * scale;
                        const rectLength = rect.length * scale;
                        const rectX = isLandscape ? rect.x * scale : rect.y * scale;
                        const rectY = isLandscape ? rect.y * scale : rect.x * scale;
                        const finalWidth = isLandscape ? rectWidth : rectLength;
                        const finalLength = isLandscape ? rectLength : rectWidth;

                        const minDim = Math.min(finalWidth, finalLength);
                        // Normal text size logic: try to be legible (12px) but shrink if very small
                        const fontSize = Math.max(10, Math.min(14, minDim * 0.3));

                        const color = rect.color || (placedRectDetails[rect.typeId]?.color) || '#ccc';

                        // Text Label Logic: Only dimensions
                        const textLabel = `${rect.width}x${rect.length}`;
                        const isRotatedText = (finalLength > finalWidth && finalWidth < 60);

                        return (
                          <React.Fragment key={rect.id}>
                            <KonvaRect
                              x={rectX}
                              y={rectY}
                              width={finalWidth}
                              height={finalLength}
                              fill={color}
                              stroke="white"
                              strokeWidth={1}
                              shadowBlur={2}
                              shadowOpacity={0.2}
                            />
                            {/* Re-implementing text rotation properly for Konva is tricky. 
                                   Let's refine:
                                   If rotated, we center the text at the center of the rect.
                               */}
                            {isRotatedText ? (
                              <KonvaText
                                x={rectX + finalWidth / 2}
                                y={rectY + finalLength / 2}
                                text={textLabel}
                                fontSize={fontSize}
                                fill="white"
                                fontStyle="bold"
                                align="center"
                                verticalAlign="middle"
                                rotation={-90}
                                // Default Konva Text centering:
                                width={finalLength} // Swap dim for text area
                                height={finalWidth}
                                offsetX={finalLength / 2}
                                offsetY={finalWidth / 2}
                              />
                            ) : (
                              <KonvaText
                                x={rectX}
                                y={rectY}
                                width={finalWidth}
                                height={finalLength}
                                text={textLabel}
                                fontSize={fontSize}
                                fill="white"
                                fontStyle="bold"
                                align="center"
                                verticalAlign="middle"
                              />
                            )}


                          </React.Fragment>
                        );
                      })}
                    </Layer>
                  </Stage>
                )}

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
                      {snapEnabled && (
                        <div className="absolute inset-0 pointer-events-none z-40">
                          {snapGuides.x.map((x, i) => (
                            <div key={`snap-x-${i}`} className="absolute bg-red-500 opacity-70" style={isLandscape ? { left: `${x * scale}px`, top: 0, bottom: 0, width: '1px' } : { top: `${x * scale}px`, left: 0, right: 0, height: '1px' }} />
                          ))}
                          {snapGuides.y.map((y, i) => (
                            <div key={`snap-y-${i}`} className="absolute bg-red-500 opacity-70" style={isLandscape ? { top: `${y * scale}px`, left: 0, right: 0, height: '1px' } : { left: `${y * scale}px`, top: 0, bottom: 0, width: '1px' }} />
                          ))}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 opacity-30" style={{ left: `${mousePos.x}px`, display: mousePos.x > 0 ? 'block' : 'none' }} />
                          <div className="absolute left-0 right-0 h-0.5 bg-blue-400 opacity-30" style={{ top: `${mousePos.y}px`, display: mousePos.y > 0 ? 'block' : 'none' }} />
                        </div>
                      )}

                      <div
                        className={`absolute border-4 bg-opacity-70 z-50 flex items-center justify-center text-white font-bold shadow-2xl ${isSnapped ? 'border-red-500' : 'border-dashed border-blue-500 animate-pulse'}`}
                        style={{
                          left: `${visualLeft}px`,
                          top: `${visualTop}px`,
                          width: `${pickedFinalWidth}px`,
                          height: `${pickedFinalHeight}px`,
                          backgroundColor: pickedUpRect.color,
                          pointerEvents: 'none',
                          transition: isSnapped ? 'all 50ms ease-out' : 'none'
                        }}
                      >
                        <div className="text-sm font-bold bg-black bg-opacity-50 px-2 py-1 rounded">
                          {pickedUpRect.width}×{pickedUpRect.length}
                          <div className="text-xs opacity-75">R để xoay | ESC hủy {isSnapped && <span className="text-red-300"> | SNAPPED!</span>}</div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            <span className="text-gray-500 font-medium">Tổng cộng {dynamicTotalStats.totalLayers} tấm</span>
          </div>
          <div className="text-xs md:text-sm text-gray-700 font-semibold">
            Hiệu suất tổng thể: <span className="text-base md:text-xl text-blue-600">{dynamicTotalStats.efficiency.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <RectangleContextMenu
        menu={{ ...contextMenu, onClose: () => setContextMenu({ visible: false }) }}
        onRotate={handleRotateSelected}
        onDelete={handleDeleteSelected}
      />
      {isHelpModalOpen && <HelpModal onClose={() => setIsHelpModalOpen(false)} />}
    </div>
  );
};

export default PackingResult;