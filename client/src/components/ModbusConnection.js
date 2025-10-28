import React, { useState, useEffect } from 'react';
import { modbusService } from '../services/modbusService.js';

const ModbusConnection = () => {
  const [connection, setConnection] = useState({
    host: '',
    port: 502,
    connected: false
  });
  
  const [readData, setReadData] = useState({
    address: 0,
    length: 1,
    unitId: 1,
    result: ''
  });
  
  const [writeData, setWriteData] = useState({
    address: 0,
    value: 0,
    unitId: 1,
    result: ''
  });
  
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkConnectionStatus();
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const status = await modbusService.getStatus();
      setConnection(prev => ({
        ...prev,
        connected: status.connected,
        host: status.host || '',
        port: status.port || 502
      }));
    } catch (error) {
      console.error('Error checking connection status:', error);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const result = await modbusService.connect(connection.host, connection.port);
      setConnection(prev => ({
        ...prev,
        connected: true
      }));
    } catch (error) {
      alert(`Lỗi kết nối: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    
    try {
      await modbusService.disconnect();
      setConnection(prev => ({
        ...prev,
        connected: false,
        host: '',
        port: 502
      }));
    } catch (error) {
      alert(`Lỗi ngắt kết nối: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReadData = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const result = await modbusService.readData(
        readData.address,
        readData.length,
        readData.unitId
      );
      setReadData(prev => ({
        ...prev,
        result: `Đọc thành công:\n${JSON.stringify(result.data, null, 2)}`
      }));
    } catch (error) {
      setReadData(prev => ({
        ...prev,
        result: `Lỗi đọc dữ liệu: ${error.message}`
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleWriteData = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const result = await modbusService.writeData(
        writeData.address,
        writeData.value,
        writeData.unitId
      );
      setWriteData(prev => ({
        ...prev,
        result: `Ghi thành công:\n${JSON.stringify(result, null, 2)}`
      }));
    } catch (error) {
      setWriteData(prev => ({
        ...prev,
        result: `Lỗi ghi dữ liệu: ${error.message}`
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-gray-800 text-2xl font-semibold mb-8 flex items-center gap-2">
        🔌 Kết nối Modbus TCP/IP
      </h2>
      
      <div className="card mb-8">
        <div className={`rounded-lg p-4 mb-8 ${
          connection.connected 
            ? 'bg-green-50 border border-green-200' 
            : 'bg-red-50 border border-red-200'
        }`}>
          <div className={`flex items-center gap-2 font-semibold ${
            connection.connected ? 'text-green-800' : 'text-red-800'
          }`}>
            <div className={`w-3 h-3 rounded-full ${
              connection.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`}></div>
            {connection.connected ? 'Đã kết nối' : 'Chưa kết nối'}
          </div>
          {connection.connected && (
            <div className="mt-2 text-sm text-green-700">
              Host: {connection.host}:{connection.port}
            </div>
          )}
        </div>
        
        <form onSubmit={handleConnect} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8">
          <div className="flex flex-col">
            <label htmlFor="host" className="label">
              Địa chỉ IP PLC
            </label>
            <input
              id="host"
              type="text"
              value={connection.host}
              onChange={(e) => setConnection(prev => ({ ...prev, host: e.target.value }))}
              placeholder="192.168.1.100"
              disabled={connection.connected}
              className="input-field"
              required
            />
          </div>
          
          <div className="flex flex-col">
            <label htmlFor="port" className="label">
              Port
            </label>
            <input
              id="port"
              type="number"
              value={connection.port}
              onChange={(e) => setConnection(prev => ({ ...prev, port: parseInt(e.target.value) }))}
              disabled={connection.connected}
              min="1"
              max="65535"
              className="input-field"
            />
          </div>
          
          <button
            type={connection.connected ? 'button' : 'submit'}
            className={`${
              connection.connected ? 'btn-danger' : 'btn-primary'
            } disabled:opacity-50`}
            onClick={connection.connected ? handleDisconnect : undefined}
            disabled={loading}
          >
            {connection.connected ? 'Ngắt kết nối' : 'Kết nối'}
          </button>
        </form>
      </div>
      
      {connection.connected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h3 className="text-gray-800 text-lg font-semibold mb-4">
              📖 Đọc dữ liệu
            </h3>
            <form onSubmit={handleReadData} className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2 items-end">
                <input
                  type="number"
                  placeholder="Địa chỉ"
                  value={readData.address}
                  onChange={(e) => setReadData(prev => ({ ...prev, address: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <input
                  type="number"
                  placeholder="Số lượng"
                  value={readData.length}
                  onChange={(e) => setReadData(prev => ({ ...prev, length: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <button 
                  type="submit" 
                  disabled={loading}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  Đọc
                </button>
              </div>
              <div className="bg-gray-200 rounded p-3 font-mono text-sm min-h-24 whitespace-pre-wrap overflow-y-auto">
                {readData.result}
              </div>
            </form>
          </div>
          
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h3 className="text-gray-800 text-lg font-semibold mb-4">
              ✏️ Ghi dữ liệu
            </h3>
            <form onSubmit={handleWriteData} className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2 items-end">
                <input
                  type="number"
                  placeholder="Địa chỉ"
                  value={writeData.address}
                  onChange={(e) => setWriteData(prev => ({ ...prev, address: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <input
                  type="number"
                  placeholder="Giá trị"
                  value={writeData.value}
                  onChange={(e) => setWriteData(prev => ({ ...prev, value: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <button 
                  type="submit" 
                  disabled={loading}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  Ghi
                </button>
              </div>
              <div className="bg-gray-200 rounded p-3 font-mono text-sm min-h-24 whitespace-pre-wrap overflow-y-auto">
                {writeData.result}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModbusConnection;
