// client/src/components/DraggableRectangle.js
// Nâng cấp: Thêm prop isLandscape để đồng bộ cách hiển thị với chế độ static, đảm bảo tọa độ và kích thước được swap đúng khi container portrait.
// Không swap kích thước hiển thị dựa trên rotated ở đây nữa, mà giữ nguyên data (width along x, length along y), và chỉ swap nếu !isLandscape.
// Hiển thị dimensions gốc (không swap) với flag rotated.

import React from 'react';

const DraggableRectangle = ({
  rect,
  scale,
  isLandscape,  // THÊM LẠI PROP NÀY
  isSelected,
  onPickUp,
  onContextMenu,
}) => {
  // Tính kích thước hiển thị dựa trên data hiện tại (width along internal x, length along internal y)
  const displayWidth = rect.width * scale;
  const displayLength = rect.length * scale;

  // Áp dụng swap nếu !isLandscape (để hiển thị ngang)
  const finalWidth = isLandscape ? displayWidth : displayLength;
  const finalHeight = isLandscape ? displayLength : displayWidth;

  // Tọa độ: swap nếu !isLandscape
  const rectX = (isLandscape ? rect.x : rect.y) * scale;
  const rectY = (isLandscape ? rect.y : rect.x) * scale;

  const minDim = Math.min(finalWidth, finalHeight);
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

  // Hiển thị kích thước gốc (width x length từ data), nhưng nếu rotated, có thể swap để show gốc nếu cần
  // Nhưng theo code gốc, giữ nguyên ${rect.width}×${rect.length}, giả sử data đã là current sau swap
  const dimensionsText = `${rect.width}×${rect.length}`;

  return (
    <div
      className={`rectangle-item absolute border-2 shadow-xl flex items-center justify-center text-white font-bold cursor-grab hover:shadow-2xl transition-all duration-200 ${
        isSelected ? 'ring-4 ring-blue-400 ring-offset-2 border-blue-500' : 'border-white hover:border-yellow-300'
      }`}
      style={{
        left: `${rectX}px`,
        top: `${rectY}px`,
        width: `${finalWidth}px`,
        height: `${finalHeight}px`,
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
      title={`${dimensionsText}mm ${rect.rotated ? '(Đã xoay)' : ''} - Click để nhấc | Chuột phải để menu`}
    >
      <div className="text-[0.65em] md:text-xs pointer-events-none">
        {dimensionsText}
      </div>
      {isSelected && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping"></div>
      )}
    </div>
  );
};

export default DraggableRectangle;