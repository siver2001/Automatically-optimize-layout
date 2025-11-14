// client/src/components/HelpModal.js
import React from 'react';

// Icon 'X' để đóng
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const HelpModal = ({ onClose }) => {
  return (
    // Lớp nền mờ (Overlay)
    <div 
      className="fixed inset-0 bg-black bg-opacity-60 z-[100] flex justify-center items-center p-4"
      onClick={onClose} // Click nền để đóng
    >
      {/* Nội dung Modal */}
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()} // Ngăn click bên trong modal đóng modal
      >
        {/* Nút Đóng (Góc trên bên phải) */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-800 transition-colors z-10 p-1 rounded-full hover:bg-gray-100"
          title="Đóng"
        >
          <CloseIcon />
        </button>

        {/* --- BÊN DƯỚI LÀ NỘI DUNG SAO CHÉP TỪ EditModeHelp.js CŨ --- */}
        <div className="p-6 md:p-8">
          <h4 className="font-bold text-2xl text-blue-900 mb-4 flex items-center gap-2">
            📖 Hướng Dẫn Chế Độ Chỉnh Sửa
          </h4>
          
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            {/* Cột 1: Chuột */}
            <div className="space-y-3">
              <h5 className="font-semibold text-lg text-blue-800 mb-2 flex items-center gap-1">
                🖱️ Thao Tác Chuột
              </h5>
              <div className="space-y-2 text-gray-700">
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">Click</span>
                  <span>Nhấc hình lên (click lần 1) hoặc đặt xuống (click lần 2)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">Chuột phải</span>
                  <span>Mở menu nhanh (Xoay/Xóa)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">Di chuột</span>
                  <span>Khi đang cầm hình, di chuyển để xem vị trí mới</span>
                </div>
              </div>
            </div>

            {/* Cột 2: Bàn phím */}
            <div className="space-y-3">
              <h5 className="font-semibold text-lg text-blue-800 mb-2 flex items-center gap-1">
                ⌨️ Phím Tắt
              </h5>
              <div className="space-y-2 text-gray-700">
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">R</span>
                  <span>Xoay 90° (khi đang cầm hình)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">ESC</span>
                  <span>Hủy bỏ và đặt hình về chỗ cũ</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-300 font-mono text-xs flex-shrink-0">Delete</span>
                  <span>Gỡ các hình đã chọn (chuyển vào kho)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tính năng Snap */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <h5 className="font-semibold text-lg text-blue-800 mb-2 flex items-center gap-1">
              ⚡ Tính Năng Snap (Dính Tự Động)
            </h5>
            <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
              <li>Tự động căn chỉnh với các hình khác khi đặt xuống</li>
              <li>Dính vào lưới (grid) theo độ nhạy đã chọn</li>
              <li>Căn vào các cạnh của tấm liệu</li>
            </ul>
          </div>

          {/* Tips */}
          <div className="mt-4 p-3 bg-yellow-50 rounded border border-yellow-200">
            <p className="text-sm text-yellow-800">
              <strong>💡 Mẹo:</strong> Giảm độ nhạy Snap nếu khó đặt chính xác. Tăng lên nếu muốn căn chỉnh nhanh!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpModal;