import React from 'react';

const MainLayout = ({ children }) => {
  // Check if we have multiple children to determine layout
  const childrenArray = React.Children.toArray(children);
  
  if (childrenArray.length === 1) {
    // Single child - full width
    return (
      <div className="space-y-8">
        {children}
      </div>
    );
  }
  
  // Multiple children - split layout
  const statusOverview = childrenArray[0]; // StatusOverview
  const containerInput = childrenArray[1]; // ContainerInput
  const leftChildren = childrenArray.slice(2, Math.ceil(childrenArray.length / 2) + 1);
  const rightChildren = childrenArray.slice(Math.ceil(childrenArray.length / 2) + 1);
  
  return (
    <div className="space-y-8">
      {/* Status Overview - Full Width */}
      <div className="w-full">
        {statusOverview}
      </div>
      
      {/* Container Input - Full Width */}
      <div className="w-full">
        {containerInput}
      </div>
      
      {/* Bottom Section - Split Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-8">
          {leftChildren}
        </div>
        <div className="space-y-8">
          {rightChildren}
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
