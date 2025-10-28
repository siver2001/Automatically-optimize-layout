import ModbusRTU from 'modbus-serial';

class ModbusService {
  constructor() {
    this.client = new ModbusRTU();
    this.connected = false;
    this.host = null;
    this.port = null;
    this.lastConnected = null;
  }

  // Kết nối với PLC
  async connect(host, port = 502) {
    try {
      await this.client.connectTCP(host, { port });
      this.client.setID(1); // Unit ID mặc định
      
      this.connected = true;
      this.host = host;
      this.port = port;
      this.lastConnected = new Date();
      
      console.log(`Đã kết nối với PLC tại ${host}:${port}`);
      
      return {
        host: this.host,
        port: this.port,
        connected: this.connected,
        lastConnected: this.lastConnected
      };
      
    } catch (error) {
      this.connected = false;
      throw new Error(`Không thể kết nối với PLC: ${error.message}`);
    }
  }

  // Ngắt kết nối
  async disconnect() {
    try {
      if (this.connected) {
        await this.client.close();
        this.connected = false;
        this.host = null;
        this.port = null;
        console.log('Đã ngắt kết nối với PLC');
      }
    } catch (error) {
      throw new Error(`Lỗi khi ngắt kết nối: ${error.message}`);
    }
  }

  // Đọc holding registers
  async readHoldingRegisters(address, length = 1, unitId = 1) {
    if (!this.connected) {
      throw new Error('Chưa kết nối với PLC');
    }

    try {
      this.client.setID(unitId);
      const data = await this.client.readHoldingRegisters(address, length);
      return data.data;
    } catch (error) {
      throw new Error(`Lỗi đọc dữ liệu: ${error.message}`);
    }
  }

  // Ghi holding register
  async writeHoldingRegister(address, value, unitId = 1) {
    if (!this.connected) {
      throw new Error('Chưa kết nối với PLC');
    }

    try {
      this.client.setID(unitId);
      await this.client.writeRegister(address, value);
      return { address, value, success: true };
    } catch (error) {
      throw new Error(`Lỗi ghi dữ liệu: ${error.message}`);
    }
  }

  // Đọc input registers
  async readInputRegisters(address, length = 1, unitId = 1) {
    if (!this.connected) {
      throw new Error('Chưa kết nối với PLC');
    }

    try {
      this.client.setID(unitId);
      const data = await this.client.readInputRegisters(address, length);
      return data.data;
    } catch (error) {
      throw new Error(`Lỗi đọc input registers: ${error.message}`);
    }
  }

  // Đọc coils
  async readCoils(address, length = 1, unitId = 1) {
    if (!this.connected) {
      throw new Error('Chưa kết nối với PLC');
    }

    try {
      this.client.setID(unitId);
      const data = await this.client.readCoils(address, length);
      return data.data;
    } catch (error) {
      throw new Error(`Lỗi đọc coils: ${error.message}`);
    }
  }

  // Ghi coil
  async writeCoil(address, value, unitId = 1) {
    if (!this.connected) {
      throw new Error('Chưa kết nối với PLC');
    }

    try {
      this.client.setID(unitId);
      await this.client.writeCoil(address, value);
      return { address, value, success: true };
    } catch (error) {
      throw new Error(`Lỗi ghi coil: ${error.message}`);
    }
  }

  // Kiểm tra trạng thái kết nối
  getStatus() {
    return {
      connected: this.connected,
      host: this.host,
      port: this.port,
      lastConnected: this.lastConnected
    };
  }

  // Ping PLC để kiểm tra kết nối
  async ping() {
    if (!this.connected) {
      return false;
    }

    try {
      await this.readHoldingRegisters(0, 1);
      return true;
    } catch (error) {
      this.connected = false;
      return false;
    }
  }
}

export default ModbusService;