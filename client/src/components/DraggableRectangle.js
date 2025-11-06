// client/src/components/DraggableRectangle.js
import React, { useState, useCallback, useRef, useEffect } from 'react';

const DraggableRectangle = ({ 
  rect, 
  scale, 
  isLandscape,
  onDragStart,
  onDrag,
  onDragEnd,
  snapPoints,
  snapThreshold = 10,
  isSelected,
  onSelect,
  containerBounds,
  allRectangles
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [snapIndicators, setSnapIndicators] = useState([]);
  const rectRef = useRef(null);

  // Tính toán vị trí hiển thị
  const rectWidth = rect.width * scale;
  const rectLength = rect.length * scale;
  const rectX = isLandscape ? rect.x * scale : rect.y * scale;
  const rectY = isLandscape ? rect.y * scale : rect.x * scale;
  const finalWidth = isLandscape ? rectWidth : rectLength;
  const finalLength = isLandscape ? rectLength : rectWidth;

  // Hàm tìm điểm snap gần nhất
  const findSnapPoint = useCallback((x, y) => {
    const snaps = [];
    const threshold = snapThreshold / scale;

    // Snap to grid
    const gridSize = 50; // 50mm grid
    const gridX = Math.round(x / gridSize) * gridSize;
    const gridY = Math.round(y / gridSize) * gridSize;
    
    if (Math.abs(x - gridX) < threshold) {
      snaps.push({ 
        x: gridX, 
        y: y, 
        type: 'grid-vertical',
        displayX: gridX * scale
      });
    }
    if (Math.abs(y - gridY) < threshold) {
      snaps.push({ 
        x: x, 
        y: gridY, 
        type: 'grid-horizontal',
        displayY: gridY * scale
      });
    }

    // Snap to other rectangles
    allRectangles.forEach(other => {
      if (other.id === rect.id) return;

      // Snap to edges
      const edges = [
        { x: other.x, type: 'left' },
        { x: other.x + other.width, type: 'right' },
        { y: other.y, type: 'top' },
        { y: other.y + other.length, type: 'bottom' }
      ];

      edges.forEach(edge => {
        if (edge.x !== undefined && Math.abs(x - edge.x) < threshold) {
          snaps.push({ 
            x: edge.x, 
            y: y, 
            type: `edge-${edge.type}`,
            displayX: edge.x * scale
          });
        }
        if (edge.y !== undefined && Math.abs(y - edge.y) < threshold) {
          snaps.push({ 
            x: x, 
            y: edge.y, 
            type: `edge-${edge.type}`,
            displayY: edge.y * scale
          });
        }
      });

      // Snap to center alignment
      const otherCenterX = other.x + other.width / 2;
      const otherCenterY = other.y + other.length / 2;
      const thisCenterX = x + rect.width / 2;
      const thisCenterY = y + rect.length / 2;

      if (Math.abs(thisCenterX - otherCenterX) < threshold) {
        snaps.push({
          x: otherCenterX - rect.width / 2,
          y: y,
          type: 'center-vertical',
          displayX: otherCenterX * scale
        });
      }
      if (Math.abs(thisCenterY - otherCenterY) < threshold) {
        snaps.push({
          x: x,
          y: otherCenterY - rect.length / 2,
          type: 'center-horizontal',
          displayY: otherCenterY * scale
        });
      }
    });

    return snaps;
  }, [rect, scale, snapThreshold, allRectangles]);

  // Apply snapping
  const applySnapping = useCallback((x, y) => {
    const snaps = findSnapPoint(x, y);
    let snappedX = x;
    let snappedY = y;
    const activeSnaps = [];

    snaps.forEach(snap => {
      if (snap.x !== undefined && snap.x !== x) {
        snappedX = snap.x;
        activeSnaps.push(snap);
      }
      if (snap.y !== undefined && snap.y !== y) {
        snappedY = snap.y;
        activeSnaps.push(snap);
      }
    });

    setSnapIndicators(activeSnaps);
    return { x: snappedX, y: snappedY };
  }, [findSnapPoint]);

  // Mouse down handler
  const handleMouseDown = useCallback((e) => {
    e.stopPropagation();
    
    const rect = rectRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    
    setDragOffset({ x: offsetX, y: offsetY });
    setIsDragging(true);
    onSelect?.(rect.id);
    onDragStart?.(rect);
  }, [onDragStart, onSelect]);

  // Mouse move handler
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const container = containerBounds;
      if (!container) return;

      // Tính toán vị trí mới (trong không gian logic, không phải pixel)
      let newX = (e.clientX - container.left - dragOffset.x) / scale;
      let newY = (e.clientY - container.top - dragOffset.y) / scale;

      // Convert back to logic coordinates if landscape
      if (isLandscape) {
        // newX, newY are already correct
      } else {
        [newX, newY] = [newY, newX];
      }

      // Apply snapping
      const snapped = applySnapping(newX, newY);
      newX = snapped.x;
      newY = snapped.y;

      // Boundary check
      newX = Math.max(0, Math.min(newX, (isLandscape ? containerBounds.width : containerBounds.height) / scale - rect.width));
      newY = Math.max(0, Math.min(newY, (isLandscape ? containerBounds.height : containerBounds.width) / scale - rect.length));

      onDrag?.({
        ...rect,
        x: newX,
        y: newY
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setSnapIndicators([]);
      onDragEnd?.(rect);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, scale, isLandscape, rect, onDrag, onDragEnd, applySnapping, containerBounds]);

  const minDim = Math.min(finalWidth, finalLength);
  const fontSize = Math.max(8, Math.min(16, minDim * 0.15));

  return (
    <>
      {/* Snap indicators */}
      {snapIndicators.map((snap, idx) => (
        <div
          key={idx}
          className="absolute pointer-events-none"
          style={{
            left: snap.displayX !== undefined ? `${snap.displayX}px` : 0,
            top: snap.displayY !== undefined ? `${snap.displayY}px` : 0,
            width: snap.type.includes('vertical') ? '2px' : '100%',
            height: snap.type.includes('horizontal') ? '2px' : '100%',
            backgroundColor: snap.type.includes('grid') ? '#4CAF50' : '#2196F3',
            opacity: 0.6,
            zIndex: 1000
          }}
        />
      ))}

      {/* Rectangle */}
      <div
        ref={rectRef}
        className={`absolute border transition-all duration-150 ${
          isDragging ? 'cursor-grabbing shadow-2xl z-50' : 'cursor-grab'
        } ${
          isSelected ? 'border-4 border-yellow-400 shadow-xl' : 'border-white shadow-lg'
        } hover:shadow-2xl hover:z-40`}
        style={{
          left: `${rectX}px`,
          top: `${rectY}px`,
          width: `${finalWidth}px`,
          height: `${finalLength}px`,
          backgroundColor: rect.color,
          opacity: isDragging ? 0.7 : (1 - (rect.layer / 10) * 0.4),
          transform: isDragging ? 'scale(1.05)' : 'scale(1)',
          minWidth: '20px',
          minHeight: '15px',
        }}
        onMouseDown={handleMouseDown}
        title={`${rect.name} (${rect.width}×${rect.length}mm) - Click để chọn, kéo để di chuyển`}
      >
        <div className="w-full h-full flex items-center justify-center text-white font-bold pointer-events-none" style={{ fontSize: `${fontSize}px` }}>
          <div className="text-center leading-none p-0.5">
            <div className="text-[0.65em] md:text-xs">{rect.width}×{rect.length}</div>
          </div>
        </div>

        {/* Selection corners */}
        {isSelected && (
          <>
            <div className="absolute top-0 left-0 w-2 h-2 bg-yellow-400 rounded-full -mt-1 -ml-1" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-yellow-400 rounded-full -mt-1 -mr-1" />
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-yellow-400 rounded-full -mb-1 -ml-1" />
            <div className="absolute bottom-0 right-0 w-2 h-2 bg-yellow-400 rounded-full -mb-1 -mr-1" />
          </>
        )}
      </div>
    </>
  );
};

export default DraggableRectangle;