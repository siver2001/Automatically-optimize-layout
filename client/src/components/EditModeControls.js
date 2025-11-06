// client/src/components/EditModeControls.js
import React from 'react';

// --- Icon SVGs ---
// (Các icon này được nhúng trực tiếp để đơn giản, bạn có thể tách ra file riêng nếu muốn)

const RotateIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15" />
  </svg>
);

const AlignLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v16" />
  </svg>
);

const AlignCenterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16" />
  </svg>
);

const AlignTopIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 13l-7-7-7 7m14-4l-7-7-7 7" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h16" />
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
  onRotateSelected,
  onAlignSelected,
  snapEnabled,
  onToggleSnap,
  snapThreshold,
  onSnapThresholdChange,
  onSaveChanges,
  onCancelEdit,
  hasUnsavedChanges
}) => {

  const hasSelection = selectedRectangles && selectedRectangles.length > 0;
  const hasMultiSelection = selectedRectangles && selectedRectangles.length > 1;

  return (
    <div className="mb-3 card p-3 md:p-2 bg-gray-50 border-t-4 border-primary-500 rounded-b-xl shadow-lg">
      <div className="flex flex-col md:flex-row justify-between items-center gap-3">
        
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
            {isEditMode ? '🔒 Thoát Chế độ Chỉnh sửa' : '✏️ Mở Chế độ Chỉnh sửa'}
          </button>
        </div>

        {/* Bảng điều khiển (chỉ hiển thị khi isEditMode = true) */}
        {isEditMode && (
          <div className="flex-1 w-full flex flex-col lg:flex-row justify-end items-center gap-3">
            
            {/* Các nút hành động */}
            <div className="flex items-center justify-center gap-1 p-1 bg-white rounded-lg shadow-inner border">
              <ActionButton
                onClick={onRotateSelected}
                disabled={!hasSelection}
                label="Xoay 90° (R)"
              >
                <RotateIcon />
              </ActionButton>
              <ActionButton
                onClick={() => onAlignSelected('left')}
                disabled={!hasMultiSelection}
                label="Căn Trái"
              >
                <AlignLeftIcon />
              </ActionButton>
              <ActionButton
                onClick={() => onAlignSelected('center')}
                disabled={!hasMultiSelection}
                label="Căn Giữa (Ngang)"
              >
                <AlignCenterIcon />
              </ActionButton>
              <ActionButton
                onClick={() => onAlignSelected('top')}
                disabled={!hasMultiSelection}
                label="Căn Trên"
              >
                <AlignTopIcon />
              </ActionButton>
              <ActionButton
                onClick={onDeleteSelected}
                disabled={!hasSelection}
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