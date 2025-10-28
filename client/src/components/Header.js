import React from 'react';
import { usePacking } from '../context/PackingContext.js';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
  const { toggleModbus } = usePacking(); 
  const location = useLocation();

  const isPackingView = location.pathname === '/';
  const isModbusView = location.pathname === '/modbus';

  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 px-8 py-4 mb-8">
      <div className="flex justify-between items-center max-w-7xl mx-auto">
        <Link to="/" className="text-white text-3xl font-bold m-0 drop-shadow-lg">
          📦 Rectangle Packing Optimizer
        </Link>
        
        <nav className="flex gap-4">
          <Link 
            to="/"
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 hover:-translate-y-0.5 ${
              isPackingView 
                ? 'bg-white/20 text-white border border-white/30' 
                : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
            }`}
          >
            Tối ưu sắp xếp
          </Link>
          <Link 
            to="/modbus"
            // Toggle modbus state only when navigating to /modbus, as requested by initial App structure
            onClick={!isModbusView ? toggleModbus : undefined} 
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 hover:-translate-y-0.5 ${
              isModbusView 
                ? 'bg-white/20 text-white border border-white/30' 
                : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
            }`}
          >
            Kết nối PLC
          </Link>
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