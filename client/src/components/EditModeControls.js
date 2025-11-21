// client/src/components/EditModeControls.js
import React from 'react';

// --- Icon SVGs ---
// (Các icon này được nhúng trực tiếp để đơn giản, bạn có thể tách ra file riêng nếu muốn)

const HelpIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const SnapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const NoSnapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
  </svg>
);

const PanelCollapseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
  </svg>
);
const PanelExpandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
  </svg>
);

// --- Component trợ giúp cho các nút bấm ---
const ActionButton = ({ onClick, disabled, label, isDanger = false, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className={`p-2 rounded-lg transition-all
      ${
        isDanger 
          ? 'text-red-500 hover:bg-red-100 disabled:text-red-200' 
          : 'text-gray-600 hover:bg-gray-100 disabled:text-gray-300'
      }
      disabled:opacity-50 disabled:cursor-not-allowed
    `}
  >
    {children}
  </button>
);

// --- Component chính ---
const EditModeControls = ({
  isEditMode,
  onToggleEditMode,
  selectedRectangles,
  onDeleteSelected,
  snapEnabled,
  onToggleSnap,
  snapThreshold,
  onSnapThresholdChange,
  onSaveChanges,
  onCancelEdit,
  hasUnsavedChanges,
  onExportAllPdf,
  isExporting,
  totalPlates,
  isPaletteOpen,
  onTogglePalette,
  pickedUpRect,
  onShowHelp,
}) => {

  const hasSelection = selectedRectangles && selectedRectangles.length > 0;
  const hasHeldItem = !!pickedUpRect;

  return (
    <div className="mb-3 card p-3 md:p-2 bg-gray-50 border-t-4 border-primary-500 rounded-b-xl shadow-lg">
      <div className="flex flex-row flex-wrap justify-between items-center gap-3">
        
        {/* Nút Bật/Tắt Chế độ Chỉnh sửa */}
        <div className="flex-shrink-0">
          <button
            onClick={onToggleEditMode}
            className={`px-4 py-2 text-sm font-semibold transition-all duration-300 rounded-lg shadow-md hover:-translate-y-0.5 ${
              isEditMode 
                ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white' 
                : 'btn-primary'
            }`}
          >
            {isEditMode ? '🔒 Thoát Chỉnh sửa' : '✏️ Mở Chế độ Chỉnh sửa'}
          </button>
        </div>
        
        {/* Nút Xuất PDF (CHỈ HIỂN THỊ KHI KHÔNG CHỈNH SỬA) */}
        {!isEditMode && (
          <div className="flex-shrink-0">
            <button 
              onClick={onExportAllPdf} // Dùng prop mới
              disabled={isExporting || totalPlates === 0} // Dùng prop mới
              className="px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-sm hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isExporting 
                ? 'Đang xử lý...' 
                : `Xuất PDF `}
            </button>
          </div>
        )}

        {/* Bảng điều khiển (chỉ hiển thị khi isEditMode = true) */}
        {isEditMode && (
          <div className="flex-1 w-full flex flex-col lg:flex-row justify-end items-center gap-3">
            {/*Nút thu/mở */}
            <div className="flex items-center justify-center p-1 bg-white rounded-lg shadow-inner border">
              <ActionButton
                onClick={onTogglePalette}
                disabled={false}
                label={isPaletteOpen ? "Thu gọn Kho" : "Mở Kho"}
              >
                {isPaletteOpen ? <PanelCollapseIcon /> : <PanelExpandIcon />}
              </ActionButton>
            </div>
            <div className="flex items-center justify-center p-1 bg-white rounded-lg shadow-inner border">
              <ActionButton
                onClick={onShowHelp}
                label="Mở Hướng Dẫn (F1)"
              >
                <HelpIcon />
              </ActionButton>
            </div>
            {/* Các nút hành động */}
            <div className="flex items-center justify-center gap-1 p-1 bg-white rounded-lg shadow-inner border">
              <ActionButton
                onClick={() => onDeleteSelected()}
                disabled={!hasSelection && !hasHeldItem}
                label="Xóa (Delete)"
                isDanger={true}
              >
                <TrashIcon />
              </ActionButton>
            </div>

            {/* Điều khiển Snap */}
            <div className="flex items-center gap-2 p-2 bg-white rounded-lg shadow-inner border">
              <button
                onClick={onToggleSnap}
                className="p-2 rounded-lg transition-colors bg-gray-100 hover:bg-gray-200"
                title={snapEnabled ? "Tắt Snap (S)" : "Bật Snap (S)"}
              >
                {snapEnabled ? <SnapIcon /> : <NoSnapIcon />}
              </button>
              <label htmlFor="snap-threshold" className="text-xs font-medium text-gray-600 whitespace-nowrap">Độ nhạy:</label>
              <input
                id="snap-threshold"
                type="range"
                min="2"
                max="30"
                step="1"
                value={snapThreshold}
                onChange={(e) => onSnapThresholdChange(Number(e.target.value))}
                className="w-20 md:w-24"
              />
              <span className="text-sm font-semibold text-gray-700 w-6 text-right">{snapThreshold}</span>
            </div>

            {/* Lưu / Hủy */}
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-xs font-medium text-red-600 animate-pulse hidden xl:inline">
                  (Chưa lưu)
                </span>
              )}
              <button
                onClick={onCancelEdit}
                className="btn-secondary text-sm px-3 py-2"
                disabled={!hasUnsavedChanges}
                title="Hủy bỏ mọi thay đổi"
              >
                Hủy
              </button>
              <button
                onClick={onSaveChanges}
                className="btn-primary text-sm px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
                disabled={!hasUnsavedChanges}
                title="Lưu các thay đổi của tấm liệu này"
              >
                Lưu
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    
  );
};

export default EditModeControls;