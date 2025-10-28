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
  
  // Layout components in a dedicated structure for 1920x1080 visibility
  const statusOverview = childrenArray[0]; 
  const containerInput = childrenArray[1]; 
  const rectangleList = childrenArray[2]; 
  const packingResult = childrenArray[3]; 

  return (
    <div className="space-y-8 pb-10">
      {/* 1. Status Overview - Full Width */}
      <div className="w-full">
        {statusOverview}
      </div>
      
      {/* 2. Main Input/List Section - Split Layout (Container on Left, List on Right for better vertical space management) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Container Input in left column */}
          {containerInput}
        </div>
        <div className="space-y-8">
          {/* Rectangle List in right column */}
          {rectangleList}
        </div>
      </div>
      
      {/* 3. Packing Result - Full Width */}
      <div className="w-full">
        {packingResult}
      </div>
      
      {/* Render any extra children if they exist */}
      {childrenArray.slice(4)}
    </div>
  );
};

export default MainLayout;