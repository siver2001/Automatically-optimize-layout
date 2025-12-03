import React, { memo } from 'react';

const DraggableRectangle = ({
  rect,
  scale,
  isLandscape,
  isSelected,
  onPickUp,
  onContextMenu,
}) => {
  // Tính kích thước hiển thị dựa trên data hiện tại
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

  const dimensionsText = `${rect.width}×${rect.length}`;

  return (
    <div
      className={`rectangle-item absolute border-2 shadow-xl flex items-center justify-center text-white font-bold cursor-grab hover:shadow-2xl transition-all duration-200 ${isSelected ? 'ring-4 ring-blue-400 ring-offset-2 border-blue-500' : 'border-white hover:border-yellow-300'
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
        // Loại bỏ transform scale khi không cần thiết để giảm tải GPU
        transform: isSelected ? 'scale(1.02)' : 'none'
      }}
      onClick={handleClick}
      onContextMenu={handleRightClick}
      title={`${dimensionsText}mm ${rect.rotated ? '(Đã xoay)' : ''} - Click để nhấc | Chuột phải để menu`}
    >
      <div
        className="text-[0.65em] md:text-xs pointer-events-none whitespace-nowrap font-bold"
        style={{
          transform: (finalHeight > finalWidth && finalWidth < 60) ? 'rotate(-90deg)' : 'none',
        }}
      >
        {dimensionsText}
      </div>
      {isSelected && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping"></div>
      )}
    </div>
  );
};

// CÁCH 1: Dùng memo với hàm so sánh tùy chỉnh (Custom Comparator)
function arePropsEqual(prevProps, nextProps) {
  return (
    prevProps.rect === nextProps.rect &&
    prevProps.scale === nextProps.scale &&
    prevProps.isLandscape === nextProps.isLandscape &&
    prevProps.isSelected === nextProps.isSelected
    // Không cần so sánh onPickUp và onContextMenu vì chúng ta sẽ xử lý ở Cách 2
  );
}

export default memo(DraggableRectangle, arePropsEqual);