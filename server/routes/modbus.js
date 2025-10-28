const express = require('express');
const router = express.Router();
const ModbusService = require('../modbus/modbusService');

const modbusService = new ModbusService();

// POST /api/modbus/connect - Kết nối với PLC
router.post('/connect', async (req, res) => {
  try {
    const { host, port = 502 } = req.body;
    
    if (!host) {
      return res.status(400).json({ 
        error: 'Thiếu địa chỉ IP của PLC' 
      });
    }
    
    const result = await modbusService.connect(host, port);
    
    res.json({
      success: true,
      message: 'Kết nối PLC thành công',
      connection: result
    });
    
  } catch (error) {
    console.error('Modbus connection error:', error);
    res.status(500).json({ 
      error: 'Lỗi kết nối PLC: ' + error.message 
    });
  }
});

// POST /api/modbus/disconnect - Ngắt kết nối PLC
router.post('/disconnect', async (req, res) => {
  try {
    await modbusService.disconnect();
    
    res.json({
      success: true,
      message: 'Ngắt kết nối PLC thành công'
    });
    
  } catch (error) {
    console.error('Modbus disconnect error:', error);
    res.status(500).json({ 
      error: 'Lỗi ngắt kết nối PLC: ' + error.message 
    });
  }
});

// GET /api/modbus/status - Kiểm tra trạng thái kết nối
router.get('/status', (req, res) => {
  const status = modbusService.getStatus();
  
  res.json({
    connected: status.connected,
    host: status.host,
    port: status.port,
    lastConnected: status.lastConnected
  });
});

// POST /api/modbus/write - Ghi dữ liệu xuống PLC
router.post('/write', async (req, res) => {
  try {
    const { address, value, unitId = 1 } = req.body;
    
    if (address === undefined || value === undefined) {
      return res.status(400).json({ 
        error: 'Thiếu địa chỉ hoặc giá trị cần ghi' 
      });
    }
    
    const result = await modbusService.writeHoldingRegister(address, value, unitId);
    
    res.json({
      success: true,
      message: 'Ghi dữ liệu thành công',
      result: result
    });
    
  } catch (error) {
    console.error('Modbus write error:', error);
    res.status(500).json({ 
      error: 'Lỗi ghi dữ liệu PLC: ' + error.message 
    });
  }
});

// POST /api/modbus/read - Đọc dữ liệu từ PLC
router.post('/read', async (req, res) => {
  try {
    const { address, length = 1, unitId = 1 } = req.body;
    
    if (address === undefined) {
      return res.status(400).json({ 
        error: 'Thiếu địa chỉ cần đọc' 
      });
    }
    
    const result = await modbusService.readHoldingRegisters(address, length, unitId);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Modbus read error:', error);
    res.status(500).json({ 
      error: 'Lỗi đọc dữ liệu PLC: ' + error.message 
    });
  }
});

module.exports = router;
