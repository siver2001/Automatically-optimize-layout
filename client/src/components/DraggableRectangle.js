// client/src/components/DraggableRectangle.js
import React from 'react';

const DraggableRectangle = ({
  rect,
  scale,
  isLandscape,
  isSelected,
  onPickUp, // <-- Prop mới: chỉ để nhấc lên
  onContextMenu, // <-- Prop mới: cho chuột phải
}) => {
  // Logic render tĩnh, không còn 'react-draggable'
  const rectWidth = rect.width * scale;
  const rectLength = rect.length * scale;
  
  // Logic hoán đổi nếu isLandscape
  // LƯU Ý: Giả định của bạn là isLandscape = false (container dọc)
  // Nếu container ngang (isLandscape = true) thì logic (rectX, rectY, finalWidth, finalLength) phải đổi lại
  const rectX = isLandscape ? rect.x * scale : rect.y * scale;
  const rectY = isLandscape ? rect.y * scale : rect.x * scale;
  const finalWidth = isLandscape ? rectWidth : rectLength;
  const finalLength = isLandscape ? rectLength : rectWidth;

  const minDim = Math.min(finalWidth, finalLength);
  const fontSize = Math.max(8, Math.min(16, minDim * 0.15));

  const handleClick = (e) => {
    e.stopPropagation(); // Rất quan trọng: Ngăn click lan ra container
    onPickUp(rect);
  };

  const handleRightClick = (e) => {
    e.stopPropagation(); // Ngăn click lan ra container
    onContextMenu(e, rect);
  };

  return (
    <div
      className={`absolute border border-white shadow-xl flex items-center justify-center text-white font-bold cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-offset-2 ring-blue-500' : ''
      }`}
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
        zIndex: 20 // Nổi lên trên grid
      }}
      onClick={handleClick}
      onContextMenu={handleRightClick}
      title={`${rect.width}×${rect.length} (Click để di chuyển)`}
    >
      <div className="text-[0.65em] md:text-xs">{rect.width}×{rect.length}</div>
    </div>
  );
};

export default DraggableRectangle;