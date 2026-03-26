import React from 'react';
import DxfImportManager from './DxfImportManager.js';

const MainLayout = ({ children }) => {
  const childrenArray = React.Children.toArray(children);

  if (childrenArray.length === 1) {
    return (
      <div className="space-y-3 md:space-y-4 lg:space-y-5">
        {children}
      </div>
    );
  }

  const containerInput = childrenArray[0];
  const rectangleList = childrenArray[1];
  const packingResult = childrenArray[2];

  return (
    <div className="grid grid-cols-12 gap-2 md:gap-3 lg:gap-2 h-full min-h-0 w-full mx-auto">

      {/* Cột trái: Thiết kế tấm liệu + Quản lý size */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-5 flex flex-col gap-2 md:gap-3 h-full min-h-0">

        {/* Import DXF Control */}
        <div className="flex-none">
          <DxfImportManager />
        </div>

        {/* Container Input - chiều cao linh hoạt theo nội dung */}
        <div className="flex-none md:flex-[0.37] lg:flex-[0.35] min-h-0 md:overflow-auto custom-scrollbar">
          {containerInput}
        </div>

        {/* Rectangle List - chiếm phần còn lại */}
        <div className="flex-1 md:flex-[0.63] lg:flex-[0.65] min-h-0 md:overflow-auto custom-scrollbar">
          {rectangleList}
        </div>
      </div>

      {/* Cột phải: Packing Result - tự động điều chỉnh theo màn hình */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-7 h-full min-h-0 md:overflow-auto custom-scrollbar">
        {packingResult}
      </div>

      {childrenArray.slice(3)}
    </div>
  );
};

export default MainLayout;
