import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { PackingProvider } from './context/PackingContext.js';
import Header from './components/Header.js';
import MainLayout from './components/MainLayout.js';
import ContainerInput from './components/ContainerInput.js';
import RectangleList from './components/RectangleList.js';
import PackingResult from './components/PackingResult.js';
import ModbusConnection from './components/ModbusConnection.js';
import DieCutLayout from './components/diecut/DieCutLayout.js';

function AppShell() {
  const location = useLocation();
  const isPackingView = location.pathname === '/';
  const shellClassName = isPackingView
    ? 'h-screen overflow-hidden bg-gradient-to-br from-primary-500 to-secondary-500 font-sans'
    : 'min-h-screen bg-gradient-to-br from-primary-500 to-secondary-500 font-sans';
  const contentClassName = isPackingView
    ? 'w-full max-w-[2000px] mx-auto h-full flex flex-col'
    : 'w-full max-w-[2000px] mx-auto';
  const routesClassName = isPackingView
    ? 'w-full flex-1 min-h-0 px-3 md:px-4 lg:px-2 pb-2'
    : 'w-full px-3 md:px-4 lg:px-2 pb-2';

  return (
    <div className={shellClassName}>
      <div className={contentClassName}>
        <Header />
        <div className={routesClassName}>
          <Routes>
            <Route path="/" element={
              <MainLayout>
                <ContainerInput />
                <RectangleList />
                <PackingResult />
              </MainLayout>
            } />
            <Route path="/modbus" element={<ModbusConnection />} />
            <Route path="/diecut" element={<DieCutLayout />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <PackingProvider>
      <Router>
        <AppShell />
      </Router>
    </PackingProvider>
  );
}

export default App;
