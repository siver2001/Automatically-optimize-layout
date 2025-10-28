import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class ModbusService {
  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // Kết nối với PLC
  async connect(host, port = 502) {
    try {
      const response = await this.api.post('/modbus/connect', { host, port });
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi kết nối PLC: ${error.response?.data?.error || error.message}`);
    }
  }

  // Ngắt kết nối PLC
  async disconnect() {
    try {
      const response = await this.api.post('/modbus/disconnect');
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi ngắt kết nối PLC: ${error.response?.data?.error || error.message}`);
    }
  }

  // Kiểm tra trạng thái kết nối
  async getStatus() {
    try {
      const response = await this.api.get('/modbus/status');
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi kiểm tra trạng thái: ${error.message}`);
    }
  }

  // Đọc dữ liệu từ PLC
  async readData(address, length = 1, unitId = 1) {
    try {
      const response = await this.api.post('/modbus/read', {
        address,
        length,
        unitId
      });
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi đọc dữ liệu PLC: ${error.response?.data?.error || error.message}`);
    }
  }

  // Ghi dữ liệu xuống PLC
  async writeData(address, value, unitId = 1) {
    try {
      const response = await this.api.post('/modbus/write', {
        address,
        value,
        unitId
      });
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi ghi dữ liệu PLC: ${error.response?.data?.error || error.message}`);
    }
  }
}

export const modbusService = new ModbusService();
