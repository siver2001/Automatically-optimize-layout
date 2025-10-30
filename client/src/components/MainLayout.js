// client/src/components/MainLayout.js
import React from 'react';

const MainLayout = ({ children }) => {
  const childrenArray = React.Children.toArray(children);
  
  if (childrenArray.length === 1) {
    return (
      <div className="space-y-8">
        {children}
      </div>
    );
  }
  
  // Layout components: [ContainerInput, RectangleList, PackingResult]
  const containerInput = childrenArray[0]; 
  const rectangleList = childrenArray[1]; 
  const packingResult = childrenArray[2]; 

  return (
    // Giữ nguyên grid 12 cột. Column Left: Input + List; Column Right: Result
    // h-[calc(100vh-96px)] đảm bảo chiều cao tối đa của khu vực làm việc
    <div className="grid grid-cols-12 gap-2 h-[calc(100vh-96px)] w-full">
      
      {/* Cột trái: Thiết kế tấm liệu + Quản lý size. Giữ nguyên 6 cột */}
      <div className="col-span-12 md:col-span-6 flex flex-col gap-2 h-full overflow-hidden">
        
        {/* Hàng trên: Container Input (42.5% chiều cao của cột trái) */}
        <div className="flex-[0.425] overflow-auto custom-scrollbar"> 
          {containerInput}
        </div>
        
        {/* Hàng dưới: Rectangle List (57.5% chiều cao còn lại của cột trái) */}
        <div className="flex-[0.575] overflow-auto custom-scrollbar"> 
          {rectangleList}
        </div>
      </div>

      {/* Cột phải: Packing Result. Giữ nguyên 6 cột. Có thể cuộn độc lập */}
      <div className="col-span-12 md:col-span-6 h-full overflow-auto space-y-2 custom-scrollbar">
        {packingResult}
      </div>

      {/* Render extras if any */}
      {childrenArray.slice(3)}
    </div>
  );
};

export default MainLayout;