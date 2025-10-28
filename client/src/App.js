import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PackingProvider } from './context/PackingContext';
import Header from './components/Header';
import MainLayout from './components/MainLayout';
import StatusOverview from './components/StatusOverview';
import ContainerInput from './components/ContainerInput';
import RectangleList from './components/RectangleList';
import PackingResult from './components/PackingResult';
import ModbusConnection from './components/ModbusConnection';

function App() {
  return (
    <PackingProvider>
      <Router>
        <div className="min-h-screen bg-gradient-to-br from-primary-500 to-secondary-500 font-sans">
          <Header />
          <div className="max-w-7xl mx-auto p-6">
            <Routes>
              <Route path="/" element={
                <MainLayout>
                  <StatusOverview />
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
