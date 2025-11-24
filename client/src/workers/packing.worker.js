// client/src/workers/packing.worker.js

import PackingAlgorithm from '../../../server/algorithms/packingAlgorithm.js';

/* eslint-disable-next-line no-restricted-globals */
self.onmessage = async (e) => {
    // Nhận dữ liệu từ giao diện gửi xuống
    const { container, rectangles, maxLayers, strategyName } = e.data;

    try {
        console.log('[Worker] Bắt đầu tính toán...');
        const startTime = Date.now();

        // Khởi tạo thuật toán
        const algorithm = new PackingAlgorithm();
        
        // Chạy tối ưu (Hàm optimize của bạn)
        const result = await algorithm.optimize(container, rectangles, maxLayers, strategyName);

        const endTime = Date.now();
        console.log(`[Worker] Hoàn thành sau ${(endTime - startTime) / 1000}s`);

        // Gửi kết quả ngược lại cho giao diện
        /* eslint-disable-next-line no-restricted-globals */
        self.postMessage({ success: true, result });

    } catch (error) {
        console.error('[Worker] Lỗi:', error);
        /* eslint-disable-next-line no-restricted-globals */
        self.postMessage({ success: false, error: error.message });
    }
};