import express from 'express';
import PackingAlgorithm from '../algorithms/packingAlgorithm.js'; 
import Rectangle from '../models/Rectangle.js'; 

const router = express.Router();

// Utility function to get consistent color based on max dimension
const getColorForRectangle = (rect) => {
  const maxDim = Math.max(rect.width, rect.length);
  
  // Define consistent colors for groups based on max dimension (mm)
  const colorMap = {
    360.0: '#FF6B6B', // Red
    345.0: '#4ECDC4', // Teal
    335.0: '#45B7D1', // Sky Blue
    320.0: '#96CEB4', // Mint Green
    305.0: '#FFEAA7', // Light Yellow
    295.0: '#DDA0DD', // Orchid
    280.0: '#98D8C8', // Light Teal
    270.0: '#F7DC6F', // Yellow
    default: '#3498db' 
  };

  const roundedDim = parseFloat(maxDim.toFixed(1));
  
  if (colorMap.hasOwnProperty(roundedDim)) {
    return colorMap[roundedDim];
  }
  
  const sortedKeys = Object.keys(colorMap).map(Number).sort((a, b) => a - b);
  const closestKey = sortedKeys.reduce((prev, curr) => 
    (Math.abs(curr - roundedDim) < Math.abs(prev - roundedDim) ? curr : prev)
  );

  return colorMap[closestKey] || colorMap.default;
};

// POST /api/packing/optimize - Tối ưu sắp xếp hình chữ nhật (Giữ nguyên)
router.post('/optimize', async (req, res) => {
  try {
    const { container, rectangles, layers } = req.body;
    
    if (!container || !rectangles || !layers) {
      return res.status(400).json({ 
        error: 'Thiếu thông tin container, rectangles hoặc layers' 
      });
    }
    
    if (container.width <= 0 || container.length <= 0) {
      return res.status(400).json({ 
        error: 'Kích thước container phải lớn hơn 0' 
      });
    }
    
    if (layers <= 0) {
      return res.status(400).json({ 
        error: 'Số lớp phải lớn hơn 0' 
      });
    }
    
    const algorithm = new PackingAlgorithm();
    
    const rectangleInstances = rectangles.map(rect => Rectangle.fromJSON(rect));
    
    const result = await algorithm.optimize(container, rectangleInstances, layers);
    
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
    { id: 1, width: 245.0, length: 360.0, name: '14#-15#' },
    { id: 2, width: 240.0, length: 345.0, name: '12.5#- 13.5#' },
    { id: 3, width: 230.0, length: 335.0, name: '11#-12#' },
    { id: 4, width: 225.0, length: 320.0, name: '9.5#-10.5#' },
    { id: 5, width: 220.0, length: 305.0, name:  '8#-9#' },
    { id: 6, width: 215.0, length: 295.0, name: '6.5#-7.5#' },
    { id: 7, width: 205.0, length: 280.0, name: '5#- 6#' },
    { id: 8, width: 200.0, length: 270.0, name: '3.5#- 4.5#' },
  ].map(rect => ({
    ...rect,
    color: getColorForRectangle(rect) 
  }));
  
  res.json({ rectangles: defaultRectangles });
});

// POST /api/packing/validate - Kiểm tra tính hợp lệ của dữ liệu
router.post('/validate', (req, res) => {
  try {
    const { container, rectangles } = req.body;
    
    const errors = [];
    
    if (!container || typeof container.width !== 'number' || typeof container.length !== 'number') {
      errors.push('Container phải có width và length hợp lệ');
    }
    
    if (container && (container.width <= 0 || container.length <= 0)) {
      errors.push('Kích thước container phải lớn hơn 0');
    }
    
    rectangles.forEach((rect, index) => {
      if (!rect.width || !rect.length || rect.width <= 0 || rect.length <= 0) {
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

export default router;