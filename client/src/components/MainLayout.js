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
  
  // Layout components without StatusOverview: [ContainerInput, RectangleList, PackingResult]
  const containerInput = childrenArray[0]; 
  const rectangleList = childrenArray[1]; 
  const packingResult = childrenArray[2]; 

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-96px)] w-full">
      {/* Left: Container Input (fixed column span) */}
      <div className="col-span-4 overflow-auto space-y-4 h-full">
        {containerInput}
      </div>

      {/* Middle: Rectangle List */}
      <div className="col-span-4 overflow-auto space-y-4 h-full">
        {rectangleList}
      </div>

      {/* Right: Packing Result fills remaining */}
      <div className="col-span-4 overflow-auto space-y-4 h-full">
        {packingResult}
      </div>

      {/* Render extras if any */}
      {childrenArray.slice(3)}
    </div>
  );
};

export default MainLayout;