/**
 * DieCutDxfUploader.js
 * Upload DXF, phân tích biên dạng thực (bulge-accurate).
 * Hover vào ô preview → popup phóng to toàn màn hình để xem chi tiết.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

// Màu sắc theo size index
const COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#84CC16','#F97316','#EC4899','#14B8A6',
  '#A78BFA','#FCD34D','#6EE7B7','#FCA5A5','#93C5FD'
];

// ─── Tính viewBox từ polygon ───────────────────────────
function getViewBox(polygon, padRatio = 0.05) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polygon.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  const W = maxX - minX || 1;
  const H = maxY - minY || 1;
  const PAD = Math.max(W, H) * padRatio;
  return { vx: minX - PAD, vy: minY - PAD, vw: W + PAD * 2, vh: H + PAD * 2, W, H };
}

// ─── SVG path string ───────────────────────────────────
function toPathD(polygon) {
  return polygon.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)},${p.y.toFixed(4)}`
  ).join(' ') + ' Z';
}

// ─── Popup phóng to với Scroll Zoom + Pan ─────────────
const ZoomModal = ({ shape, index, onClose }) => {
  const color = COLORS[index % COLORS.length];
  const polygon = shape.polygon;
  const { vx, vy, vw, vh, W, H } = getViewBox(polygon, 0.04);
  const d = toPathD(polygon);
  // Không dùng sw tỷ lệ nữa — dùng vector-effect non-scaling-stroke

  // Zoom & Pan state
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const svgContainerRef = useRef(null);

  // Scroll Wheel → Zoom về điểm con trỏ (attach non-passive để preventDefault hoạt động)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = svgContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setTransform(prev => {
      const newScale = Math.min(Math.max(prev.scale * zoomFactor, 0.5), 40);
      const newTx = mouseX - (mouseX - prev.tx) * (newScale / prev.scale);
      const newTy = mouseY - (mouseY - prev.ty) * (newScale / prev.scale);
      return { scale: newScale, tx: newTx, ty: newTy };
    });
  }, []);

  // Gắn wheel listener với passive:false để e.preventDefault() hoạt động
  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Mouse Pan
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }, []);

  const handleMouseUp = useCallback((e) => {
    isPanning.current = false;
    e.currentTarget.style.cursor = 'grab';
  }, []);

  const resetZoom = () => setTransform({ scale: 1, tx: 0, ty: 0 });

  const gridSize = Math.max(W, H) / 20;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-gray-950 border border-white/20 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '88vw', height: '88vh', maxWidth: '1200px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-white font-bold text-base">Biên dạng Size {shape.sizeName}</h2>
            <p className="text-white/50 text-xs">
              {shape.boundingBox.width.toFixed(2)} × {shape.boundingBox.height.toFixed(2)} mm
              &nbsp;·&nbsp;{(shape.pointCount || polygon.length).toLocaleString()} điểm
              &nbsp;·&nbsp;{shape.area.toFixed(0)} mm²
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom level indicator */}
            <span className="text-white/40 text-xs bg-white/5 px-2 py-1 rounded-lg">
              {(transform.scale * 100).toFixed(0)}%
            </span>
            <button
              onClick={resetZoom}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs rounded-lg transition-colors"
              title="Reset zoom về 100%"
            >
              ↺ Reset
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-red-500/40 text-white flex items-center justify-center text-base transition-colors"
            >✕</button>
          </div>
        </div>

        {/* ── Hint bar ── */}
        <div className="px-5 py-1.5 bg-white/3 border-b border-white/5 flex-shrink-0">
          <p className="text-white/30 text-xs">
            🖱️ Lăn chuột để phóng to / thu nhỏ &nbsp;·&nbsp; Kéo chuột để di chuyển &nbsp;·&nbsp; Nhấn Reset để về ban đầu
          </p>
        </div>

        {/* ── SVG Canvas với Zoom & Pan ── */}
        <div
          ref={svgContainerRef}
          className="flex-1 overflow-hidden rounded-b-2xl"
          style={{ cursor: 'grab', background: '#0d0d18', userSelect: 'none' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`${vx} ${vy} ${vw} ${vh}`}
            style={{
              display: 'block',
              transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
              transition: isPanning.current ? 'none' : 'transform 0.05s ease-out'
            }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Grid */}
            <defs>
              <pattern id="zoomgrid-fine" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={0.3}
                  vectorEffect="non-scaling-stroke"
                />
              </pattern>
              <pattern id="zoomgrid-coarse" width={gridSize * 5} height={gridSize * 5} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              </pattern>
            </defs>
            <rect x={vx} y={vy} width={vw} height={vh} fill="url(#zoomgrid-fine)" />
            <rect x={vx} y={vy} width={vw} height={vh} fill="url(#zoomgrid-coarse)" />

            {/* Fill nhạt */}
            <path d={d} fill={color} fillOpacity={0.10} />

            {/* Viền chính xác - nét mảnh cố định không phụ thuộc zoom */}
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Dots tại từng đỉnh — nhỏ cố định */}
            {polygon.length <= 1000 && polygon.map((p, i) => (
              <circle
                key={i}
                cx={p.x} cy={p.y}
                r={0.3}
                fill={color}
                fillOpacity={0.8}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
};

// ─── Ô thumbnail nhỏ ──────────────────────────────────
const ShapePreviewCard = ({ shape, index, onClick }) => {
  const color = COLORS[index % COLORS.length];
  const polygon = shape.polygon;
  if (!polygon || polygon.length < 2) return null;

  const { vx, vy, vw, vh } = getViewBox(polygon, 0.05);
  const d = toPathD(polygon);

  return (
    <div
      className="flex flex-col items-center bg-black/20 border border-white/15 rounded-xl p-2 cursor-zoom-in
                 hover:border-white/50 hover:bg-white/5 hover:scale-105 transition-all duration-200 group"
      onClick={onClick}
      title="Nhấn để phóng to xem chi tiết biên dạng"
    >
      {/* SVG thumbnail */}
      <div className="w-full flex items-center justify-center overflow-hidden" style={{ maxHeight: '160px' }}>
        <svg
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          style={{ width: '100%', height: '100%', maxHeight: '160px', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={d} fill={color} fillOpacity={0.15} />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Info + zoom hint */}
      <div className="mt-2 text-center w-full px-1">
        <div className="text-white font-bold text-sm">Size {shape.sizeName}</div>
        <div className="text-white/60 text-xs mt-0.5">
          {shape.boundingBox.width.toFixed(1)} × {shape.boundingBox.height.toFixed(1)} mm
        </div>
        <div className="text-white/30 text-xs">{(shape.pointCount || polygon.length).toLocaleString()} điểm</div>
        <div className="text-white/20 text-xs mt-1 group-hover:text-blue-400/70 transition-colors">🔍 Nhấn để phóng to</div>
      </div>
    </div>
  );
};

// ─── Main Uploader ─────────────────────────────────────
const DieCutDxfUploader = ({ onShapesLoaded, initialShapes, initialImportAnalysis = null }) => {
  const [startSize, setStartSize] = useState('3.5');
  const [stepSize, setStepSize] = useState('0.5');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Khởi tạo preview từ initialShapes (khi quay lại tab, shapes đã có sẵn)
  const [preview, setPreview] = useState(initialShapes || null);
  const [previewImportAnalysis, setPreviewImportAnalysis] = useState(initialImportAnalysis);
  const [zoomShape, setZoomShape] = useState(null); // { shape, index }

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
    setError(null);
    setPreview(null);
    setPreviewImportAnalysis(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) { setError('Vui lòng chọn ít nhất 1 file DXF hoặc DWG'); return; }
    const start = parseFloat(startSize);
    const step  = parseFloat(stepSize);
    if (isNaN(start) || isNaN(step) || step <= 0) {
      setError('Start Size hoặc Step Size không hợp lệ');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('dxfFiles', f, f.webkitRelativePath || f.name));
      formData.append('startSize', start);
      formData.append('stepSize', step);

      const res  = await fetch('/api/diecut/parse-dxf', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi server');

      setPreview(data.shapes);
      setPreviewImportAnalysis(data.importAnalysis || null);
      onShapesLoaded({
        shapes: data.shapes,
        importAnalysis: data.importAnalysis || null
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Zoom Modal (portal-like fixed overlay) ── */}
      {zoomShape && (
        <ZoomModal
          shape={zoomShape.shape}
          index={zoomShape.index}
          onClose={() => setZoomShape(null)}
        />
      )}

      <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 space-y-4">
        <h3 className="text-white font-semibold text-base flex items-center gap-2">
          <span className="text-xl">📐</span> Import File DXF/DWG Biên Dạng
        </h3>

        {/* Size Setup */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-white/70 text-xs mb-1">Size bắt đầu</label>
            <input
              type="number"
              value={startSize}
              onChange={e => setStartSize(e.target.value)}
              step="0.5"
              className="w-full bg-white/5 border border-white/20 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              placeholder="VD: 3.5"
            />
          </div>
          <div>
            <label className="block text-white/70 text-xs mb-1">Bước nhảy size</label>
            <input
              type="number"
              value={stepSize}
              onChange={e => setStepSize(e.target.value)}
              step="0.5"
              className="w-full bg-white/5 border border-white/20 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              placeholder="VD: 0.5"
            />
          </div>
        </div>

        {/* File Upload Drop Zone */}
        <div
          className="border-2 border-dashed border-white/30 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => document.getElementById('dxf-file-input').click()}
        >
          <input
            id="dxf-file-input"
            type="file"
            multiple
            accept=".dxf,.dwg"
            className="hidden"
            onChange={handleFileChange}
          />
          {files.length === 0 ? (
            <div className="space-y-2">
              <div className="text-4xl">📁</div>
              <p className="text-white/70 text-sm">Nhấn để chọn file DXF hoặc DWG (có thể chọn nhiều file)</p>
            </div>
          ) : (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="text-white text-sm flex items-center gap-2">
                  <span className="text-green-400">✓</span> {f.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 text-red-200 text-sm">
            {error}
          </div>
        )}

        {previewImportAnalysis?.recommendation && (
          <div className="bg-emerald-500/15 border border-emerald-400/30 rounded-lg px-3 py-2 text-sm">
            <div className="text-emerald-200 font-semibold">
              {previewImportAnalysis.recommendation.title}
            </div>
            <div className="text-white/75 text-xs mt-1">
              Hệ thống sẽ ưu tiên mode <span className="text-emerald-200 font-medium">{previewImportAnalysis.recommendation.modeLabel}</span> cho file này.
            </div>
            <div className="text-white/55 text-xs mt-1">
              {previewImportAnalysis.recommendation.reason}
            </div>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={loading || files.length === 0}
          className="w-full py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
        >
          {loading ? '⏳ Đang xử lý DXF/DWG...' : '✅ Phân tích DXF/DWG'}
        </button>

        {/* ── GALLERY BIÊN DẠNG ── */}
        {preview && preview.length > 0 && (
          <div className="space-y-3 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-white/80 text-sm font-semibold">
                Biên dạng nhận diện được ({preview.length} size)
              </p>
              <span className="text-blue-300/60 text-xs flex items-center gap-1">
                🔍 Nhấn vào ô để phóng to xem chi tiết
              </span>
            </div>

            {/* Grid: tối đa 5 cột, cuộn ngang nếu nhiều size */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${Math.min(preview.length, 5)}, minmax(120px, 1fr))`
              }}
            >
              {preview.map((shape, i) => (
                <ShapePreviewCard
                  key={i}
                  shape={shape}
                  index={i}
                  onClick={() => setZoomShape({ shape, index: i })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default DieCutDxfUploader;
