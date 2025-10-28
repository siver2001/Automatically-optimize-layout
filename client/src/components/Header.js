import React from 'react';
import { usePacking } from '../context/PackingContext';

const Header = () => {
  const { showModbus, toggleModbus } = usePacking();

  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 px-8 py-4 mb-8">
      <div className="flex justify-between items-center max-w-7xl mx-auto">
        <h1 className="text-white text-3xl font-bold m-0 drop-shadow-lg">
          📦 Rectangle Packing Optimizer
        </h1>
        
        <nav className="flex gap-4">
          <button 
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 hover:-translate-y-0.5 ${
              !showModbus 
                ? 'bg-white/20 text-white border border-white/30' 
                : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
            }`}
          >
            Tối ưu sắp xếp
          </button>
          <button 
            onClick={toggleModbus}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 hover:-translate-y-0.5 ${
              showModbus 
                ? 'bg-white/20 text-white border border-white/30' 
                : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
            }`}
          >
            Kết nối PLC
          </button>
        </nav>
        
        <div className="flex items-center gap-2 text-white text-sm">
          <div className="w-2 h-2 bg-red-500 rounded-full"></div>
          <span>Offline Mode</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
