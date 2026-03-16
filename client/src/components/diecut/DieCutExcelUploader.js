/**
 * DieCutExcelUploader.js
 * Upload file Excel Form Tính Toán (RPRO/SIZE).
 * Gọi /api/diecut/parse-excel và trả về danh sách size + số lượng đôi.
 * Cho phép user chỉnh sửa số lượng trước khi chạy Nesting.
 */
import React, { useState } from 'react';

const DieCutExcelUploader = ({ onQuantitiesLoaded }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quantities, setQuantities] = useState([]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
    setError(null);
    setQuantities([]);
  };

  const handleUpload = async () => {
    if (!file) { setError('Vui lòng chọn file Excel'); return; }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('excelFile', file);
      const res = await fetch('/api/diecut/parse-excel', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi server');
      setQuantities(data.sizeQuantities);
      onQuantitiesLoaded(data.sizeQuantities);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQtyChange = (index, value) => {
    // Cho phép nhập text rỗng hoặc số
    const valStr = value.replace(/[^0-9]/g, '');
    const updated = quantities.map((q, i) => {
      if (i === index) {
        return {
          ...q,
          _rawInput: valStr, // Lưu tạm string để user có thể xóa trắng
          pairQuantity: parseInt(valStr) || 0,
          pieceQuantity: (parseInt(valStr) || 0) * 2
        };
      }
      return q;
    });
    setQuantities(updated);
    onQuantitiesLoaded(updated);
  };

  // Tính tổng
  const totalPairs = quantities.reduce((s, q) => s + q.pairQuantity, 0);
  const totalPieces = quantities.reduce((s, q) => s + q.pieceQuantity, 0);

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 space-y-4">
      <h3 className="text-white font-semibold text-base flex items-center gap-2">
        <span className="text-xl">📊</span> Import Excel Đơn Hàng
      </h3>

      {/* Upload */}
      <div
        className="border-2 border-dashed border-white/30 rounded-xl p-4 text-center cursor-pointer hover:border-green-400 transition-colors"
        onClick={() => document.getElementById('excel-file-input').click()}
      >
        <input
          id="excel-file-input"
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
        />
        {file ? (
          <div className="text-white text-sm flex items-center justify-center gap-2">
            <span className="text-green-400">✓</span> {file.name}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-3xl">📋</div>
            <p className="text-white/70 text-sm">Nhấn để chọn file Excel Form Tính Toán</p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 text-red-200 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={loading || !file}
        className="w-full py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
      >
        {loading ? '⏳ Đang đọc Excel...' : '✅ Phân tích Excel'}
      </button>

      {/* Số lượng - có thể edit */}
      {quantities.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-white/70 text-xs font-medium">Số lượng theo size (có thể chỉnh):</p>
            <div className="text-xs text-white/50">
              Tổng: {totalPairs} đôi / {totalPieces} chiếc
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1">
            {quantities.map((q, i) => (
              <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                <span className="text-white font-medium text-sm w-16 flex-shrink-0">Size {q.sizeName}</span>
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="text"
                    value={q._rawInput !== undefined ? q._rawInput : q.pairQuantity}
                    onChange={e => handleQtyChange(i, e.target.value)}
                    className="w-20 bg-white/10 border border-white/20 text-white rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:border-green-400"
                  />
                  <span className="text-white/50 text-xs">đôi</span>
                </div>
                <span className="text-white/40 text-xs flex-shrink-0">=</span>
                <span className="text-emerald-300 text-xs font-medium flex-shrink-0 w-18 text-right">
                  {q.pieceQuantity} chiếc
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DieCutExcelUploader;
