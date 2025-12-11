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

  // Tối ưu Batch (MỚI - Chuyển logic sang Backend)
  async *optimizeBatch(container, rectangles, quantities, strategy, unsplitableRectIds, layers) {
    try {
      const response = await fetch(`${API_BASE_URL}/packing/optimize-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          container,
          rectangles,
          quantities,
          strategy,
          unsplitableRectIds,
          layers
        })
      });

      if (!response.ok) {
        let errMsg = response.statusText;
        try {
          const text = await response.text();
          try {
            const err = JSON.parse(text);
            errMsg = err.error || errMsg;
          } catch {
            if (text) errMsg = text.slice(0, 100);
          }
        } catch (e) {
          // Cannot read body
        }
        throw new Error(errMsg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            yield data;
          } catch (e) {
            console.warn("Stream parse error:", e);
          }
        }
      }

      // Flush residual
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer);
        } catch (e) { }
      }

    } catch (error) {
      throw new Error(`Lỗi tối ưu Batch: ${error.message}`);
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
  async exportLayoutToPdf(layoutData) {
    try {
      const response = await this.api.post(
        '/packing/export-pdf', // (this.api đã có baseURL)
        layoutData,
        {
          responseType: 'blob', // Rất quan trọng
        }
      );

      // Xử lý file blob
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'packing-layout.pdf');
      document.body.appendChild(link);
      link.click();

      // Dọn dẹp
      link.remove();
      window.URL.revokeObjectURL(url);

      return { success: true }; // Trả về thành công

    } catch (error) {
      console.error('Lỗi khi tải PDF:', error);
      // Ném lỗi để component UI (PackingResult) có thể bắt và hiển thị
      throw new Error(error.response?.data?.error || 'Không thể tải file PDF.');
    }
  }
  async exportMultiPagePdf(container, allLayouts) {
    try {
      // 1. Chuẩn bị dữ liệu để gửi đi
      const postData = {
        container: container,
        allLayouts: allLayouts
      };

      // 2. Gọi API bằng 'this.api.post' (từ class của bạn)
      // và yêu cầu 'blob'
      const response = await this.api.post('/packing/export-pdf', postData, {
        responseType: 'blob',
      });

      // 3. Xử lý file blob (file PDF) nhận về
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // 4. Đặt tên file download
      link.setAttribute('download', 'packing-layouts.pdf');

      // 5. Thêm link vào DOM, click tự động, rồi gỡ bỏ
      document.body.appendChild(link);
      link.click();

      // Dọn dẹp
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };

    } catch (error) {
      console.error('Lỗi khi xuất PDF:', error);

      // Cố gắng đọc lỗi từ JSON (nếu server trả về lỗi 400)
      if (error.response && error.response.data instanceof Blob && error.response.data.type === 'application/json') {
        try {
          const errorText = await error.response.data.text();
          const errorJson = JSON.parse(errorText);
          const errorMessage = errorJson.error || 'Lỗi không xác định từ server.';
          console.error('Server error message:', errorMessage);
          return { success: false, error: errorMessage };
        } catch (e) {
          console.error("Không thể parse lỗi JSON từ blob", e);
          return { success: false, error: 'Lỗi không thể đọc phản hồi từ server.' };
        }
      }
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Không thể xuất file PDF.'
      };
    }
  }

  // Xuất DXF
  async exportDxf(container, allLayouts) {
    try {
      const response = await this.api.post('/packing/export-dxf', {
        container,
        allLayouts
      }, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'packing-layouts.dxf');
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url);
      return { success: true };
    } catch (error) {
      console.error('Lỗi khi xuất DXF:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Không thể xuất file DXF.'
      };
    }
  }
}


export const packingService = new PackingService();