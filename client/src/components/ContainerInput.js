// client/src/components/ContainerInput.js
import React, { useState, useEffect } from 'react';
import { usePacking } from '../context/PackingContext.js';

const ContainerInput = () => {
  const { container, setContainer, errors, clearErrors } = usePacking();
  const [localContainer, setLocalContainer] = useState(container);
  const [showSuccess, setShowSuccess] = useState(false); 

    useEffect(() => {
      if (showSuccess) {
        const timer = setTimeout(() => {
          setShowSuccess(false);
        }, 3000); 
        return () => clearTimeout(timer);
      }
    }, [showSuccess]);

  const handleInputChange = (field, value) => {
    // Chỉ parse nếu giá trị không rỗng, nếu không giữ lại string rỗng để kiểm soát input
    const numValue = value === '' ? '' : Math.max(1, parseFloat(value) || 1);
    setLocalContainer(prev => ({
      ...prev,
      [field]: numValue
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    clearErrors();
    setContainer({
        width: parseFloat(localContainer.width) || 0,
        length: parseFloat(localContainer.length) || 0,
        layers: parseInt(localContainer.layers) || 1
    });
    setShowSuccess(true);
  };

  const containerErrors = errors.filter(e => e.type === 'container');

  // Tính tỷ lệ hiển thị container preview
  const getContainerPreviewStyle = () => {
    if (!localContainer.width || !localContainer.length || localContainer.width <= 0 || localContainer.length <= 0) {
      // Giá trị mặc định cho preview nếu input không hợp lệ
      return { width: '250px', height: '100px' }; 
    }
    
    // Đảm bảo chiều rộng luôn lớn hơn chiều dài để hiển thị ngang (Landscape)
    const effectiveWidth = Math.max(localContainer.width, localContainer.length);
    const effectiveLength = Math.min(localContainer.width, localContainer.length);

    const maxWidth = 300; 
    const maxLength = 200; // Chiều dài giới hạn cho màn hình
    const aspectRatio = effectiveWidth / effectiveLength;
    
    let displayWidth, displayLength;

    if (aspectRatio > 1) {
      // Landscape: giới hạn theo chiều rộng tối đa
      displayWidth = maxWidth;
      displayLength = Math.min(maxLength, displayWidth / aspectRatio); // Giữ tỷ lệ
    } else {
      // Portrait hoặc Square: giới hạn theo chiều dài (chiều cao trên màn hình)
      displayLength = maxLength;
      displayWidth = Math.min(maxWidth, displayLength * aspectRatio); // Giữ tỷ lệ
    }
    
    // Nếu kích thước quá nhỏ, đặt kích thước tối thiểu để hiển thị
    displayWidth = Math.max(150, displayWidth); 
    displayLength = Math.max(80, displayLength);
    
    return {
      width: `${displayWidth}px`,
      height: `${displayLength}px`,
      minWidth: '150px',
      minHeight: '80px'
    };
  };

  return (
    <div className="mb-2 card p-2">
      <div className="flex items-center justify-between mb-6 border-b pb-3">
        {/* Tiêu đề */}
        <h2 className="text-gray-800 text-l font-semibold flex items-center gap-2">
          📐 Thiết kế tấm liệu
        </h2>
        
        {/* Thông báo thành công (Nằm cạnh tiêu đề) */}
        {showSuccess && containerErrors.length === 0 && (
          <div className="bg-green-100 border-l-2 border-green-500 px-2 py-1 rounded text-xs text-green-800 transition-opacity duration-500 flex-shrink-0">
            <div className="flex items-center gap-1 font-medium">
              🎉 Đã cập nhật thành công kích thước tấm liệu!
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Form */}
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label htmlFor="width" className="label">
                  📏 Chiều rộng (mm)
                </label>
                <input
                  id="width"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.1"
                  value={localContainer.width === 0 ? '' : localContainer.width}
                  onChange={(e) => handleInputChange('width', e.target.value)}
                  placeholder="e.g., 600.0"
                  className="input-field"
                  required
                />
              </div>
              
              <div className="flex flex-col">
                <label htmlFor="length" className="label">
                  📐 Chiều dài (mm)
                </label>
                <input
                  id="length"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.1"
                  value={localContainer.length === 0 ? '' : localContainer.length}
                  onChange={(e) => handleInputChange('length', e.target.value)}
                  placeholder="e.g., 500.0"
                  className="input-field"
                  required
                />
              </div>
            </div>
            
            <div className="flex items-end gap-4"> 
              
              {/* Số Lớp */}
              <div className="flex flex-col flex-1"> 
                <label htmlFor="layers" className="label">
                  📚 Số lớp
                </label>
                <input
                  id="layers"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={localContainer.layers || 1}
                  onChange={(e) => handleInputChange('layers', e.target.value)}
                  placeholder="Nhập số lớp..."
                  className="input-field"
                  required
                />
              </div>
              
              {/* Nút Cập nhật */}
              <button 
                type="submit" 
                className="btn-primary flex-0.5 min-w-[150px]" 
                disabled={!localContainer.width || !localContainer.length || localContainer.width <= 0 || localContainer.length <= 0}
              >
                ✅ Thiết kế tấm liệu
              </button>
            </div>
          </form>
          
          {/* Error Messages */}
          {containerErrors.length > 0 && (
            <div className="bg-red-100 border-l-4 border-red-500 p-3 rounded text-sm text-red-800">
              <div className="flex items-center gap-2 mb-1 font-semibold">
                ⚠️ Lỗi cấu hình:
              </div>
              {containerErrors.map((error, index) => (
                <div key={index} className="ml-2">
                  • {error.message}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Container Preview */}
        <div className="bg-white rounded-lg p-2 border border-gray-200 flex flex-col items-center justify-center space-y-4">

          <div className="flex flex-col items-center">
            <div 
              className="bg-blue-100 border-2 border-primary-500 rounded-lg shadow-xl flex items-center justify-center relative"
              style={getContainerPreviewStyle()}
            >
                <div className="text-center text-primary-800 font-bold p-2">
                  <div className="text-base leading-tight">
                    {localContainer.width > 0 ? localContainer.width : '?'}×{localContainer.length > 0 ? localContainer.length : '?'}
                  </div>
                  <div className="text-xs opacity-80">mm</div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContainerInput;