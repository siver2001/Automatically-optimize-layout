// client/src/components/DraggableRectangle.js
import React from 'react';

const DraggableRectangle = ({
  rect,
  scale,
  isLandscape,
  isSelected,
  onPickUp,
  onContextMenu,
}) => {
  const rectWidth = rect.width * scale;
  const rectLength = rect.length * scale;
  
  const rectX = isLandscape ? rect.x * scale : rect.y * scale;
  const rectY = isLandscape ? rect.y * scale : rect.x * scale;
  const finalWidth = isLandscape ? rectWidth : rectLength;
  const finalLength = isLandscape ? rectLength : rectWidth;

  const minDim = Math.min(finalWidth, finalLength);
  const fontSize = Math.max(8, Math.min(16, minDim * 0.15));

  const handleClick = (e) => {
    e.stopPropagation(); // Ngăn click lan ra container
    onPickUp(rect);
  };

  const handleRightClick = (e) => {
    e.preventDefault(); // Ngăn context menu mặc định
    e.stopPropagation();
    onContextMenu(e, rect);
  };

  return (
    <div
      className={`rectangle-item absolute border-2 shadow-xl flex items-center justify-center text-white font-bold cursor-grab hover:shadow-2xl transition-all duration-200 ${
        isSelected ? 'ring-4 ring-blue-400 ring-offset-2 border-blue-500' : 'border-white hover:border-yellow-300'
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
        zIndex: isSelected ? 30 : 20,
        transform: isSelected ? 'scale(1.02)' : 'scale(1)'
      }}
      onClick={handleClick}
      onContextMenu={handleRightClick}
      title={`${rect.width}×${rect.length}mm - Click để nhấc | Chuột phải để menu`}
    >
      <div className="text-[0.65em] md:text-xs pointer-events-none">
        {rect.width}×{rect.length}
      </div>
      {isSelected && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping"></div>
      )}
    </div>
  );
};

export default DraggableRectangle;