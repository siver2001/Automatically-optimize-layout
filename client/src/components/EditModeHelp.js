// client/src/components/EditModeHelp.js
import React, { useState } from 'react';

const HelpIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const EditModeHelp = ({ isVisible = true }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible) return null;

  return (
    <div className="mb-3 relative">
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-all text-sm font-medium border border-blue-200"
      >
        <HelpIcon />
        <span>{isExpanded ? 'Ẩn' : 'Hiện'} Hướng Dẫn Sử Dụng</span>
      </button>

      {/* Help Panel */}
      {isExpanded && (
        <div className="mt-2 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-200 shadow-lg">
          <h4 className="font-bold text-lg text-blue-900 mb-3 flex items-center gap-2">
            📖 Hướng Dẫn Chế Độ Chỉnh Sửa
          </h4>
          
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            {/* Cột 1: Chuột */}
            <div className="space-y-2">
              <h5 className="font-semibold text-blue-800 mb-2 flex items-center gap-1">
                🖱️ Thao Tác Chuột
              </h5>
              <div className="space-y-1.5 text-gray-700">
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">Click</span>
                  <span>Nhấc hình lên (click lần 1) hoặc đặt xuống (click lần 2)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">Chuột phải</span>
                  <span>Mở menu nhanh (Xoay/Xóa)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">Di chuột</span>
                  <span>Khi đang cầm hình, di chuyển để xem vị trí mới</span>
                </div>
              </div>
            </div>

            {/* Cột 2: Bàn phím */}
            <div className="space-y-2">
              <h5 className="font-semibold text-blue-800 mb-2 flex items-center gap-1">
                ⌨️ Phím Tắt
              </h5>
              <div className="space-y-1.5 text-gray-700">
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">R</span>
                  <span>Xoay 90° (khi đang cầm hình)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">ESC</span>
                  <span>Hủy bỏ và đặt hình về chỗ cũ</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">Delete</span>
                  <span>Xóa các hình đã chọn</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-xs flex-shrink-0">S</span>
                  <span>Bật/Tắt chế độ Snap (thanh công cụ)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tính năng Snap */}
          <div className="mt-4 pt-3 border-t border-blue-200">
            <h5 className="font-semibold text-blue-800 mb-2 flex items-center gap-1">
              ⚡ Tính Năng Snap (Dính Tự Động)
            </h5>
            <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
              <li>Tự động căn chỉnh với các hình khác khi đặt xuống</li>
              <li>Dính vào lưới (grid) theo độ nhạy đã chọn</li>
              <li>Căn giữa, căn cạnh với các hình lân cận</li>
              <li>Căn vào các cạnh của tấm liệu</li>
            </ul>
          </div>

          {/* Tips */}
          <div className="mt-3 p-2 bg-yellow-50 rounded border border-yellow-200">
            <p className="text-xs text-yellow-800">
              <strong>💡 Mẹo:</strong> Giảm độ nhạy Snap nếu khó đặt chính xác. Tăng lên nếu muốn căn chỉnh nhanh!
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditModeHelp;