import React from 'react';

const ExportSheetPickerModal = ({
  isOpen,
  format,
  items,
  selectedSheetIndexes,
  isSubmitting,
  onClose,
  onToggleSheet,
  onSelectAll,
  onClearAll,
  onConfirm
}) => {
  if (!isOpen) return null;

  const selectedCount = selectedSheetIndexes.length;
  const formatLabel = format === 'dxf' ? 'DXF' : format === 'cyc' ? 'CYC' : 'PDF';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-white font-bold text-base">Chọn tấm để xuất {formatLabel}</h3>
            <p className="text-white/45 text-xs mt-1">
              Có thể chọn 1 tấm, nhiều tấm hoặc toàn bộ. Hiện đang chọn {selectedCount}/{items.length} mục.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm disabled:opacity-40"
          >
            Đóng
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onSelectAll}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs border border-emerald-400/20 disabled:opacity-40"
            >
              Chọn tất cả
            </button>
            <button
              onClick={onClearAll}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-xs border border-white/10 disabled:opacity-40"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <div className="text-white/45 text-xs">
            {selectedCount === 0 ? 'Chưa chọn tấm nào' : `Sẽ xuất ${selectedCount} tấm`}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto custom-scrollbar px-5 py-4 space-y-2">
          {items.map((item, index) => {
            const isSelected = selectedSheetIndexes.includes(index);
            return (
              <label
                key={index}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-sky-400/30 bg-sky-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSheet(index)}
                  disabled={isSubmitting}
                  className="h-4 w-4 rounded border-white/20 bg-black/20 text-sky-500 focus:ring-sky-500/40"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm">{item?.label || `Tấm ${index + 1}`}</div>
                  <div className="text-white/45 text-xs mt-1 flex items-center gap-2 flex-wrap">
                    <span>{item?.sheet?.sheetWidth || 0}×{item?.sheet?.sheetHeight || 0} mm</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{item?.placedCount ?? item?.sheet?.placedCount ?? item?.sheet?.placed?.length ?? 0} chiếc</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{item?.efficiency ?? item?.sheet?.efficiency ?? 0}% hiệu suất</span>
                    {item?.metaLabel ? (
                      <>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span>{item.metaLabel}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm disabled:opacity-40"
          >
            Hủy
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting || selectedCount === 0}
            className="px-4 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-sm border border-sky-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Đang xuất...' : `Xuất ${formatLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportSheetPickerModal;
