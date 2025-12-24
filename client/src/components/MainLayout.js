import React from 'react';
import DxfImportManager from './DxfImportManager.js';

const MainLayout = ({ children }) => {
  const childrenArray = React.Children.toArray(children);

  if (childrenArray.length === 1) {
    return (
      <div className="space-y-4 md:space-y-6 lg:space-y-8">
        {children}
      </div>
    );
  }

  const containerInput = childrenArray[0];
  const rectangleList = childrenArray[1];
  const packingResult = childrenArray[2];

  return (
    <div className="grid grid-cols-12 gap-3 md:gap-4 lg:gap-2 md:h-[calc(100vh-120px)] lg:h-[calc(100vh-130px)] w-full mx-auto">

      {/* Cột trái: Thiết kế tấm liệu + Quản lý size */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-5 flex flex-col gap-3 md:gap-4 md:h-full">

        {/* Import DXF Control */}
        <div className="flex-none">
          <DxfImportManager />
        </div>

        {/* Container Input - chiều cao linh hoạt theo nội dung */}
        <div className="flex-none md:flex-[0.42] lg:flex-[0.40] md:overflow-auto custom-scrollbar">
          {containerInput}
        </div>

        {/* Rectangle List - chiếm phần còn lại */}
        <div className="flex-1 md:flex-[0.58] lg:flex-[0.60] md:overflow-auto custom-scrollbar">
          {rectangleList}
        </div>
      </div>

      {/* Cột phải: Packing Result - tự động điều chỉnh theo màn hình */}
      <div className="col-span-12 lg:col-span-6 xl:col-span-7 md:h-full md:overflow-auto custom-scrollbar">
        {packingResult}
      </div>

      {childrenArray.slice(3)}
    </div>
  );
};

export default MainLayout;