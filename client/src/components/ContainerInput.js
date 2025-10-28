// client/src/components/ContainerInput.js
import React, { useState } from 'react';
import { usePacking } from '../context/PackingContext.js';

const ContainerInput = () => {
  const { container, setContainer, errors, clearErrors } = usePacking();
  const [localContainer, setLocalContainer] = useState(container);

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
        height: parseFloat(localContainer.height) || 0,
        layers: parseInt(localContainer.layers) || 1
    });
  };

  const containerErrors = errors.filter(e => e.type === 'container');

  // Tính tỷ lệ hiển thị container preview
  const getContainerPreviewStyle = () => {
    if (!localContainer.width || !localContainer.height || localContainer.width <= 0 || localContainer.height <= 0) {
      return { width: '200px', height: '150px' };
    }
    
    const maxWidth = 280; // Tăng kích thước xem trước
    const maxHeight = 180;
    const aspectRatio = localContainer.width / localContainer.height;
    
    let displayWidth, displayHeight;
    const scaleFactor = 4; 

    if (aspectRatio > 1) {
      displayWidth = Math.min(maxWidth, localContainer.width / scaleFactor); 
      displayHeight = displayWidth / aspectRatio;
    } else {
      displayHeight = Math.min(maxHeight, localContainer.height / scaleFactor);
      displayWidth = displayHeight * aspectRatio;
    }
    
    return {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      minWidth: '100px',
      minHeight: '75px'
    };
  };

  return (
    <div className="mb-8 card p-8">
      <h2 className="text-gray-800 text-2xl font-semibold mb-6 flex items-center gap-2 border-b pb-3">
        📐 Thiết kế tấm liệu
      </h2>
      
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
                <label htmlFor="height" className="label">
                  📐 Chiều dài (mm)
                </label>
                <input
                  id="height"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.1"
                  value={localContainer.height === 0 ? '' : localContainer.height}
                  onChange={(e) => handleInputChange('height', e.target.value)}
                  placeholder="e.g., 500.0"
                  className="input-field"
                  required
                />
              </div>
            </div>
            
            <div className="flex flex-col">
              <label htmlFor="layers" className="label">
                📚 Số lớp sắp xếp (Tối đa 10)
              </label>
              <input
                id="layers"
                type="number"
                min="1"
                max="10"
                step="1"
                value={localContainer.layers || 1}
                onChange={(e) => handleInputChange('layers', e.target.value)}
                placeholder="Nhập số lớp..."
                className="input-field"
                required
              />
            </div>
            
            <button 
              type="submit" 
              className="btn-primary w-full mt-4"
              disabled={!localContainer.width || !localContainer.height || localContainer.width <= 0 || localContainer.height <= 0}
            >
              ✅ Cập nhật diện tích tấm liệu
            </button>
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
        <div className="bg-white rounded-lg p-6 border border-gray-200 flex flex-col items-center justify-center space-y-4">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Preview Container</h3>

          <div className="flex flex-col items-center">
            <div 
              className="bg-blue-100 border-2 border-primary-500 rounded-lg shadow-xl flex items-center justify-center relative"
              style={getContainerPreviewStyle()}
            >
                <div className="text-center text-primary-800 font-bold p-2">
                  <div className="text-base leading-tight">
                    {localContainer.width > 0 ? localContainer.width : '?'}×{localContainer.height > 0 ? localContainer.height : '?'}
                  </div>
                  <div className="text-xs opacity-80">mm</div>
                </div>
            </div>
          </div>

          {/* Container Info Summary */}
          {(localContainer.width > 0 && localContainer.height > 0) && (
              <div className="text-center space-y-1">
                <div className="text-sm text-gray-600">
                  <strong>Kích thước:</strong> {localContainer.width} × {localContainer.height} mm
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Diện tích (1 lớp):</strong> {(localContainer.width * localContainer.height).toLocaleString()} mm²
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Số lớp:</strong> {localContainer.layers || 1}
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContainerInput;