// client/src/components/SplitRestrictionModal.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom'; // 👈 Import ReactDOM để dùng Portal

const SplitRestrictionModal = ({ 
  isOpen, 
  onClose, 
  rectangles, 
  initialRestrictedIds, 
  onSave 
}) => {
  const [restrictedIds, setRestrictedIds] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setRestrictedIds(initialRestrictedIds || []);
    }
  }, [isOpen, initialRestrictedIds]);

  const toggleId = (id) => {
    setRestrictedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  if (!isOpen) return null;

  // 👇 Dùng Portal để đưa Modal ra ngoài cùng của DOM (gắn vào body)
  // Giúp nó không bị giới hạn bởi khung "Quản lý size"
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
      {/* Click ra ngoài để đóng */}
      <div className="absolute inset-0" onClick={onClose}></div>

      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden relative z-10 transform transition-all scale-100 animate-scale-up">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-500 px-6 py-4 border-b border-primary-700 flex justify-between items-center shadow-md">
          <h3 className="text-white font-bold text-lg flex items-center gap-2">
            🔒 Tuỳ chọn chia size
          </h3>
          <button onClick={onClose} className="text-primary-100 hover:text-white text-2xl leading-none transition-transform hover:rotate-90">&times;</button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar bg-gray-50">
          <p className="text-gray-600 text-sm mb-4 bg-blue-50 p-3 rounded-lg border border-blue-200">
            ℹ️ Các size được tích chọn (✔) sẽ <b>giữ nguyên (không chia)</b>. Các size còn lại sẽ được tự động chia đôi để tối ưu diện tích.
          </p>

          <div className="space-y-2">
            {rectangles.length === 0 ? (
              <div className="text-center text-gray-400 py-8 border-2 border-dashed rounded-lg">Chưa có size nào được chọn để cấu hình.</div>
            ) : (
              rectangles.map((rect) => (
                <label 
                  key={rect.id} 
                  className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all duration-200 group ${
                    restrictedIds.includes(rect.id) 
                      ? 'bg-white border-primary-500 shadow-md ring-1 ring-primary-500' 
                      : 'bg-white border-gray-200 hover:border-primary-300 hover:shadow-sm'
                  }`}
                >
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={restrictedIds.includes(rect.id)}
                      onChange={() => toggleId(rect.id)}
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-gray-300 transition-all checked:border-primary-500 checked:bg-primary-500"
                    />
                    {/* Custom checkmark icon */}
                    <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none opacity-0 peer-checked:opacity-100 text-white transition-opacity" viewBox="0 0 14 10" fill="none">
                        <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>

                  <div className="ml-3 flex-1">
                    <div className="flex justify-between items-center">
                      <span className={`font-semibold transition-colors ${restrictedIds.includes(rect.id) ? 'text-primary-700' : 'text-gray-700'}`}>
                        {rect.name}
                      </span>
                      <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 group-hover:bg-white">
                        {rect.width} x {rect.length}
                      </span>
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white px-6 py-4 border-t flex justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-gray-600 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 font-medium transition-colors"
          >
            Hủy bỏ
          </button>
          <button 
            onClick={() => onSave(restrictedIds)}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-bold shadow-lg shadow-primary-200 hover:shadow-primary-300 transition-all transform active:scale-95 flex items-center gap-2"
          >
            <span>Xác nhận</span>
            {restrictedIds.length > 0 && <span className="bg-primary-800 text-xs px-2 py-0.5 rounded-full">{restrictedIds.length}</span>}
          </button>
        </div>
      </div>
    </div>,
    document.body // 👈 Gắn vào body
  );
};

export default SplitRestrictionModal;