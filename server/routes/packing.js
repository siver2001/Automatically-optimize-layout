const express = require('express');
const router = express.Router();
const PackingAlgorithm = require('../algorithms/packingAlgorithm');
const Rectangle = require('../models/Rectangle');

// POST /api/packing/optimize - Tối ưu sắp xếp hình chữ nhật
router.post('/optimize', async (req, res) => {
  try {
    const { container, rectangles, layers } = req.body;
    
    // Validate input
    if (!container || !rectangles || !layers) {
      return res.status(400).json({ 
        error: 'Thiếu thông tin container, rectangles hoặc layers' 
      });
    }
    
    if (container.width <= 0 || container.height <= 0) {
      return res.status(400).json({ 
        error: 'Kích thước container phải lớn hơn 0' 
      });
    }
    
    if (layers <= 0) {
      return res.status(400).json({ 
        error: 'Số lớp phải lớn hơn 0' 
      });
    }
    
    // Create packing algorithm instance
    const algorithm = new PackingAlgorithm();
    
    // Run optimization
    const result = await algorithm.optimize(container, rectangles, layers);
    
    res.json({
      success: true,
      result: result
    });
    
  } catch (error) {
    console.error('Packing optimization error:', error);
    res.status(500).json({ 
      error: 'Lỗi trong quá trình tối ưu: ' + error.message 
    });
  }
});

// GET /api/packing/rectangles - Lấy danh sách hình chữ nhật mặc định
router.get('/rectangles', (req, res) => {
  const defaultRectangles = [
    { id: 1, width: 360.0, height: 245.0, color: '#FF6B6B', name: 'Hình 1' },
    { id: 2, width: 360.0, height: 122.5, color: '#FF6B6B', name: 'Hình 2' },
    { id: 3, width: 345.0, height: 120.0, color: '#4ECDC4', name: 'Hình 3' },
    { id: 4, width: 345.0, height: 120.0, color: '#4ECDC4', name: 'Hình 4' },
    { id: 5, width: 335.0, height: 230.0, color: '#45B7D1', name: 'Hình 5' },
    { id: 6, width: 335.0, height: 115.0, color: '#45B7D1', name: 'Hình 6' },
    { id: 7, width: 320.0, height: 225.0, color: '#96CEB4', name: 'Hình 7' },
    { id: 8, width: 320.0, height: 112.5, color: '#96CEB4', name: 'Hình 8' },
    { id: 9, width: 305.0, height: 220.0, color: '#FFEAA7', name: 'Hình 9' },
    { id: 10, width: 305.0, height: 110.0, color: '#FFEAA7', name: 'Hình 10' },
    { id: 11, width: 295.0, height: 215.0, color: '#DDA0DD', name: 'Hình 11' },
    { id: 12, width: 295.0, height: 107.5, color: '#DDA0DD', name: 'Hình 12' },
    { id: 13, width: 280.0, height: 205.0, color: '#98D8C8', name: 'Hình 13' },
    { id: 14, width: 280.0, height: 102.5, color: '#98D8C8', name: 'Hình 14' },
    { id: 15, width: 270.0, height: 200.0, color: '#F7DC6F', name: 'Hình 15' },
    { id: 16, width: 270.0, height: 90.0, color: '#F7DC6F', name: 'Hình 16' }
  ];
  
  res.json({ rectangles: defaultRectangles });
});

// POST /api/packing/validate - Kiểm tra tính hợp lệ của dữ liệu
router.post('/validate', (req, res) => {
  try {
    const { container, rectangles } = req.body;
    
    const errors = [];
    
    // Validate container
    if (!container || typeof container.width !== 'number' || typeof container.height !== 'number') {
      errors.push('Container phải có width và height hợp lệ');
    }
    
    if (container && (container.width <= 0 || container.height <= 0)) {
      errors.push('Kích thước container phải lớn hơn 0');
    }
    
    // Validate rectangles
    if (!Array.isArray(rectangles) || rectangles.length === 0) {
      errors.push('Phải có ít nhất một hình chữ nhật');
    }
    
    rectangles.forEach((rect, index) => {
      if (!rect.width || !rect.height || rect.width <= 0 || rect.height <= 0) {
        errors.push(`Hình chữ nhật ${index + 1} có kích thước không hợp lệ`);
      }
    });
    
    res.json({
      valid: errors.length === 0,
      errors: errors
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Lỗi kiểm tra dữ liệu: ' + error.message 
    });
  }
});

module.exports = router;
