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
    // Grid: Chia màn hình thành hai cột bằng nhau (6 + 6 = 12)
    // h-[calc(100vh-96px)] đảm bảo chiều cao tối đa của khu vực làm việc
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-96px)] w-full">
      
      {/* Cột trái: Thiết kế tấm liệu + Quản lý size. */}
      {/* flex-col và h-full đảm bảo nó chiếm hết chiều cao và xếp nội dung theo cột. */}
      {/* overflow-hidden để chỉ các phần tử con mới cuộn. */}
      <div className="col-span-12 md:col-span-6 flex flex-col gap-6 h-full overflow-hidden">
        
        {/* Hàng trên: Container Input */}
        {/* flex-1: Chia đều 50% chiều cao cho mỗi block, cho phép cuộn bên trong */}
        <div className="flex-1 overflow-auto custom-scrollbar"> 
          {containerInput}
        </div>
        
        {/* Hàng dưới: Rectangle List */}
        {/* flex-1: Chia đều 50% chiều cao còn lại cho block này, cho phép cuộn bên trong */}
        <div className="flex-1 overflow-auto custom-scrollbar"> 
          {rectangleList}
        </div>
      </div>

      {/* Cột phải: Packing Result. Chiếm hết chiều cao còn lại và có thanh cuộn độc lập */}
      <div className="col-span-12 md:col-span-6 h-full overflow-auto space-y-4 custom-scrollbar">
        {packingResult}
      </div>

      {/* Render extras if any */}
      {childrenArray.slice(3)}
    </div>
  );
};

export default MainLayout;