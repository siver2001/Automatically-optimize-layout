import React, { useState } from 'react';
import { usePacking } from '../context/PackingContext';

const ContainerInput = () => {
  const { container, setContainer, errors, clearErrors } = usePacking();
  const [localContainer, setLocalContainer] = useState(container);

  const handleInputChange = (field, value) => {
    const numValue = parseFloat(value) || 0;
    setLocalContainer(prev => ({
      ...prev,
      [field]: numValue
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    clearErrors();
    setContainer(localContainer);
  };

  const containerErrors = errors.filter(e => e.type === 'container');

  // Tính tỷ lệ hiển thị container preview
  const getContainerPreviewStyle = () => {
    if (!localContainer.width || !localContainer.height) {
      return { width: '200px', height: '150px' };
    }
    
    const maxWidth = 200;
    const maxHeight = 150;
    const aspectRatio = localContainer.width / localContainer.height;
    
    let displayWidth, displayHeight;
    if (aspectRatio > 1) {
      displayWidth = Math.min(maxWidth, localContainer.width / 5);
      displayHeight = displayWidth / aspectRatio;
    } else {
      displayHeight = Math.min(maxHeight, localContainer.height / 5);
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
    <div className="mb-8">
      <h2 className="text-gray-800 text-2xl font-semibold mb-6 flex items-center gap-2">
        📐 Cấu hình Container
      </h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Form */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Thông số Container</h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label htmlFor="width" className="label">
                  <span className="flex items-center gap-2">
                    📏 Chiều rộng (mm)
                  </span>
                </label>
                <input
                  id="width"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.1"
                  value={localContainer.width || ''}
                  onChange={(e) => handleInputChange('width', e.target.value)}
                  placeholder="Nhập chiều rộng..."
                  className="input-field"
                  required
                />
              </div>
              
              <div className="flex flex-col">
                <label htmlFor="height" className="label">
                  <span className="flex items-center gap-2">
                    📐 Chiều cao (mm)
                  </span>
                </label>
                <input
                  id="height"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.1"
                  value={localContainer.height || ''}
                  onChange={(e) => handleInputChange('height', e.target.value)}
                  placeholder="Nhập chiều cao..."
                  className="input-field"
                  required
                />
              </div>
            </div>
            
            <div className="flex flex-col">
              <label htmlFor="layers" className="label">
                <span className="flex items-center gap-2">
                  📚 Số lớp sắp xếp
                </span>
              </label>
              <input
                id="layers"
                type="number"
                min="1"
                max="10"
                step="1"
                value={localContainer.layers || ''}
                onChange={(e) => handleInputChange('layers', e.target.value)}
                placeholder="Nhập số lớp..."
                className="input-field"
                required
              />
            </div>
            
            <button type="submit" className="btn-primary w-full mt-6">
              ✅ Cập nhật Container
            </button>
          </form>
        </div>
        
        {/* Container Preview */}
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Preview Container</h3>
          
          <div className="flex flex-col items-center space-y-4">
            {/* Container Visual */}
            <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-gray-300">
              <div 
                className="bg-gradient-to-br from-blue-100 to-blue-200 border-2 border-blue-400 rounded-lg shadow-inner flex items-center justify-center"
                style={getContainerPreviewStyle()}
              >
                {localContainer.width && localContainer.height ? (
                  <div className="text-center text-blue-800 font-semibold">
                    <div className="text-sm">
                      {localContainer.width}×{localContainer.height}
                    </div>
                    <div className="text-xs opacity-75">mm</div>
                  </div>
                ) : (
                  <div className="text-blue-400 text-sm">Nhập kích thước</div>
                )}
              </div>
            </div>
            
            {/* Container Info */}
            {localContainer.width && localContainer.height && (
              <div className="text-center space-y-2">
                <div className="text-sm text-gray-600">
                  <strong>Kích thước:</strong> {localContainer.width} × {localContainer.height} mm
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Diện tích:</strong> {(localContainer.width * localContainer.height).toLocaleString()} mm²
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Số lớp:</strong> {localContainer.layers || 1}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Error Messages */}
      {containerErrors.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg mt-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-500">⚠️</span>
            <span className="font-semibold text-red-800">Lỗi cấu hình</span>
          </div>
          {containerErrors.map((error, index) => (
            <div key={index} className="text-red-700 text-sm ml-6">
              • {error.message}
            </div>
          ))}
        </div>
      )}
      
      {/* Info Box */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 mt-6">
        <div className="flex items-start gap-3">
          <span className="text-green-500 text-lg">💡</span>
          <div>
            <p className="text-green-800 font-medium mb-1">Hướng dẫn sử dụng</p>
            <p className="text-green-700 text-sm">
              • Tất cả kích thước được tính bằng mm<br/>
              • Container sẽ được sử dụng để sắp xếp các hình chữ nhật nhỏ<br/>
              • Số lớp cho phép sắp xếp nhiều tầng (nếu cần)<br/>
              • Kích thước tối đa: 10,000mm × 10,000mm
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContainerInput;
