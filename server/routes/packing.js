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
// ... (Giữ nguyên nội dung)
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

// --- ROUTE MỚI: XUẤT DXF ---
// POST /api/packing/export-dxf - Xuất kết quả ra file DXF
router.post('/export-dxf', async (req, res) => {
  try {
    const { container, rectangles } = req.body;
    
    if (!container || !rectangles) {
      return res.status(400).json({ 
        error: 'Thiếu thông tin container hoặc kết quả sắp xếp' 
      });
    }
    
    // Đảm bảo rectangles là một mảng
    const allPlacedRectangles = Array.isArray(rectangles) ? rectangles : [];

    // Tạo nội dung file DXF
    const dxfContent = PackingAlgorithm.exportToDXF(container, allPlacedRectangles);
    
    // Thiết lập header để trình duyệt tải xuống file
    res.setHeader('Content-disposition', 'attachment; filename=packing_layout.dxf');
    res.setHeader('Content-type', 'application/dxf');
    res.send(dxfContent);

  } catch (error) {
    console.error('DXF export error:', error);
    res.status(500).json({ 
      error: 'Lỗi trong quá trình xuất file DXF: ' + error.message 
    });
  }
});

// GET /api/packing/rectangles - Lấy danh sách hình chữ nhật mặc định
router.get('/rectangles', (req, res) => {
  const defaultRectangles = [
    { id: 1, width: 360.0, length: 245.0, name: 'Hình 1' },
    { id: 2, width: 360.0, length: 122.5, name: 'Hình 2' },
    { id: 3, width: 345.0, length: 120.0, name: 'Hình 3' },
    { id: 4, width: 345.0, length: 120.0, name: 'Hình 4' },
    { id: 5, width: 335.0, length: 230.0, name: 'Hình 5' },
    { id: 6, width: 335.0, length: 115.0, name: 'Hình 6' },
    { id: 7, width: 320.0, length: 225.0, name: 'Hình 7' },
    { id: 8, width: 320.0, length: 112.5, name: 'Hình 8' },
    { id: 9, width: 305.0, length: 220.0, name: 'Hình 9' },
    { id: 10, width: 305.0, length: 110.0, name: 'Hình 10' },
    { id: 11, width: 295.0, length: 215.0, name: 'Hình 11' },
    { id: 12, width: 295.0, length: 107.5, name: 'Hình 12' },
    { id: 13, width: 280.0, length: 205.0, name: 'Hình 13' },
    { id: 14, width: 280.0, length: 102.5, name: 'Hình 14' },
    { id: 15, width: 270.0, length: 200.0, name: 'Hình 15' },
    { id: 16, width: 270.0, length: 90.0, name: 'Hình 16' }
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