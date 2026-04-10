import React from 'react';
import { usePacking } from '../context/PackingContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
  const { toggleModbus } = usePacking();
  const { language, toggleLanguage } = useLanguage();
  const location = useLocation();

  const isPackingView = location.pathname === '/';
  const isModbusView = location.pathname === '/modbus';
  const isDieCutView = location.pathname === '/diecut';

  const navItems = [
    { 
      path: '/',        
      label: <><span className="notranslate">Nesting Blocker</span></>,    
      active: isPackingView 
    },
    { 
      path: '/diecut',  
      label: <>✂️ <span className="notranslate">Nesting Die-Cut</span></>, 
      active: isDieCutView 
    },
    { 
      path: '/modbus',  
      label: <>Kết nối <span className="notranslate">PLC</span></>,         
      active: isModbusView, 
      onClick: !isModbusView ? toggleModbus : undefined 
    },
  ];

  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 px-4 sm:px-5 md:px-7 lg:px-8 py-2 md:py-1.5 mb-2 md:mb-3 flex-none">
      <div className="flex justify-between items-center max-w-full mx-auto">
        <Link to="/" className="text-white text-lg sm:text-2xl md:text-3xl font-bold m-0 drop-shadow-lg flex items-center gap-3">
          <img src="/Ortholite-logo.png" alt="Ortholite Logo" className="h-7 md:h-9 object-contain" />
          <span className="notranslate">Auto Netting</span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-2.5 md:gap-3">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={item.onClick}
              className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm sm:text-base font-medium transition-all duration-300 hover:-translate-y-0.5 ${
                item.active
                  ? 'bg-white/20 text-white border border-white/30'
                  : 'bg-transparent text-white/80 border border-white/20 hover:bg-white/10'
              }`}
            >
              {item.label}
            </Link>
          ))}
          
          <div className="w-px h-6 bg-white/20 mx-1"></div>
          
          <button
            title="Chuyển đổi ngôn ngữ / Toggle Language"
            onClick={toggleLanguage}
            className="notranslate flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white text-sm font-bold border border-white/20 hover:bg-white/20 transition-all duration-300 shadow-sm drop-shadow"
          >
            {language === 'vi' ? 'VI' : 'EN'}
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Header;
