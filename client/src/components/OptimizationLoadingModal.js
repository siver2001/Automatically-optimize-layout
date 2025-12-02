// client/src/components/OptimizationLoadingModal.js
import React from 'react';
import ReactDOM from 'react-dom';

const OptimizationLoadingModal = ({ isOpen, progress }) => {
  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md flex flex-col items-center text-center transform transition-all scale-100 animate-scale-up border border-gray-100">
        
        {/* Icon hoặc Spinner lớn */}
        <div className="mb-6 relative">
          <div className="w-20 h-20 border-4 border-blue-100 rounded-full animate-spin-slow"></div>
          <div className="w-20 h-20 border-4 border-transparent border-t-blue-600 rounded-full animate-spin absolute top-0 left-0"></div>
          <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blue-600 font-bold text-lg">
            {progress}%
          </span>
        </div>

        {/* Dòng 1: Tiêu đề */}
        <h3 className="text-xl font-bold text-gray-800 mb-2">
          Đang chạy thuật toán tối ưu...
        </h3>

        {/* Thanh Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-4 mb-3 overflow-hidden relative">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out relative"
            style={{ width: `${progress}%` }}
          >
            {/* Hiệu ứng ánh sáng chạy qua thanh loading */}
            <div className="absolute top-0 left-0 bottom-0 right-0 bg-white opacity-20 w-full animate-shimmer"></div>
          </div>
        </div>

        {/* Dòng 2: Lời nhắn */}
        <p className="text-gray-500 text-sm font-medium animate-pulse">
          Vui lòng chờ, quá trình này có thể mất vài phút...
        </p>

      </div>
    </div>,
    document.body
  );
};

export default OptimizationLoadingModal;