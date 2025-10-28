import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PackingProvider } from './context/PackingContext.js';
import Header from './components/Header.js';
import MainLayout from './components/MainLayout.js';
import ContainerInput from './components/ContainerInput.js';
import RectangleList from './components/RectangleList.js';
import PackingResult from './components/PackingResult.js';
import ModbusConnection from './components/ModbusConnection.js';

function App() {
  return (
    <PackingProvider>
      <Router>
        <div className="h-screen overflow-hidden bg-gradient-to-br from-primary-500 to-secondary-500 font-sans">
          <Header />
          <div className="w-full px-6">
            <Routes>
              <Route path="/" element={
                <MainLayout>
                  <ContainerInput />
                  <RectangleList />
                  <PackingResult />
                </MainLayout>
              } />
              <Route path="/modbus" element={<ModbusConnection />} />
            </Routes>
          </div>
        </div>
      </Router>
    </PackingProvider>
  );
}

export default App;
