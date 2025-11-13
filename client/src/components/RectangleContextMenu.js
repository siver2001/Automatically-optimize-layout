// client/src/components/RectangleContextMenu.js
import React from 'react';

// Icons đơn giản cho menu
const RotateIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ContextMenuItem = ({ children, onClick, isDanger = false }) => (
  <li
    className={`px-3 py-2 text-sm flex items-center cursor-pointer ${
      isDanger
        ? 'text-red-600 hover:bg-red-50'
        : 'text-gray-700 hover:bg-gray-100'
    }`}
    onClick={onClick}
  >
    {children}
  </li>
);

const RectangleContextMenu = ({ menu, onRotate, onDelete }) => {
  if (!menu.visible) return null;

  const handleRotate = (e) => {
    e.stopPropagation(); // Ngăn click lan ra ngoài
    onRotate(menu.targetRect.id);
    menu.onClose(); // Đóng menu
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(menu.targetRect.id);
    menu.onClose();
  };

  return (
    <div
      className="fixed z-[100] bg-white shadow-lg rounded-lg border border-gray-200 w-40"
      style={{
        top: `${menu.y}px`,
        left: `${menu.x}px`,
      }}
    >
      <ul className="py-1">
        <ContextMenuItem onClick={handleRotate}>
          <RotateIcon /> Xoay 90°
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDelete} isDanger={true}>
          <TrashIcon /> Xóa Size
        </ContextMenuItem>
        {/* Bạn có thể thêm các chức năng khác (nhân bản, v.v.) ở đây */}
      </ul>
    </div>
  );
};

export default RectangleContextMenu;