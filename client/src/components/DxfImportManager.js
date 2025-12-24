
import React, { useRef, useState } from 'react';
import { usePacking } from '../context/PackingContext.js';
import { dxfImportService } from '../services/dxfImportService.js';

const ImportIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);

const DxfImportManager = () => {
    const { importDxfData } = usePacking();
    const fileInputRef = useRef(null);
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState(null);

    const handleButtonClick = () => {
        if (fileInputRef.current) {
            setError(null);
            fileInputRef.current.value = ''; // Reset
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.dxf')) {
            setError('Vui lòng chọn file định dạng .dxf');
            return;
        }

        setIsImporting(true);
        setError(null);

        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const content = e.target.result;
                const result = dxfImportService.parse(content);

                if (result.success) {
                    if (window.confirm(`Tìm thấy ${result.rectangles.length} loại sizes và ${result.plates.length} tấm liệu. Bạn có muốn nhập dữ liệu này? (Dữ liệu hiện tại sẽ bị thay thế)`)) {
                        importDxfData({
                            container: result.container,
                            rectangles: result.rectangles,
                            quantities: result.quantities,
                            plates: result.plates
                        });
                        alert('Nhập dữ liệu thành công!');
                    }
                } else {
                    setError(result.error || 'Lỗi không xác định khi đọc file.');
                }
            } catch (err) {
                console.error('Import Error:', err);
                setError('Lỗi xử lý file: ' + err.message);
            } finally {
                setIsImporting(false);
            }
        };

        reader.onerror = () => {
            setError('Không thể đọc file.');
            setIsImporting(false);
        };

        reader.readAsText(file);
    };

    return (
        <div className="mb-3 card p-3 md:p-4 bg-blue-50 border border-blue-200 shadow-sm">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-100 rounded-full text-blue-600">
                        <ImportIcon />
                    </div>
                    <div>
                        <h3 className="text-sm md:text-base font-semibold text-gray-800">Nhập lại file DXF</h3>
                        <p className="text-xs text-gray-500">Khôi phục sơ đồ cắt từ file DXF cũ để chỉnh sửa.</p>
                    </div>
                </div>

                <div>
                    <input
                        type="file"
                        accept=".dxf"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                    <button
                        onClick={handleButtonClick}
                        disabled={isImporting}
                        className="btn-primary bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 focus:ring-blue-200 text-sm py-2 px-4 shadow-sm"
                    >
                        {isImporting ? 'Đang xử lý...' : '📂 Chọn file DXF'}
                    </button>
                </div>
            </div>
            {error && (
                <div className="mt-2 p-2 bg-red-100 text-red-700 text-sm border border-red-300 rounded">
                    <strong>Lỗi:</strong> {error}
                </div>
            )}
        </div>
    );
};

export default DxfImportManager;
