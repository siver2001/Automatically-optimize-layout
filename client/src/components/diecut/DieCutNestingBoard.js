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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { diecutExportService } from '../../services/diecutExportService.js';

// Palette màu fill theo size (index)
const FILL_PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#84CC16','#F97316','#EC4899','#14B8A6',
  '#A78BFA','#FCD34D','#6EE7B7','#FCA5A5','#93C5FD'
];
const EMPTY_SHEETS = [];

function clonePolygon(polygon = []) {
  return polygon.map((point) => ({ ...point }));
}

function clonePlacedItem(item = {}) {
  return {
    ...item,
    polygon: clonePolygon(item.polygon),
    labelPos: item.labelPos ? { ...item.labelPos } : item.labelPos
  };
}

function cloneSheet(sheet = {}) {
  return {
    ...sheet,
    placed: (sheet.placed || []).map(clonePlacedItem)
  };
}

function getPolygonBounds(polygon = []) {
  if (!polygon.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function boxesCanConflict(boundsA, boundsB, minGap = 0) {
  return !(
    boundsA.maxX + minGap <= boundsB.minX ||
    boundsB.maxX + minGap <= boundsA.minX ||
    boundsA.maxY + minGap <= boundsB.minY ||
    boundsB.maxY + minGap <= boundsA.minY
  );
}

function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point, segStart, segEnd) {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return Math.hypot(point.x - segStart.x, point.y - segStart.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / (dx * dx + dy * dy)
    )
  );

  const projX = segStart.x + t * dx;
  const projY = segStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, c.x) - 1e-9 <= b.x &&
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    Math.min(a.y, c.y) - 1e-9 <= b.y &&
    b.y <= Math.max(a.y, c.y) + 1e-9
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function polygonDistance(polygonA = [], polygonB = []) {
  if (!polygonA.length || !polygonB.length) return Infinity;

  for (let i = 0; i < polygonA.length; i++) {
    const a1 = polygonA[i];
    const a2 = polygonA[(i + 1) % polygonA.length];
    for (let j = 0; j < polygonB.length; j++) {
      const b1 = polygonB[j];
      const b2 = polygonB[(j + 1) % polygonB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
    }
  }

  if (pointInPolygon(polygonA[0], polygonB) || pointInPolygon(polygonB[0], polygonA)) {
    return 0;
  }

  let minDistance = Infinity;
  for (let i = 0; i < polygonA.length; i++) {
    const a1 = polygonA[i];
    const a2 = polygonA[(i + 1) % polygonA.length];
    for (const point of polygonB) {
      minDistance = Math.min(minDistance, pointToSegmentDistance(point, a1, a2));
    }
  }
  for (let i = 0; i < polygonB.length; i++) {
    const b1 = polygonB[i];
    const b2 = polygonB[(i + 1) % polygonB.length];
    for (const point of polygonA) {
      minDistance = Math.min(minDistance, pointToSegmentDistance(point, b1, b2));
    }
  }

  return minDistance;
}

function translatePlacedItem(item, dx, dy) {
  return {
    ...clonePlacedItem(item),
    x: (item.x || 0) + dx,
    y: (item.y || 0) + dy,
    polygon: (item.polygon || []).map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    })),
    labelPos: item.labelPos
      ? { x: item.labelPos.x + dx, y: item.labelPos.y + dy }
      : item.labelPos
  };
}

function snapCoordinate(value, step) {
  const resolvedStep = Number(step) > 0 ? Number(step) : 0;
  if (!resolvedStep) return value;
  return Math.round(value / resolvedStep) * resolvedStep;
}

function buildSheetValidation(sheet, spacing) {
  const invalidItemIds = new Set();
  const items = sheet?.placed || [];
  const resolvedSpacing = Math.max(0, Number(spacing) || 0);
  const boundsById = new Map(items.map((item) => [item.id, getPolygonBounds(item.polygon)]));

  for (const item of items) {
    const bounds = boundsById.get(item.id);
    if (!bounds) continue;
    if (
      bounds.minX < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > (sheet.sheetWidth || 0) + 1e-6 ||
      bounds.maxY > (sheet.sheetHeight || 0) + 1e-6
    ) {
      invalidItemIds.add(item.id);
    }
  }

  for (let index = 0; index < items.length; index++) {
    for (let nextIndex = index + 1; nextIndex < items.length; nextIndex++) {
      const first = items[index];
      const second = items[nextIndex];
      const firstBounds = boundsById.get(first.id);
      const secondBounds = boundsById.get(second.id);
      if (!firstBounds || !secondBounds) continue;
      if (!boxesCanConflict(firstBounds, secondBounds, resolvedSpacing)) continue;

      const distance = polygonDistance(first.polygon, second.polygon);
      if (distance + 1e-6 < resolvedSpacing) {
        invalidItemIds.add(first.id);
        invalidItemIds.add(second.id);
      }
    }
  }

  return {
    invalidItemIds,
    invalidCount: invalidItemIds.size
  };
}

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
const SheetCanvas = React.memo(({
  sheet,
  sizeColorMap,
  scale,
  compactMode,
  isRotated,
  isEditMode,
  selectedItemId,
  invalidItemIds,
  gridStep,
  onSelectItem,
  onMoveItem
}) => {
  const { sheetWidth, sheetHeight, placed, renderTemplates } = sheet;
  const [hovered, setHovered] = useState(null);
  const [showLabels, setShowLabels] = useState(false);

  // States cho Pan & Zoom
  const containerRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const [zoom, setZoom] = useState(compactMode ? 1 : scale || 0.5);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const itemDragRef = React.useRef(null);

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

  const getSvgPoint = React.useCallback((event) => {
    const svgElement = svgRef.current;
    if (!svgElement) return null;

    const point = svgElement.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const ctm = svgElement.getScreenCTM();
    if (!ctm) return null;
    const localPoint = point.matrixTransform(ctm.inverse());

    if (!isRotated) {
      return { x: localPoint.x, y: localPoint.y };
    }

    return {
      x: sheetWidth - localPoint.y,
      y: localPoint.x
    };
  }, [isRotated, sheetWidth]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Chỉ chuột trái
    if (isEditMode) onSelectItem?.(null);
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e) => {
    if (itemDragRef.current) {
      const point = getSvgPoint(e);
      if (!point) return;
      const { item, startPoint } = itemDragRef.current;
      const nextX = snapCoordinate(item.x + (point.x - startPoint.x), gridStep);
      const nextY = snapCoordinate(item.y + (point.y - startPoint.y), gridStep);
      onMoveItem?.(item.id, nextX, nextY, item);
      return;
    }

    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    itemDragRef.current = null;
    setIsDragging(false);
  };

  const handleItemMouseDown = React.useCallback((event, item) => {
    if (!isEditMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    const startPoint = getSvgPoint(event);
    if (!startPoint) return;

    onSelectItem?.(item.id);
    itemDragRef.current = {
      item: clonePlacedItem(item),
      startPoint
    };
  }, [getSvgPoint, isEditMode, onSelectItem]);

  // Update zoom khi nhấn nút zoom ở ngoài (Full Mode)
  React.useEffect(() => {
    if (!compactMode) setZoom(scale);
  }, [scale, compactMode]);

  React.useEffect(() => {
    setShowLabels(false);
    const frameId = window.requestAnimationFrame(() => {
      setShowLabels(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [sheet, isRotated]);

  const renderedPlaced = React.useMemo(() => (
    placed.map((item) => ({
      ...item,
      svgPath: getItemRenderPath(item, renderTemplates),
      pathTransform: getItemPathTransform(item, renderTemplates),
      fillColor: sizeColorMap[item.sizeName] || '#888'
    }))
  ), [placed, renderTemplates, sizeColorMap]);

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
        ...(compactMode ? { maxHeight: '78vh', height: '100%' } : { height: viewBoxH * scale + 40 }),
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
        <svg ref={svgRef} {...svgProps}>
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



          {/* Placed items */}
          {renderedPlaced.map((item) => {
            const fillColor  = item.fillColor;
            const svgPath    = item.svgPath;
            const pathTransform = item.pathTransform;
            const isHov      = hovered === item.id;
            const isSelected = selectedItemId === item.id;
            const isInvalid = invalidItemIds?.has(item.id);

            const strokeColor = isInvalid
              ? '#f87171'
              : item.isFlipped ? '#fbbf24' : 'rgba(255,255,255,0.85)';
            const strokeW     = isInvalid ? 3.5 : isSelected ? 3 : isHov ? 3 : (item.isFlipped ? 2 : 1.2);
            const fillOp      = isInvalid ? 0.9 : isHov ? 0.85 : 0.62;
            const cent = showLabels ? getItemLabelPos(item, renderTemplates) : null;

            return (
              <g
                key={item.id}
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={(event) => handleItemMouseDown(event, item)}
                onClick={(event) => {
                  if (!isEditMode) return;
                  event.stopPropagation();
                  onSelectItem?.(item.id);
                }}
                style={{ cursor: isEditMode ? 'move' : 'default' }}
              >
                {(isHov || isSelected || isInvalid) && (
                  <path d={svgPath} transform={pathTransform} fill="white" fillOpacity={0.12}
                    stroke={isInvalid ? '#f87171' : 'white'} strokeWidth={6} strokeOpacity={0.4} />
                )}
                <path
                  d={svgPath}
                  transform={pathTransform}
                  fill={fillColor}
                  fillOpacity={fillOp}
                  stroke={strokeColor}
                  strokeWidth={strokeW}
                  strokeLinejoin="round"
                  strokeDasharray={isInvalid ? '10 6' : undefined}
                />
                
                {/* Wrap các text vào subgroup để counter-rotate nếu board bị xoay ngang */}
                {showLabels && cent ? <g transform={isRotated ? `rotate(90, ${cent.x}, ${cent.y})` : undefined}>
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
                </g> : null}
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
const DieCutNestingBoard = ({
  nestingResult,
  sizeList,
  compactMode = false,
  allowEdit = false,
  editConfig = null,
  onResultChange = null
}) => {
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [scale, setScale] = useState(0.5);
  const [isRotated, setIsRotated] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [editedSheets, setEditedSheets] = useState({});
  const [dirtySheetIndexes, setDirtySheetIndexes] = useState({});
  const [sheetDetails, setSheetDetails] = useState({});
  const [loadingSheetIndex, setLoadingSheetIndex] = useState(null);
  const sheetTabsRef = useRef(null);
  const sheets = nestingResult?.sheets || EMPTY_SHEETS;
  const totalSheets = nestingResult?.totalSheets || sheets.length;
  const placedCount = nestingResult?.placedCount || 0;
  const unplacedCount = nestingResult?.unplacedCount || 0;
  const efficiency = nestingResult?.efficiency || 0;
  const timeMs = nestingResult?.timeMs || 0;
  const memoizedSizeColorMap = React.useMemo(() => {
    const nextMap = {};
    (sizeList || []).forEach((s, i) => {
      nextMap[s.sizeName] = FILL_PALETTE[i % FILL_PALETTE.length];
    });
    return nextMap;
  }, [sizeList]);

  const emptyState = (

      <div className="flex items-center justify-center h-48 text-white/40 text-sm">
        Chưa có kết quả Nesting. Hãy cấu hình và bấm Chạy Nesting.
      </div>
  );

  useEffect(() => {
    setSelectedSheet(0);
    setSheetDetails({});
    setLoadingSheetIndex(null);
    setIsEditMode(false);
    setSelectedItemId(null);
    setEditedSheets({});
    setDirtySheetIndexes({});
    diecutExportService.clearNestingSheetDetailCache();
  }, [nestingResult?.resultId, nestingResult?.totalSheets]);

  useEffect(() => {
    if (!nestingResult?.resultId) return;
    const summarySheet = nestingResult?.sheets?.[selectedSheet];
    if (!summarySheet) return;
    if (summarySheet.placed?.length || sheetDetails[selectedSheet]?.placed?.length) return;

    let isCancelled = false;
    setLoadingSheetIndex(selectedSheet);
    diecutExportService.fetchNestingSheetDetail(nestingResult.resultId, selectedSheet)
      .then((sheet) => {
        if (isCancelled || !sheet) return;
        setSheetDetails((current) => ({ ...current, [selectedSheet]: sheet }));
      })
      .catch((err) => {
        console.error('[DieCut] load sheet detail error:', err);
      })
      .finally(() => {
        if (!isCancelled) {
          setLoadingSheetIndex((current) => (current === selectedSheet ? null : current));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [nestingResult?.resultId, nestingResult?.sheets, selectedSheet, sheetDetails]);

  useEffect(() => {
    if (!nestingResult?.resultId || !sheets.length) return;
    const preloadIndexes = [];
    for (let index = 0; index < Math.min(4, sheets.length); index++) {
      const summarySheet = sheets[index];
      if (!summarySheet?.placed?.length && !sheetDetails[index]?.placed?.length) {
        preloadIndexes.push(index);
      }
    }
    if (!preloadIndexes.length) return;

    diecutExportService.fetchNestingSheetDetails(nestingResult.resultId, preloadIndexes)
      .then((loadedSheets) => {
        if (!loadedSheets?.length) return;
        setSheetDetails((current) => {
          const next = { ...current };
          for (const entry of loadedSheets) {
            const index = Number(entry?.sheetIndex);
            if (Number.isFinite(index)) {
              next[index] = entry.sheet;
            }
          }
          return next;
        });
      })
      .catch(() => {});
  }, [nestingResult?.resultId, sheets, sheetDetails]);

  useEffect(() => {
    if (!sheetTabsRef.current) return;
    const tabEl = sheetTabsRef.current.querySelector(`[data-sheet-index="${selectedSheet}"]`);
    if (!tabEl) return;
    tabEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedSheet]);

  useEffect(() => {
    setSelectedItemId(null);
  }, [selectedSheet]);

  useEffect(() => {
    if (!nestingResult?.resultId || !sheets.length) return;
    const neighborIndexes = [selectedSheet - 1, selectedSheet + 1]
      .filter((index) => index >= 0 && index < sheets.length);

    for (const index of neighborIndexes) {
      const summarySheet = sheets[index];
      if (!summarySheet || summarySheet.placed?.length || sheetDetails[index]?.placed?.length) continue;

      diecutExportService.fetchNestingSheetDetail(nestingResult.resultId, index)
        .then((sheet) => {
          if (!sheet) return;
          setSheetDetails((current) => (
            current[index]?.placed?.length
              ? current
              : { ...current, [index]: sheet }
          ));
        })
        .catch(() => {});
    }
  }, [nestingResult?.resultId, selectedSheet, sheetDetails, sheets]);

  // Map sizeName → fill color
  const sizeColorMap = memoizedSizeColorMap;

  // Map pairId → pair border color
  const resolvedSheets = useMemo(
    () => sheets.map((sheet, index) => sheetDetails[index] || sheet),
    [sheetDetails, sheets]
  );
  const displaySheets = useMemo(
    () => resolvedSheets.map((sheet, index) => editedSheets[index] || sheet),
    [editedSheets, resolvedSheets]
  );
  const currentSheet = displaySheets[selectedSheet] || displaySheets[0];
  const sourceSheet = resolvedSheets[selectedSheet] || resolvedSheets[0];
  const resolvedSpacing = editConfig?.spacing ?? nestingResult?.spacing ?? 0;
  const resolvedGridStep = editConfig?.gridStep ?? nestingResult?.gridStep ?? 0.5;
  const validation = useMemo(
    () => buildSheetValidation(currentSheet, resolvedSpacing),
    [currentSheet, resolvedSpacing]
  );
  const currentSheetDirty = !!dirtySheetIndexes[selectedSheet];
  const pairCount = Math.floor(placedCount / 2);

  const updateCurrentEditedSheet = React.useCallback((updater) => {
    setEditedSheets((current) => {
      const baseSheet = current[selectedSheet] || cloneSheet(sourceSheet || currentSheet || {});
      const nextSheet = typeof updater === 'function' ? updater(baseSheet) : baseSheet;
      return {
        ...current,
        [selectedSheet]: nextSheet
      };
    });
    setDirtySheetIndexes((current) => ({ ...current, [selectedSheet]: true }));
  }, [currentSheet, selectedSheet, sourceSheet]);

  const handleMoveItem = React.useCallback((itemId, nextX, nextY, originalItem) => {
    if (!allowEdit || !isEditMode) return;

    updateCurrentEditedSheet((sheet) => {
      const dx = nextX - (originalItem?.x || 0);
      const dy = nextY - (originalItem?.y || 0);
      return {
        ...sheet,
        placed: (sheet.placed || []).map((item) => (
          item.id === itemId ? translatePlacedItem(originalItem || item, dx, dy) : item
        ))
      };
    });
  }, [allowEdit, isEditMode, updateCurrentEditedSheet]);

  const handleToggleEditMode = React.useCallback(() => {
    if (!allowEdit) return;
    if (isEditMode) {
      setIsEditMode(false);
      setSelectedItemId(null);
      return;
    }

    setEditedSheets((current) => (
      current[selectedSheet]
        ? current
        : { ...current, [selectedSheet]: cloneSheet(sourceSheet || currentSheet || {}) }
    ));
    setIsEditMode(true);
  }, [allowEdit, currentSheet, isEditMode, selectedSheet, sourceSheet]);

  const handleCancelEdit = React.useCallback(() => {
    setEditedSheets((current) => {
      const next = { ...current };
      delete next[selectedSheet];
      return next;
    });
    setDirtySheetIndexes((current) => {
      const next = { ...current };
      delete next[selectedSheet];
      return next;
    });
    setSelectedItemId(null);
    setIsEditMode(false);
  }, [selectedSheet]);

  const handleSaveEdit = React.useCallback(() => {
    if (!onResultChange || validation.invalidCount > 0 || !currentSheetDirty || !currentSheet) return;

    const nextSheets = resolvedSheets.map((sheet, index) => (
      index === selectedSheet ? cloneSheet(currentSheet) : sheet
    ));

    onResultChange((previous) => previous ? {
      ...previous,
      sheets: nextSheets
    } : previous);

    setEditedSheets((current) => {
      const next = { ...current };
      delete next[selectedSheet];
      return next;
    });
    setDirtySheetIndexes((current) => {
      const next = { ...current };
      delete next[selectedSheet];
      return next;
    });
    setSelectedItemId(null);
    setIsEditMode(false);
  }, [currentSheet, currentSheetDirty, onResultChange, resolvedSheets, selectedSheet, validation.invalidCount]);

  if (sheets.length === 0) {
    return emptyState;
  }

  // ── COMPACT MODE: dùng cho TestCapacityResult (cột phải)
  if (compactMode) {
    return (
      <div className="flex flex-col gap-2 h-full">
        {/* Mini header kèm sheet tabs */}
        <div className="flex items-center justify-between gap-3 bg-white/5 p-2 rounded-xl mb-1 border border-white/5">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-sm">💠</span>
            <span className="text-white/80 text-xs font-semibold uppercase tracking-wider">
              Bố cục tấm PU
              {currentSheet && (
                <span className="text-white/30 ml-2 font-normal lowercase tracking-normal italic">
                  ({currentSheet.sheetWidth}×{currentSheet.sheetHeight} mm)
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {allowEdit && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleEditMode}
                  className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                    isEditMode
                      ? 'bg-amber-500/20 border-amber-400/30 text-amber-200'
                      : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {isEditMode ? 'Thoát edit' : 'Edit layout'}
                </button>
                {isEditMode && (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!currentSheetDirty || validation.invalidCount > 0}
                      className="px-2 py-1 rounded text-[11px] border border-emerald-400/30 bg-emerald-500/20 text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Lưu
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-2 py-1 rounded text-[11px] border border-white/10 bg-white/10 text-white/70 hover:bg-white/20"
                    >
                      Hủy
                    </button>
                  </>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-8 h-4 rounded-full p-0.5 transition-all duration-300 ${isRotated ? 'bg-amber-500' : 'bg-white/10'}`}>
                <div className={`w-3 h-3 bg-white rounded-full shadow-md transform transition-transform duration-300 ${isRotated ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <input
                type="checkbox"
                hidden
                checked={isRotated}
                onChange={e => setIsRotated(e.target.checked)}
              />
              <span className={`text-[11px] font-medium transition-colors ${isRotated ? 'text-amber-400' : 'text-white/40 group-hover:text-white/60'}`}>
                🔄 Xoay ngang
              </span>
            </label>
          </div>
        </div>

        {allowEdit && isEditMode && (
          <div className={`rounded-lg border px-3 py-2 text-[11px] ${
            validation.invalidCount > 0
              ? 'bg-red-500/15 border-red-400/30 text-red-200'
              : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
          }`}>
            {validation.invalidCount > 0
              ? `Đang có ${validation.invalidCount} chi tiết bị vi phạm khoảng cách ${resolvedSpacing} mm hoặc chạm biên. Các chi tiết lỗi đang hiển thị màu đỏ.`
              : `Có thể kéo chi tiết theo lưới ${resolvedGridStep} mm. Khoảng cách tối thiểu đang được kiểm tra theo thiết lập ${resolvedSpacing} mm.`}
          </div>
        )}

        {/* Sheet tabs (chỉ hiện nếu có nhiều hơn 1 tấm) */}
        {sheets.length > 1 && (
          <div
            ref={sheetTabsRef}
            className="grid grid-flow-col auto-cols-[7.5rem] gap-1 overflow-x-auto pb-1 pr-1 custom-scrollbar max-w-full"
          >
            {sheets.map((sh, i) => (
              <button
                key={i}
                data-sheet-index={i}
                onClick={() => setSelectedSheet(i)}
                className={`inline-flex w-full items-center justify-center px-2 py-0.5 rounded text-xs font-medium transition-all ${
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
        {currentSheet?.placed?.length ? (
          <SheetCanvas
            sheet={currentSheet}
            sizeColorMap={sizeColorMap}
            scale={scale}
            compactMode={true}
            isRotated={isRotated}
            isEditMode={allowEdit && isEditMode}
            selectedItemId={selectedItemId}
            invalidItemIds={validation.invalidItemIds}
            gridStep={resolvedGridStep}
            onSelectItem={setSelectedItemId}
            onMoveItem={handleMoveItem}
          />
        ) : (
          <div className="rounded-lg bg-gray-900 border border-white/10 min-h-[50vh] xl:min-h-[78vh] flex items-center justify-center text-white/50 text-sm">
            {loadingSheetIndex === selectedSheet ? 'Đang tải chi tiết tấm...' : 'Chưa có dữ liệu chi tiết cho tấm này.'}
          </div>
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

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {allowEdit && (
            <>
              <button
                onClick={handleToggleEditMode}
                className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                  isEditMode
                    ? 'bg-amber-500/20 border-amber-400/30 text-amber-200'
                    : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {isEditMode ? 'Thoát edit' : 'Edit layout'}
              </button>
              {isEditMode && (
                <>
                  <button
                    onClick={handleSaveEdit}
                    disabled={!currentSheetDirty || validation.invalidCount > 0}
                    className="px-3 py-1 rounded-lg text-xs border border-emerald-400/30 bg-emerald-500/20 text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Lưu
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 rounded-lg text-xs border border-white/10 bg-white/10 text-white/70 hover:bg-white/20"
                  >
                    Hủy
                  </button>
                </>
              )}
            </>
          )}
          <p className="text-white/40 text-xs">Thời gian tính: {(timeMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      {allowEdit && isEditMode && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${
          validation.invalidCount > 0
            ? 'bg-red-500/15 border-red-400/30 text-red-200'
            : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
        }`}>
          {validation.invalidCount > 0
            ? `Có ${validation.invalidCount} chi tiết đang vi phạm khoảng cách ${resolvedSpacing} mm hoặc ra ngoài tấm. Các chi tiết lỗi đang được tô đỏ.`
            : `Kéo chi tiết để chỉnh tay. Tọa độ sẽ bám lưới ${resolvedGridStep} mm và được kiểm tra đúng khoảng cách tối thiểu ${resolvedSpacing} mm.`}
        </div>
      )}

      {/* Sheet tabs */}
      <div
        ref={sheetTabsRef}
        className="grid grid-flow-col gap-1 overflow-x-auto pb-1 pr-1 custom-scrollbar max-w-full"
        style={{ gridAutoColumns: 'calc((100% - 2rem) / 9)' }}
      >
        {sheets.map((sh, i) => (
          <button
            key={i}
            data-sheet-index={i}
            onClick={() => setSelectedSheet(i)}
            className={`inline-flex w-full items-center justify-center px-3 py-1 rounded-lg text-xs font-medium transition-all ${
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
      {currentSheet?.placed?.length ? (
        <SheetCanvas
          sheet={currentSheet}
          sizeColorMap={sizeColorMap}
          scale={scale}
          compactMode={false}
          isRotated={isRotated}
          isEditMode={allowEdit && isEditMode}
          selectedItemId={selectedItemId}
          invalidItemIds={validation.invalidItemIds}
          gridStep={resolvedGridStep}
          onSelectItem={setSelectedItemId}
          onMoveItem={handleMoveItem}
        />
      ) : (
        <div className="rounded-lg bg-gray-900 border border-white/10 min-h-[60vh] flex items-center justify-center text-white/50 text-sm">
          {loadingSheetIndex === selectedSheet ? 'Đang tải chi tiết tấm...' : 'Chưa có dữ liệu chi tiết cho tấm này.'}
        </div>
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
        {allowEdit && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm border-2 border-red-400 border-dashed" style={{background:'rgba(248,113,113,0.2)'}} />
            <span className="text-white/60 text-xs">Lỗi khoảng cách / chạm biên</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default DieCutNestingBoard;
