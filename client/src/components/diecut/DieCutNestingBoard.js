/**
 * DieCutNestingBoard.js
 * Hiển thị kết quả nesting dạng SVG cho True Shape.
 * Mỗi sheet là 1 tab. Vẽ biên dạng thực (Polygon Path) với màu sắc theo size.
 * Hiển thị cặp L+R: L có viền trắng, R có viền vàng đậm.
 * Hỗ trợ hover tooltip.
 *
 * Props:
 *   nestingResult  - kết quả từ server
 *   sizeList       - danh sách size để map màu
 *   compactMode    - true → SVG auto-fit container, ẩn zoom controls & stats bar
 */
import React, { useState } from 'react';

// Palette màu fill theo size (index)
const FILL_PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#84CC16','#F97316','#EC4899','#14B8A6',
  '#A78BFA','#FCD34D','#6EE7B7','#FCA5A5','#93C5FD'
];

// Palette màu viền cho cặp (index pairId % n)
function polygonToSVGPath(polygon) {
  if (!polygon || polygon.length < 2) return '';
  const d = polygon.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return d + ' Z';
}

// Tính centroid đơn giản để đặt label
function getCentroid(polygon) {
  if (!polygon || polygon.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of polygon) { sx += p.x; sy += p.y; }
  return { x: sx / polygon.length, y: sy / polygon.length };
}

function getItemRenderPath(item, renderTemplates) {
  const template = item.renderKey ? renderTemplates?.[item.renderKey] : null;
  return template?.path || item.renderPath || polygonToSVGPath(item.polygon);
}

function getItemLabelPos(item, renderTemplates) {
  const template = item.renderKey ? renderTemplates?.[item.renderKey] : null;
  if (template?.labelOffset) {
    return {
      x: item.x + template.labelOffset.x,
      y: item.y + template.labelOffset.y
    };
  }
  return item.labelPos || getCentroid(item.polygon);
}

function getItemPathTransform(item, renderTemplates) {
  return item.renderKey && renderTemplates?.[item.renderKey]
    ? `translate(${item.x}, ${item.y})`
    : undefined;
}

// ─────────────────────────────────────────────────────────
// SheetCanvas: vẽ 1 tấm PU, hỗ trợ Pan & Zoom
// ─────────────────────────────────────────────────────────
const SheetCanvas = React.memo(({ sheet, sizeColorMap, scale, showPairLines, compactMode, isRotated }) => {
  const { sheetWidth, sheetHeight, placed, renderTemplates } = sheet;
  const [hovered, setHovered] = useState(null);

  // States cho Pan & Zoom
  const containerRef = React.useRef(null);
  const [zoom, setZoom] = useState(compactMode ? 1 : scale || 0.5);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });

  // Gắn event wheel non-passive để chặn Scroll web
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.preventDefault();
      // Phóng to / Thu nhỏ
      const zoomFactor = -e.deltaY * 0.002;
      setZoom(prev => Math.max(0.1, Math.min(prev + zoomFactor, 10)));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Chỉ chuột trái
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Update zoom khi nhấn nút zoom ở ngoài (Full Mode)
  React.useEffect(() => {
    if (!compactMode) setZoom(scale);
  }, [scale, compactMode]);

  // Tạo đường kết nối giữa L và R của cùng cặp
  const renderedPlaced = React.useMemo(() => (
    placed.map((item) => ({
      ...item,
      svgPath: getItemRenderPath(item, renderTemplates),
      labelPos: getItemLabelPos(item, renderTemplates),
      pathTransform: getItemPathTransform(item, renderTemplates),
      fillColor: sizeColorMap[item.sizeName] || '#888'
    }))
  ), [placed, renderTemplates, sizeColorMap]);

  const pairLines = React.useMemo(() => {
    if (!showPairLines) return [];

    const pairGroups = {};
    for (const item of renderedPlaced) {
      if (item.pairId !== undefined && item.pairId !== null) {
        if (!pairGroups[item.pairId]) pairGroups[item.pairId] = {};
        pairGroups[item.pairId][item.foot] = item;
      }
    }

    return Object.values(pairGroups).flatMap((grp) => {
      if (!grp.L || !grp.R) return [];
      return [{
        x1: grp.L.labelPos.x,
        y1: grp.L.labelPos.y,
        x2: grp.R.labelPos.x,
        y2: grp.R.labelPos.y
      }];
    });
  }, [renderedPlaced, showPairLines]);

  const hoveredItem = React.useMemo(
    () => renderedPlaced.find((item) => item.id === hovered) || null,
    [renderedPlaced, hovered]
  );

  // Nếu isRotated = true, đổi viewBox để ngang bằng dọc
  const viewBoxW = isRotated ? sheetHeight : sheetWidth;
  const viewBoxH = isRotated ? sheetWidth : sheetHeight;

  // Mặc định luôn để full size cho viewBox SVG, CSS scale lo phần thu phóng
  const svgProps = {
    viewBox: `0 0 ${viewBoxW} ${viewBoxH}`,
    width: compactMode ? '100%' : viewBoxW,
    height: compactMode ? '100%' : viewBoxH,
    style: { display: 'block', background: '#0f0f1a' },
    preserveAspectRatio: 'xMidYMid meet'
  };

  return (
    <div
      ref={containerRef}
      className="rounded-lg bg-gray-900 border border-white/10 relative flex justify-center items-center overflow-hidden"
      style={{
        ...(compactMode ? { maxHeight: '65vh', height: '100%' } : { height: viewBoxH * scale + 40 }),
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / (compactMode ? 1 : scale)})`,
          transformOrigin: 'center',
          transition: isDragging ? 'none' : 'transform 0.05s ease-out',
          width: compactMode ? '100%' : viewBoxW * scale,
          height: compactMode ? '100%' : viewBoxH * scale,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}
      >
        <svg {...svgProps}>
          {/* Nút reset view nổi đè lên trên khi có thay đổi zoom/pan */}
          {/* (Note: Các nút reset có thể nằm ngoài SVG nếu cần) */}
          {/* Nếu xoay ngang, đưa toàn bộ coordinate system quay -90 độ (swap width height) */}
          <g transform={isRotated ? `translate(0, ${sheetWidth}) rotate(-90)` : undefined}>
          <defs>
            <pattern id="board-grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
            </pattern>
          </defs>

          {/* Background grid */}
          <rect x={0} y={0} width={sheetWidth} height={sheetHeight} fill="url(#board-grid)" />

          {/* Sheet border */}
          <rect x={0} y={0} width={sheetWidth} height={sheetHeight}
            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={3} />

          {/* Pair connector lines */}
          {pairLines.map((ln, i) => (
            <line
              key={i}
              x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth={1.5}
              strokeDasharray="6,4"
            />
          ))}

          {/* Placed items */}
          {renderedPlaced.map((item) => {
            const fillColor  = item.fillColor;
            const svgPath    = item.svgPath;
            const cent       = item.labelPos;
            const pathTransform = item.pathTransform;
            const isHov      = hovered === item.id;

            const strokeColor = item.isFlipped ? '#fbbf24' : 'rgba(255,255,255,0.85)';
            const strokeW     = isHov ? 3 : (item.isFlipped ? 2 : 1.2);
            const fillOp      = isHov ? 0.85 : 0.62;

            return (
              <g
                key={item.id}
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'default' }}
              >
                {isHov && (
                  <path d={svgPath} transform={pathTransform} fill="white" fillOpacity={0.12}
                    stroke="white" strokeWidth={6} strokeOpacity={0.4} />
                )}
                <path
                  d={svgPath}
                  transform={pathTransform}
                  fill={fillColor}
                  fillOpacity={fillOp}
                  stroke={strokeColor}
                  strokeWidth={strokeW}
                  strokeLinejoin="round"
                />
                
                {/* Wrap các text vào subgroup để counter-rotate nếu board bị xoay ngang */}
                <g transform={isRotated ? `rotate(90, ${cent.x}, ${cent.y})` : undefined}>
                  <text
                    x={cent.x} y={cent.y}
                    fontSize={7} fill="white" fillOpacity={0.9}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ fontFamily: 'monospace', pointerEvents: 'none', userSelect: 'none', fontWeight: 'bold' }}
                  >
                    {item.sizeName}{item.foot}
                  </text>
                  {item.angle === 180 && (
                    <text
                      x={cent.x} y={cent.y + 9}
                      fontSize={5} fill="rgba(255,200,0,0.9)"
                      textAnchor="middle" dominantBaseline="middle"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      ↺180°
                    </text>
                  )}
                </g>
              </g>
            );
          })}
          </g>
        </svg>
      </div>

      {/* Hover tooltip không bị scale theo SVG để chữ rõ ràng */}
      {hoveredItem && (() => {
        const item = hoveredItem;
        return (
          <div className="absolute top-2 left-2 bg-black/80 text-white text-xs rounded-lg px-3 py-2 pointer-events-none border border-white/20 z-10 shadow-lg">
            <div className="font-bold">Size {item.sizeName} — Chân {item.foot === 'L' ? 'Trái (L)' : 'Phải (R)'}</div>
            <div className="text-white/60">X: {item.x?.toFixed(1)}mm, Y: {item.y?.toFixed(1)}mm</div>
            {item.angle === 180 && <div className="text-yellow-300">Xoay 180°</div>}
            {item.pairId !== undefined && <div className="text-white/50">Cặp #{item.pairId + 1}</div>}
          </div>
        );
      })()}

      {/* Button reset view (khi có zoom hay kéo lệch) */}
      {(offset.x !== 0 || offset.y !== 0 || zoom !== (compactMode ? 1 : scale)) && (
        <button
          onClick={(e) => { e.stopPropagation(); setOffset({x:0, y:0}); setZoom(compactMode ? 1 : scale); }}
          className="absolute bottom-2 right-2 bg-white/10 hover:bg-white/20 text-white text-[10px] px-2 py-1 rounded-md border border-white/20 backdrop-blur-md z-10 transition-colors"
        >
          📍 Đặt lại góc nhìn
        </button>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────
// DieCutNestingBoard: component chính
// ─────────────────────────────────────────────────────────
const DieCutNestingBoard = ({ nestingResult, sizeList, compactMode = false }) => {
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [scale, setScale] = useState(0.5);
  const [showPairLines, setShowPairLines] = useState(true);
  const [isRotated, setIsRotated] = useState(false);
  const memoizedSizeColorMap = React.useMemo(() => {
    const nextMap = {};
    (sizeList || []).forEach((s, i) => {
      nextMap[s.sizeName] = FILL_PALETTE[i % FILL_PALETTE.length];
    });
    return nextMap;
  }, [sizeList]);

  if (!nestingResult || !nestingResult.sheets || nestingResult.sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-white/40 text-sm">
        Chưa có kết quả Nesting. Hãy cấu hình và bấm Chạy Nesting.
      </div>
    );
  }

  // Map sizeName → fill color
  const sizeColorMap = memoizedSizeColorMap;

  // Map pairId → pair border color
  const { sheets, totalSheets, placedCount, unplacedCount, efficiency, timeMs } = nestingResult;
  const currentSheet = sheets[selectedSheet] || sheets[0];
  const pairCount = Math.floor(placedCount / 2);

  // ── COMPACT MODE: dùng cho TestCapacityResult (cột phải)
  if (compactMode) {
    return (
      <div className="flex flex-col gap-2 h-full">
        {/* Mini header kèm sheet tabs */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-white/60 text-xs font-medium">
            🗺️ Bố cục tấm PU
            {currentSheet && (
              <span className="text-white/40 ml-2">
                ({currentSheet.sheetWidth}×{currentSheet.sheetHeight} mm)
              </span>
            )}
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-1.5 cursor-pointer text-white/50 text-xs hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={isRotated}
                onChange={e => setIsRotated(e.target.checked)}
                className="w-3.5 h-3.5 accent-amber-500 rounded bg-white/10 border-white/20"
              />
              <span className="flex items-center gap-1"><span className="text-sm">🔄</span> Xoay ngang</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-white/50 text-xs hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={showPairLines}
                onChange={e => setShowPairLines(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-500 rounded bg-white/10 border-white/20"
              />
              <span className="flex items-center gap-1">🔗 Kết nối cặp</span>
            </label>
          </div>
        </div>

        {/* Sheet tabs (chỉ hiện nếu có nhiều hơn 1 tấm) */}
        {sheets.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {sheets.map((sh, i) => (
              <button
                key={i}
                onClick={() => setSelectedSheet(i)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                  selectedSheet === i
                    ? 'bg-amber-500 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                Tấm {i + 1} <span className="opacity-60">({sh.efficiency}%)</span>
              </button>
            ))}
          </div>
        )}

        {/* Canvas tự fit container */}
        {currentSheet && (
          <SheetCanvas
            sheet={currentSheet}
            sizeColorMap={sizeColorMap}
            scale={scale}
            showPairLines={showPairLines}
            compactMode={true}
            isRotated={isRotated}
          />
        )}
      </div>
    );
  }

  // ── FULL MODE: dùng cho kết quả nesting thường (Step 4)
  return (
    <div className="space-y-3">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { label: 'Số tấm PU',       value: totalSheets,              color: 'blue'    },
          { label: 'Số đôi xếp được', value: `${pairCount} đôi`,       color: 'green'   },
          { label: 'Tổng chiếc',      value: `${placedCount} chiếc`,   color: 'emerald' },
          { label: 'Chưa xếp',        value: `${unplacedCount} chiếc`, color: unplacedCount > 0 ? 'red' : 'gray' },
          { label: 'Hiệu suất',       value: `${efficiency}%`,          color: 'yellow'  },
        ].map((stat, i) => (
          <div key={i} className="bg-white/10 rounded-lg p-2 text-center border border-white/10">
            <div className={`text-lg font-bold text-${stat.color}-300`}>{stat.value}</div>
            <div className="text-white/50 text-xs">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-white/50 text-xs">Thu phóng:</span>
          {[0.3, 0.5, 0.7, 1.0].map(s => (
            <button key={s}
              onClick={() => setScale(s)}
              className={`px-2 py-0.5 rounded text-xs ${scale === s ? 'bg-white/30 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
            >
              {(s * 100).toFixed(0)}%
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-white/60 text-xs">
          <input
            type="checkbox"
            checked={showPairLines}
            onChange={e => setShowPairLines(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-400"
          />
          Hiển thị đường kết nối cặp
        </label>
        <p className="text-white/40 text-xs">Thời gian tính: {(timeMs / 1000).toFixed(1)}s</p>
      </div>

      {/* Sheet tabs */}
      <div className="flex gap-1 flex-wrap">
        {sheets.map((sh, i) => (
          <button
            key={i}
            onClick={() => setSelectedSheet(i)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              selectedSheet === i
                ? 'bg-blue-500 text-white'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            Tấm {i + 1} <span className="opacity-70">({sh.efficiency}% | {sh.placedCount} chiếc)</span>
          </button>
        ))}
      </div>

      {/* Canvas */}
      {currentSheet && (
        <SheetCanvas
          sheet={currentSheet}
          sizeColorMap={sizeColorMap}
          scale={scale}
          showPairLines={showPairLines}
          compactMode={false}
          isRotated={isRotated}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        {Object.entries(sizeColorMap).map(([sizeName, color]) => (
          <div key={sizeName} className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm border border-white/20" style={{ background: color }} />
            <span className="text-white/60 text-xs">Size {sizeName}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-sm border-2 border-yellow-400" style={{background:'transparent'}} />
          <span className="text-white/60 text-xs">Chân Phải (R)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-sm border-2 border-white/80" style={{background:'transparent'}} />
          <span className="text-white/60 text-xs">Chân Trái (L)</span>
        </div>
      </div>
    </div>
  );
};

export default DieCutNestingBoard;
