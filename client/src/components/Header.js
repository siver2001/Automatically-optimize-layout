import React from 'react';
import { usePacking } from '../context/PackingContext.js';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
  const { toggleModbus } = usePacking();
  const location = useLocation();

  const isPackingView = location.pathname === '/';
  const isModbusView = location.pathname === '/modbus';

  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 px-4 sm:px-6 md:px-8 lg:px-10 py-3 md:py-2 mb-3 md:mb-4">
      <div className="flex justify-between items-center max-w-full mx-auto">
        <Link to="/" className="text-white text-xl sm:text-2xl md:text-3xl font-bold m-0 drop-shadow-lg flex items-center gap-3">
          <img src="/Ortholite-logo.png" alt="Ortholite Logo" className="h-8 md:h-10 object-contain" />
          Auto Netting
        </Link>

        <nav className="flex gap-2 sm:gap-3 md:gap-4">
          <Link
            to="/"
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-300 hover:-translate-y-0.5 ${isPackingView
              ? 'bg-white/20 text-white border border-white/30'
              : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
              }`}
          >
            Tối ưu sắp xếp
          </Link>
          <Link
            to="/modbus"
            onClick={!isModbusView ? toggleModbus : undefined}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-300 hover:-translate-y-0.5 ${isModbusView
              ? 'bg-white/20 text-white border border-white/30'
              : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
              }`}
          >
            Kết nối PLC
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default Header;