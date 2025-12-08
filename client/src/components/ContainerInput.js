import React from 'react';
import { usePacking } from '../context/PackingContext.js';

const ContainerInput = () => {
  const { container, setContainer, errors, clearErrors } = usePacking();
  const [localContainer, setLocalContainer] = React.useState(container);
  const [showSuccess, setShowSuccess] = React.useState(false);

  React.useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const handleInputChange = (field, value) => {
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

  const getContainerPreviewStyle = () => {
    if (!localContainer.width || !localContainer.length || localContainer.width <= 0 || localContainer.length <= 0) {
      return { width: '200px', height: '120px' };
    }

    const effectiveWidth = Math.max(localContainer.width, localContainer.length);
    const effectiveLength = Math.min(localContainer.width, localContainer.length);

    // Responsive sizes
    const maxWidth = Math.min(window.innerWidth * 0.15, 350);
    const maxLength = Math.min(window.innerHeight * 0.8, 200);
    const aspectRatio = effectiveWidth / effectiveLength;

    let displayWidth, displayLength;

    if (aspectRatio > 1) {
      displayWidth = maxWidth;
      displayLength = Math.min(maxLength, displayWidth / aspectRatio);
    } else {
      displayLength = maxLength;
      displayWidth = Math.min(maxWidth, displayLength * aspectRatio);
    }

    displayWidth = Math.max(180, displayWidth);
    displayLength = Math.max(100, displayLength);

    return {
      width: `${displayWidth}px`,
      height: `${displayLength}px`,
      minWidth: '180px',
      minHeight: '100px'
    };
  };

  return (
    <div className="mb-3 card p-3 md:p-4">
      <div className="flex items-center justify-between mb-4 md:mb-6 border-b pb-2 md:pb-3">
        <h2 className="text-gray-800 text-base md:text-lg lg:text-l font-semibold flex items-center gap-2">
          📐 Thiết kế tấm liệu
        </h2>

        {showSuccess && containerErrors.length === 0 && (
          <div className="bg-green-100 border-l-2 border-green-500 px-2 py-1 rounded text-xs md:text-sm text-green-800 transition-opacity duration-500 flex-shrink-0">
            <div className="flex items-center gap-1 font-medium">
              🎉 Đã cập nhật thành công kích thước tấm liệu!
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 lg:gap-6">
        {/* Input Form */}
        <div className="space-y-3 md:space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <div className="flex flex-col">
                <label htmlFor="width" className="label text-sm md:text-base">
                  Chiều rộng (mm)
                </label>
                <input
                  id="width"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={localContainer.width === 0 ? '' : localContainer.width}
                  onChange={(e) => handleInputChange('width', e.target.value)}
                  placeholder="e.g., 600.0"
                  className="input-field text-sm md:text-base"
                  required
                />
              </div>

              <div className="flex flex-col">
                <label htmlFor="length" className="label text-sm md:text-base">
                  Chiều dài (mm)
                </label>
                <input
                  id="length"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={localContainer.length === 0 ? '' : localContainer.length}
                  onChange={(e) => handleInputChange('length', e.target.value)}
                  placeholder="e.g., 500.0"
                  className="input-field text-sm md:text-base"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 md:gap-4">
              <div className="flex flex-col flex-1">
                <label htmlFor="layers" className="label text-sm md:text-base">
                  📚 Số lớp
                </label>
                <input
                  id="layers"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={localContainer.layers || 1}
                  onChange={(e) => handleInputChange('layers', e.target.value)}
                  placeholder="Nhập số lớp..."
                  className="input-field text-sm md:text-base"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-primary text-sm md:text-base py-2 md:py-2.5 sm:flex-0.5 sm:min-w-[150px]"
                disabled={!localContainer.width || !localContainer.length || localContainer.width <= 0 || localContainer.length <= 0}
              >
                Thiết kế tấm liệu
              </button>
            </div>
          </form>

          {containerErrors.length > 0 && (
            <div className="bg-red-100 border-l-4 border-red-500 p-1 rounded text-sm text-red-800">
              <div className="flex items-center gap-2 mb-1 font-semibold">
                ⚠️ Chưa thiết kế tấm liệu
              </div>
            </div>
          )}
        </div>

        {/* Container Preview */}
        <div className="bg-white rounded-lg p-3 md:p-4 border border-gray-200 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center">
            <div
              className="bg-blue-100 border-2 border-primary-500 rounded-lg shadow-xl flex items-center justify-center relative"
              style={getContainerPreviewStyle()}
            >
              <div className="text-center text-primary-800 font-bold p-2">
                <div className="text-base md:text-lg lg:text-xl leading-tight">
                  {localContainer.width > 0 ? localContainer.width : '?'}×{localContainer.length > 0 ? localContainer.length : '?'}
                </div>
                <div className="text-xs md:text-sm opacity-80">mm</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContainerInput;