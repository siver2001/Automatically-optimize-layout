import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class PackingService {
  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // Lấy danh sách hình chữ nhật mặc định (Giữ nguyên)
  async getDefaultRectangles() {
    try {
      const response = await this.api.get('/packing/rectangles');
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi tải danh sách hình chữ nhật: ${error.message}`);
    }
  }

  // Tối ưu sắp xếp (Giữ nguyên)
  async optimizePacking(container, rectangles, layers) {
    try {
      const response = await this.api.post('/packing/optimize', {
        container,
        rectangles,
        layers
      });
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi tối ưu sắp xếp: ${error.response?.data?.error || error.message}`);
    }
  }

  // Kiểm tra tính hợp lệ của dữ liệu (Giữ nguyên)
  async validateData(container, rectangles) {
    try {
      const response = await this.api.post('/packing/validate', {
        container,
        rectangles
      });
      return response.data;
    } catch (error) {
      throw new Error(`Lỗi kiểm tra dữ liệu: ${error.message}`);
    }
  }

  // --- HÀM MỚI: XUẤT DXF ---
  async exportToDXF(container, rectangles) {
    try {
      // Đặt responseType là 'blob' để nhận dữ liệu file
      const response = await this.api.post('/packing/export-dxf', {
        container,
        rectangles
      }, {
          responseType: 'blob'
      });
      
      const filename = response.headers['content-disposition'].match(/filename="?(.+)"?/i)[1];

      // Tạo đối tượng URL blob và kích hoạt tải xuống
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename || 'packing_layout.dxf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      return { success: true, message: `Đã tải xuống file ${filename}` };

    } catch (error) {
      throw new Error(`Lỗi xuất file DXF: ${error.response?.data?.error || error.message}`);
    }
  }
}

export const packingService = new PackingService();