import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { diecutExportService } from "../../services/diecutExportService.js";

const FILL_PALETTE = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#EC4899",
  "#14B8A6",
  "#A78BFA",
  "#FCD34D",
  "#6EE7B7",
  "#FCA5A5",
  "#93C5FD",
];
const EMPTY_SHEETS = [];
const EMPTY_GUIDES = { x: [], y: [] };
const STAT_CLASS = {
  blue: "text-blue-300",
  green: "text-green-300",
  emerald: "text-emerald-300",
  red: "text-red-300",
  gray: "text-gray-300",
  yellow: "text-yellow-300",
};

const clonePolygon = (p = []) => p.map((pt) => ({ ...pt }));
const clonePlacedItem = (i = {}) => ({
  ...i,
  polygon: clonePolygon(i.polygon),
  labelPos: i.labelPos ? { ...i.labelPos } : i.labelPos,
});
const cloneSheet = (s = {}) => ({
  ...s,
  placed: (s.placed || []).map(clonePlacedItem),
});
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
function getPolygonBounds(p = []) {
  if (!p.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = 1 / 0,
    minY = 1 / 0,
    maxX = -1 / 0,
    maxY = -1 / 0;
  for (const pt of p) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  return { minX, minY, maxX, maxY };
}
function getPolygonArea(p = []) {
  if (!p.length) return 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const c = p[i],
      n = p[(i + 1) % p.length];
    a += c.x * n.y - n.x * c.y;
  }
  return Math.abs(a) / 2;
}
const getPlacedItemArea = (i = {}, templates = {}) => {
  if (i.area) return i.area;
  const template = i.renderKey ? templates[i.renderKey] : null;
  if (template && template.area) return template.area;
  return getPolygonArea(i.polygon || []);
};
const getSheetPlacedCount = (s = {}) => (s?.placed || []).length;
const getSheetEfficiency = (s = {}, defaultW = 0, defaultH = 0) => {
  const w = s?.sheetWidth || defaultW;
  const h = s?.sheetHeight || defaultH;
  const area = w * h;
  if (!area) return 0;
  const placedItems = s?.placed || [];
  const templates = s?.renderTemplates || {};
  return Number(
    (
      (placedItems.reduce((sum, i) => sum + getPlacedItemArea(i, templates), 0) /
        area) *
      100
    ).toFixed(1),
  );
};
function translatePlacedItem(item, dx, dy) {
  return {
    ...clonePlacedItem(item),
    x: (item.x || 0) + dx,
    y: (item.y || 0) + dy,
    polygon: (item.polygon || []).map((p) => ({ x: p.x + dx, y: p.y + dy })),
    labelPos: item.labelPos
      ? { x: item.labelPos.x + dx, y: item.labelPos.y + dy }
      : item.labelPos,
  };
}
function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y,
      xj = polygon[j].x,
      yj = polygon[j].y;
    const hit =
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)
    return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    ),
  );
  const px = a.x + t * dx,
    py = a.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}
function orientation(a, b, c) {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
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
  const o1 = orientation(a1, a2, b1),
    o2 = orientation(a1, a2, b2),
    o3 = orientation(b1, b2, a1),
    o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}
function polygonDistance(a = [], b = []) {
  if (!a.length || !b.length) return 1 / 0;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i],
      a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j],
        b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
    }
  }
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let min = 1 / 0;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i],
      a2 = a[(i + 1) % a.length];
    for (const pt of b) min = Math.min(min, pointToSegmentDistance(pt, a1, a2));
  }
  for (let i = 0; i < b.length; i++) {
    const b1 = b[i],
      b2 = b[(i + 1) % b.length];
    for (const pt of a) min = Math.min(min, pointToSegmentDistance(pt, b1, b2));
  }
  return min;
}
function buildSheetValidation(sheet, spacing) {
  const invalid = new Set(),
    items = sheet?.placed || [],
    gap = Math.max(0, Number(spacing) || 0),
    boundsMap = new Map(items.map((i) => [i.id, getPolygonBounds(i.polygon)]));
  for (const item of items) {
    const b = boundsMap.get(item.id);
    if (!b) continue;
    if (
      b.minX < -1e-6 ||
      b.minY < -1e-6 ||
      b.maxX > (sheet.sheetWidth || 0) + 1e-6 ||
      b.maxY > (sheet.sheetHeight || 0) + 1e-6
    )
      invalid.add(item.id);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const aa = items[i],
        bb = items[j],
        ab = boundsMap.get(aa.id),
        bb2 = boundsMap.get(bb.id);
      if (!ab || !bb2) continue;
      if (
        ab.maxX + gap <= bb2.minX ||
        bb2.maxX + gap <= ab.minX ||
        ab.maxY + gap <= bb2.minY ||
        bb2.maxY + gap <= ab.minY
      )
        continue;
      if (polygonDistance(aa.polygon, bb.polygon) + 1e-6 < gap) {
        invalid.add(aa.id);
        invalid.add(bb.id);
      }
    }
  }
  return { invalidItemIds: invalid, invalidCount: invalid.size };
}
function buildUpdatedNestingResult(prev, nextSheets = []) {
  const sheets = nextSheets.map((s, i) => ({
    ...s,
    sheetIndex: s?.sheetIndex ?? i,
    placedCount: getSheetPlacedCount(s),
    efficiency: getSheetEfficiency(s, prev?.sheetWidth, prev?.sheetHeight),
  }));
  const placedCount = sheets.reduce((sum, s) => sum + (s.placedCount || 0), 0);
  const totalArea = sheets.reduce((sum, s) => {
    const w = s.sheetWidth || prev?.sheetWidth || 0;
    const h = s.sheetHeight || prev?.sheetHeight || 0;
    return sum + w * h;
  }, 0);
  const usedArea = sheets.reduce((sum, s) => {
    const w = s.sheetWidth || prev?.sheetWidth || 0;
    const h = s.sheetHeight || prev?.sheetHeight || 0;
    return sum + w * h * ((s.efficiency || 0) / 100);
  }, 0);
  const planned = Number(prev?.planningSummary?.plannedPieces);
  const unplacedCount = Number.isFinite(planned)
    ? Math.max(0, planned - placedCount)
    : Math.max(0, Number(prev?.unplacedCount) || 0);
  const bySize = new Map();
  for (const s of sheets) {
    for (const item of s.placed || []) {
      const key = item?.sizeName || "Unknown";
      bySize.set(key, (bySize.get(key) || 0) + 1);
    }
  }
  return {
    ...prev,
    sheets,
    placedCount,
    unplacedCount,
    efficiency: totalArea
      ? Number(((usedArea / totalArea) * 100).toFixed(1))
      : 0,
    planningSummary: prev?.planningSummary
      ? {
          ...prev.planningSummary,
          sizes: (prev.planningSummary.sizes || []).map((size) => {
            const pcs = bySize.get(size.sizeName) || 0;
            return {
              ...size,
              placedPieces: pcs,
              placedPairs: Math.floor(pcs / 2),
            };
          }),
        }
      : prev?.planningSummary,
  };
}
function calculateSnappedPlacement({
  movingItem,
  targetMinX,
  targetMinY,
  otherItems = [],
  sheet,
  spacing = 0,
  gridStep = 0,
  snapEnabled = true,
  snapThreshold = 10,
}) {
  if (!movingItem || !sheet) return { item: movingItem, guides: EMPTY_GUIDES };
  const original = getPolygonBounds(movingItem.polygon);
  let candidate = translatePlacedItem(
    movingItem,
    (targetMinX || 0) - original.minX,
    (targetMinY || 0) - original.minY,
  );
  let bounds = getPolygonBounds(candidate.polygon);
  const w = bounds.maxX - bounds.minX,
    h = bounds.maxY - bounds.minY,
    sw = Number(sheet.sheetWidth) || 0,
    sh = Number(sheet.sheetHeight) || 0,
    maxX = Math.max(0, sw - w),
    maxY = Math.max(0, sh - h),
    threshold = Math.max(0, Number(snapThreshold) || 0),
    gap = Math.max(0, Number(spacing) || 0),
    grid = Math.max(0, Number(gridStep) || 0),
    guides = { x: [], y: [] };
  const resolve = (axis) => {
    const curr = axis === "x" ? bounds.minX : bounds.minY,
      size = axis === "x" ? w : h,
      limit = axis === "x" ? maxX : maxY,
      sheetLimit = axis === "x" ? sw : sh,
      options = [
        { target: 0, guide: 0 },
        { target: limit, guide: sheetLimit },
      ];
    if (grid > 0) {
      const g = clamp(Math.round(curr / grid) * grid, 0, limit);
      options.push({ target: g, guide: g });
    }
    for (const other of otherItems) {
      const b = getPolygonBounds(other.polygon),
        min = axis === "x" ? b.minX : b.minY,
        max = axis === "x" ? b.maxX : b.maxY;
      options.push(
        { target: min, guide: min },
        { target: clamp(max - size, 0, limit), guide: max },
        { target: clamp(max + gap, 0, limit), guide: max },
        { target: clamp(min - size - gap, 0, limit), guide: min },
      );
    }
    let best = clamp(curr, 0, limit),
      bestGuide = null,
      bestDist = 1 / 0;
    if (snapEnabled && threshold > 0) {
      for (const opt of options) {
        const dist = Math.abs(curr - opt.target);
        if (dist <= threshold && dist < bestDist) {
          best = opt.target;
          bestGuide = opt.guide;
          bestDist = dist;
        }
      }
    }
    if (bestGuide !== null) guides[axis].push(bestGuide);
    return best;
  };
  const sx = resolve("x"),
    sy = resolve("y");
  candidate = translatePlacedItem(
    candidate,
    sx - bounds.minX,
    sy - bounds.minY,
  );
  bounds = getPolygonBounds(candidate.polygon);
  const dx = clamp(bounds.minX, 0, maxX) - bounds.minX,
    dy = clamp(bounds.minY, 0, maxY) - bounds.minY;
  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6)
    candidate = translatePlacedItem(candidate, dx, dy);
  return { item: candidate, guides };
}
function rotatePlacedItem90(item) {
  const b = getPolygonBounds(item?.polygon || []),
    minX = b.minX,
    minY = b.minY,
    maxY = b.maxY;
  const rotated = (item?.polygon || []).map((p) => ({
    x: minX + (maxY - p.y),
    y: minY + (p.x - minX),
  }));
  const rb = getPolygonBounds(rotated),
    dx = minX - rb.minX,
    dy = minY - rb.minY;
  return {
    ...clonePlacedItem(item),
    x: (item?.x || 0) + dx,
    y: (item?.y || 0) + dy,
    polygon: rotated.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    labelPos: undefined,
    renderKey: undefined,
    renderPath: undefined,
  };
}
const polygonToSVGPath = (p) =>
  !p || p.length < 2
    ? ""
    : `${p.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ")} Z`;
function getCentroid(p) {
  if (!p || !p.length) return { x: 0, y: 0 };
  let x = 0,
    y = 0;
  for (const pt of p) {
    x += pt.x;
    y += pt.y;
  }
  return { x: x / p.length, y: y / p.length };
}
const getItemRenderPath = (item, templates) => {
  const t = item.renderKey ? templates?.[item.renderKey] : null;
  return t?.path || item.renderPath || polygonToSVGPath(item.polygon);
};
const getItemLabelPos = (item, templates) => {
  const t = item.renderKey ? templates?.[item.renderKey] : null;
  return t?.labelOffset
    ? { x: item.x + t.labelOffset.x, y: item.y + t.labelOffset.y }
    : item.labelPos || getCentroid(item.polygon);
};
const getItemPathTransform = (item, templates) =>
  item.renderKey && templates?.[item.renderKey]
    ? `translate(${item.x}, ${item.y})`
    : undefined;

const SheetCanvas = React.memo(function SheetCanvas({
  sheet,
  sizeColorMap,
  scale,
  compactMode,
  isRotated,
  isEditMode,
  selectedItemId,
  invalidItemIds,
  snapEnabled,
  snapGuides,
  pickedPreviewItem,
  onSelectItem,
  onMoveItem,
  onHoverPickedItem,
  onPlacePickedItem,
  onClearSnapGuides,
}) {
  const { sheetWidth, sheetHeight, placed, renderTemplates } = sheet;
  const [hovered, setHovered] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(compactMode ? 1 : scale || 0.5);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const itemDragRef = useRef(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const handleWheel = (e) => {
      e.preventDefault();
      setZoom((prev) => Math.max(0.1, Math.min(prev - e.deltaY * 0.002, 10)));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);
  const getSvgPoint = useCallback(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const local = point.matrixTransform(ctm.inverse());
      return isRotated
        ? { x: sheetWidth - local.y, y: local.x }
        : { x: local.x, y: local.y };
    },
    [isRotated, sheetWidth],
  );
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (isEditMode && pickedPreviewItem) {
      e.preventDefault();
      e.stopPropagation();
      const point = getSvgPoint(e);
      if (point) onPlacePickedItem?.(point.x, point.y);
      return;
    }
    if (isEditMode) onSelectItem?.(null);
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const handleMouseMove = (e) => {
    if (itemDragRef.current) {
      const point = getSvgPoint(e);
      if (!point) return;
      const { item, startPoint } = itemDragRef.current;
      onMoveItem?.(
        item.id,
        item.x + (point.x - startPoint.x),
        item.y + (point.y - startPoint.y),
        item,
      );
      return;
    }
    if (isEditMode && pickedPreviewItem) {
      const point = getSvgPoint(e);
      if (point) onHoverPickedItem?.(point.x, point.y);
      return;
    }
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };
  const handleMouseUp = () => {
    if (itemDragRef.current) onClearSnapGuides?.();
    itemDragRef.current = null;
    setIsDragging(false);
  };
  const handleItemMouseDown = useCallback(
    (e, item) => {
      if (!isEditMode || e.button !== 0 || pickedPreviewItem) return;
      e.stopPropagation();
      e.preventDefault();
      const point = getSvgPoint(e);
      if (!point) return;
      onSelectItem?.(item.id);
      itemDragRef.current = { item: clonePlacedItem(item), startPoint: point };
    },
    [getSvgPoint, isEditMode, onSelectItem, pickedPreviewItem],
  );
  useEffect(() => {
    if (!compactMode) setZoom(scale);
  }, [scale, compactMode]);
  useEffect(() => {
    setShowLabels(false);
    const id = window.requestAnimationFrame(() => setShowLabels(true));
    return () => window.cancelAnimationFrame(id);
  }, [sheet, isRotated]);
  const rendered = useMemo(
    () =>
      placed.map((item) => ({
        ...item,
        svgPath: getItemRenderPath(item, renderTemplates),
        pathTransform: getItemPathTransform(item, renderTemplates),
        fillColor: sizeColorMap[item.sizeName] || "#888",
      })),
    [placed, renderTemplates, sizeColorMap],
  );
  const hoveredItem = useMemo(
    () => rendered.find((item) => item.id === hovered) || null,
    [rendered, hovered],
  );
  const previewPath = pickedPreviewItem
    ? getItemRenderPath(pickedPreviewItem, renderTemplates)
    : "";
  const previewTransform = pickedPreviewItem
    ? getItemPathTransform(pickedPreviewItem, renderTemplates)
    : undefined;
  const previewLabel = pickedPreviewItem
    ? getItemLabelPos(pickedPreviewItem, renderTemplates)
    : null;
  const viewW = isRotated ? sheetHeight : sheetWidth,
    viewH = isRotated ? sheetWidth : sheetHeight;
  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gray-900"
      style={{
        ...(compactMode
          ? { maxHeight: "78vh", height: "100%" }
          : { height: viewH * scale + 40 }),
        cursor:
          pickedPreviewItem && isEditMode
            ? "crosshair"
            : isDragging
              ? "grabbing"
              : "grab",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / (compactMode ? 1 : scale)})`,
          transformOrigin: "center",
          transition: isDragging ? "none" : "transform 0.05s ease-out",
          width: compactMode ? "100%" : viewW * scale,
          height: compactMode ? "100%" : viewH * scale,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${viewH}`}
          width={compactMode ? "100%" : viewW}
          height={compactMode ? "100%" : viewH}
          style={{ display: "block", background: "#0f0f1a" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <g
            transform={
              isRotated ? `translate(0, ${sheetWidth}) rotate(-90)` : undefined
            }
          >
            <defs>
              <pattern
                id="board-grid"
                width="50"
                height="50"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect
              x={0}
              y={0}
              width={sheetWidth}
              height={sheetHeight}
              fill="url(#board-grid)"
            />
            <rect
              x={0}
              y={0}
              width={sheetWidth}
              height={sheetHeight}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={3}
            />
            {snapEnabled && isEditMode ? (
              <>
                {(snapGuides?.x || []).map((g, i) => (
                  <line
                    key={`gx-${i}`}
                    x1={g}
                    y1={0}
                    x2={g}
                    y2={sheetHeight}
                    stroke="rgba(248,113,113,0.75)"
                    strokeWidth={1.2}
                    strokeDasharray="10 6"
                  />
                ))}
                {(snapGuides?.y || []).map((g, i) => (
                  <line
                    key={`gy-${i}`}
                    x1={0}
                    y1={g}
                    x2={sheetWidth}
                    y2={g}
                    stroke="rgba(248,113,113,0.75)"
                    strokeWidth={1.2}
                    strokeDasharray="10 6"
                  />
                ))}
              </>
            ) : null}
            {rendered.map((item) => {
              const isHovered = hovered === item.id,
                isSelected = selectedItemId === item.id,
                isInvalid = invalidItemIds?.has(item.id),
                center = showLabels
                  ? getItemLabelPos(item, renderTemplates)
                  : null;
              return (
                <g
                  key={item.id}
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered(null)}
                  onMouseDown={(e) => handleItemMouseDown(e, item)}
                  onClick={(e) => {
                    if (!isEditMode || pickedPreviewItem) return;
                    e.stopPropagation();
                    onSelectItem?.(item.id);
                  }}
                  style={{
                    cursor:
                      isEditMode && !pickedPreviewItem ? "move" : "default",
                  }}
                >
                  {(isHovered || isSelected || isInvalid) && (
                    <path
                      d={item.svgPath}
                      transform={item.pathTransform}
                      fill="white"
                      fillOpacity={0.12}
                      stroke={isInvalid ? "#f87171" : "white"}
                      strokeWidth={6}
                      strokeOpacity={0.4}
                    />
                  )}
                  <path
                    d={item.svgPath}
                    transform={item.pathTransform}
                    fill={item.fillColor}
                    fillOpacity={isInvalid ? 0.9 : isHovered ? 0.85 : 0.62}
                    stroke={
                      isInvalid
                        ? "#f87171"
                        : item.isFlipped
                          ? "#fbbf24"
                          : "rgba(255,255,255,0.85)"
                    }
                    strokeWidth={
                      isInvalid
                        ? 3.5
                        : isSelected
                          ? 3
                          : isHovered
                            ? 3
                            : item.isFlipped
                              ? 2
                              : 1.2
                    }
                    strokeLinejoin="round"
                    strokeDasharray={isInvalid ? "10 6" : undefined}
                  />
                  {showLabels && center ? (
                    <g
                      transform={
                        isRotated
                          ? `rotate(90, ${center.x}, ${center.y})`
                          : undefined
                      }
                    >
                      <text
                        x={center.x}
                        y={center.y}
                        fontSize={7}
                        fill="white"
                        fillOpacity={0.9}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontFamily: "Roboto",
                          pointerEvents: "none",
                          userSelect: "none",
                          fontWeight: "bold",
                        }}
                      >
                        {item.sizeName}
                        {item.foot}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
            {pickedPreviewItem ? (
              <g opacity={0.92} pointerEvents="none">
                <path
                  d={previewPath}
                  transform={previewTransform}
                  fill="rgba(255,255,255,0.18)"
                  stroke="rgba(96,165,250,0.95)"
                  strokeWidth={3}
                  strokeDasharray="10 6"
                />
                {previewLabel ? (
                  <text
                    x={previewLabel.x}
                    y={previewLabel.y}
                    fontSize={7}
                    fill="rgba(255,255,255,0.95)"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontFamily: "Roboto", userSelect: "none" }}
                  >
                    {pickedPreviewItem.sizeName}
                    {pickedPreviewItem.foot}
                  </text>
                ) : null}
              </g>
            ) : null}
          </g>
        </svg>
      </div>
      {hoveredItem ? (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-lg border border-white/20 bg-black/80 px-3 py-2 text-xs text-white shadow-lg">
          <div className="font-bold">
            Size {hoveredItem.sizeName} - Chọn{" "}
            {hoveredItem.foot === "L" ? "Trái" : "Phải"} ({hoveredItem.foot})
          </div>
          <div className="text-white/60">
            X: {hoveredItem.x?.toFixed(1)}mm, Y: {hoveredItem.y?.toFixed(1)}mm
          </div>
        </div>
      ) : null}
      {(offset.x !== 0 ||
        offset.y !== 0 ||
        zoom !== (compactMode ? 1 : scale)) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOffset({ x: 0, y: 0 });
            setZoom(compactMode ? 1 : scale);
          }}
          className="absolute bottom-2 right-2 z-10 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[10px] text-white transition-colors hover:bg-white/20"
        >
          Đặt lại góc nhìn
        </button>
      )}
    </div>
  );
});

export default function DieCutNestingBoard({
  nestingResult,
  sizeList,
  compactMode = false,
  allowEdit = false,
  editConfig = null,
  onResultChange = null,
}) {
  const [selectedSheet, setSelectedSheet] = useState(0),
    [scale, setScale] = useState(0.5),
    [isRotated, setIsRotated] = useState(false),
    [isEditMode, setIsEditMode] = useState(false),
    [selectedItemId, setSelectedItemId] = useState(null),
    [editedSheets, setEditedSheets] = useState({}),
    [dirtySheetIndexes, setDirtySheetIndexes] = useState({}),
    [sheetDetails, setSheetDetails] = useState({}),
    [loadingSheetIndex, setLoadingSheetIndex] = useState(null),
    [sheetLibraries, setSheetLibraries] = useState({}),
    [pickedLibraryItem, setPickedLibraryItem] = useState(null),
    [pickedPreviewItem, setPickedPreviewItem] = useState(null),
    [snapEnabled, setSnapEnabled] = useState(true),
    [snapThreshold, setSnapThreshold] = useState(12),
    [snapGuides, setSnapGuides] = useState(EMPTY_GUIDES),
    [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const sheetTabsRef = useRef(null);
  const sheets = nestingResult?.sheets || EMPTY_SHEETS;
  const totalSheets = nestingResult?.totalSheets || sheets.length;
  const timeMs = nestingResult?.timeMs || 0;
  const sizeColorMap = useMemo(() => {
    const map = {};
    (sizeList || []).forEach((s, i) => {
      map[s.sizeName] = FILL_PALETTE[i % FILL_PALETTE.length];
    });
    return map;
  }, [sizeList]);
  useEffect(() => {
    setSelectedSheet(0);
    setSheetDetails({});
    setLoadingSheetIndex(null);
    setIsEditMode(false);
    setSelectedItemId(null);
    setEditedSheets({});
    setDirtySheetIndexes({});
    setSheetLibraries({});
    setPickedLibraryItem(null);
    setPickedPreviewItem(null);
    setSnapGuides(EMPTY_GUIDES);
    diecutExportService.clearNestingSheetDetailCache();
  }, [nestingResult?.resultId, nestingResult?.totalSheets]);
  useEffect(() => {
    if (!nestingResult?.resultId) return undefined;
    const summary = nestingResult?.sheets?.[selectedSheet];
    if (
      !summary ||
      summary.placed?.length ||
      sheetDetails[selectedSheet]?.placed?.length
    )
      return undefined;
    let cancelled = false;
    setLoadingSheetIndex(selectedSheet);
    diecutExportService
      .fetchNestingSheetDetail(nestingResult.resultId, selectedSheet)
      .then((sheet) => {
        if (!cancelled && sheet)
          setSheetDetails((c) => ({ ...c, [selectedSheet]: sheet }));
      })
      .catch((e) => console.error("[DieCut] load sheet detail error:", e))
      .finally(() => {
        if (!cancelled)
          setLoadingSheetIndex((c) => (c === selectedSheet ? null : c));
      });
    return () => {
      cancelled = true;
    };
  }, [
    nestingResult?.resultId,
    nestingResult?.sheets,
    selectedSheet,
    sheetDetails,
  ]);
  useEffect(() => {
    if (!nestingResult?.resultId || !sheets.length) return;
    const indexes = [];
    for (let i = 0; i < Math.min(4, sheets.length); i++) {
      if (!sheets[i]?.placed?.length && !sheetDetails[i]?.placed?.length)
        indexes.push(i);
    }
    if (!indexes.length) return;
    diecutExportService
      .fetchNestingSheetDetails(nestingResult.resultId, indexes)
      .then((loaded) => {
        if (!loaded?.length) return;
        setSheetDetails((c) => {
          const next = { ...c };
          for (const entry of loaded) {
            const i = Number(entry?.sheetIndex);
            if (Number.isFinite(i)) next[i] = entry.sheet;
          }
          return next;
        });
      })
      .catch(() => {});
  }, [nestingResult?.resultId, sheets, sheetDetails]);
  useEffect(() => {
    if (!sheetTabsRef.current) return;
    const el = sheetTabsRef.current.querySelector(
      `[data-sheet-index="${selectedSheet}"]`,
    );
    if (el)
      el.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
  }, [selectedSheet]);
  useEffect(() => {
    if (
      !pickedLibraryItem ||
      pickedLibraryItem.sourceSheetIndex === selectedSheet
    )
      return;
    setSheetLibraries((c) => ({
      ...c,
      [pickedLibraryItem.sourceSheetIndex]: [
        ...(c[pickedLibraryItem.sourceSheetIndex] || []),
        clonePlacedItem(pickedLibraryItem.item),
      ],
    }));
    setPickedLibraryItem(null);
    setPickedPreviewItem(null);
    setSnapGuides(EMPTY_GUIDES);
  }, [pickedLibraryItem, selectedSheet]);
  const resolvedSheets = useMemo(
    () => sheets.map((sheet, i) => sheetDetails[i] || sheet),
    [sheetDetails, sheets],
  );
  const displaySheets = useMemo(
    () => resolvedSheets.map((sheet, i) => editedSheets[i] || sheet),
    [editedSheets, resolvedSheets],
  );
  const currentSheet = displaySheets[selectedSheet] || displaySheets[0] || null;
  const sourceSheet =
    resolvedSheets[selectedSheet] || resolvedSheets[0] || null;
  const currentLibraryItems = useMemo(
    () => sheetLibraries[selectedSheet] || [],
    [sheetLibraries, selectedSheet],
  );
  const resolvedSpacing = editConfig?.spacing ?? nestingResult?.spacing ?? 0;
  const resolvedGridStep =
    editConfig?.gridStep ?? nestingResult?.gridStep ?? 0.5;
  const currentDirty = !!dirtySheetIndexes[selectedSheet];
  const validation = useMemo(
    () => buildSheetValidation(currentSheet, resolvedSpacing),
    [currentSheet, resolvedSpacing],
  );
  const activeInvalidItemIds = isEditMode
    ? validation.invalidItemIds
    : undefined;
  const displaySheetStats = useMemo(
    () =>
      displaySheets.map((sheet) =>
        sheet
          ? {
              placedCount: sheet?.placed?.length
                ? getSheetPlacedCount(sheet)
                : Number(sheet?.placedCount) || 0,
              efficiency: sheet?.placed?.length
                ? getSheetEfficiency(
                    sheet,
                    nestingResult?.sheetWidth,
                    nestingResult?.sheetHeight,
                  )
                : Number(sheet?.efficiency) || 0,
            }
          : { placedCount: 0, efficiency: 0 },
      ),
    [displaySheets, nestingResult?.sheetWidth, nestingResult?.sheetHeight],
  );
  const livePlacedCount = useMemo(
    () => displaySheetStats.reduce((sum, s) => sum + (s.placedCount || 0), 0),
    [displaySheetStats],
  );
  const liveEfficiency = useMemo(() => {
    let totalArea = 0,
      usedArea = 0;
    displaySheets.forEach((sheet, i) => {
      if (!sheet) return;
      const w = sheet.sheetWidth || nestingResult?.sheetWidth || 0;
      const h = sheet.sheetHeight || nestingResult?.sheetHeight || 0;
      const area = w * h;
      totalArea += area;

      if (sheet?.placed?.length) {
        const templates = sheet.renderTemplates || {};
        usedArea += (sheet.placed || []).reduce(
          (sum, item) => sum + getPlacedItemArea(item, templates),
          0,
        );
      } else {
        usedArea += area * ((displaySheetStats[i]?.efficiency || 0) / 100);
      }
    });
    return totalArea ? Number(((usedArea / totalArea) * 100).toFixed(1)) : 0;
  }, [
    displaySheetStats,
    displaySheets,
    nestingResult?.sheetWidth,
    nestingResult?.sheetHeight,
  ]);
  const targetPieces = Number.isFinite(
    Number(nestingResult?.planningSummary?.plannedPieces),
  )
    ? Number(nestingResult.planningSummary.plannedPieces)
    : (nestingResult?.placedCount || 0) + (nestingResult?.unplacedCount || 0);
  const liveUnplacedCount = Math.max(0, targetPieces - livePlacedCount);
  const currentStats = displaySheetStats[selectedSheet] || {
    placedCount: 0,
    efficiency: 0,
  };
  const livePairCount = Math.floor(livePlacedCount / 2);
  const libraryGroups = useMemo(() => {
    const grouped = new Map();
    currentLibraryItems.forEach((item) => {
      const key = `${item.sizeName || "Unknown"}::${item.foot || ""}`;
      const current = grouped.get(key) || {
        key,
        sizeName: item.sizeName || "Unknown",
        foot: item.foot || "",
        count: 0,
      };
      current.count += 1;
      grouped.set(key, current);
    });
    return [...grouped.values()].sort(
      (a, b) =>
        String(a.sizeName).localeCompare(String(b.sizeName), undefined, {
          numeric: true,
        }) || String(a.foot).localeCompare(String(b.foot)),
    );
  }, [currentLibraryItems]);
  const clearCurrentDraft = useCallback((sheetIndex) => {
    setEditedSheets((c) => {
      const n = { ...c };
      delete n[sheetIndex];
      return n;
    });
    setDirtySheetIndexes((c) => {
      const n = { ...c };
      delete n[sheetIndex];
      return n;
    });
    setSheetLibraries((c) => {
      const n = { ...c };
      delete n[sheetIndex];
      return n;
    });
  }, []);
  const updateCurrentEditedSheet = useCallback(
    (updater) => {
      setEditedSheets((c) => {
        const base =
          c[selectedSheet] || cloneSheet(sourceSheet || currentSheet || {});
        const next = typeof updater === "function" ? updater(base) : base;
        return { ...c, [selectedSheet]: next };
      });
      setDirtySheetIndexes((c) => ({ ...c, [selectedSheet]: true }));
    },
    [currentSheet, selectedSheet, sourceSheet],
  );
  const returnPickedItemToLibrary = useCallback(() => {
    if (!pickedLibraryItem) return;
    setSheetLibraries((c) => ({
      ...c,
      [pickedLibraryItem.sourceSheetIndex]: [
        ...(c[pickedLibraryItem.sourceSheetIndex] || []),
        clonePlacedItem(pickedLibraryItem.item),
      ],
    }));
    setPickedLibraryItem(null);
    setPickedPreviewItem(null);
    setSnapGuides(EMPTY_GUIDES);
  }, [pickedLibraryItem]);
  const buildSnappedCandidate = useCallback(
    (movingItem, mouseX, mouseY, otherItems) => {
      if (!movingItem || !currentSheet)
        return { item: movingItem, guides: EMPTY_GUIDES };
      const b = getPolygonBounds(movingItem.polygon);
      return calculateSnappedPlacement({
        movingItem,
        targetMinX: mouseX - (b.maxX - b.minX) / 2,
        targetMinY: mouseY - (b.maxY - b.minY) / 2,
        otherItems,
        sheet: currentSheet,
        spacing: resolvedSpacing,
        gridStep: resolvedGridStep,
        snapEnabled,
        snapThreshold,
      });
    },
    [
      currentSheet,
      resolvedGridStep,
      resolvedSpacing,
      snapEnabled,
      snapThreshold,
    ],
  );
  const handleMoveItem = useCallback(
    (itemId, nextX, nextY, originalItem) => {
      if (!allowEdit || !isEditMode || !currentSheet) return;
      const moving = clonePlacedItem(
        originalItem || currentSheet.placed?.find((i) => i.id === itemId),
      );
      if (!moving) return;
      const b = getPolygonBounds(moving.polygon);
      const { item, guides } = calculateSnappedPlacement({
        movingItem: moving,
        targetMinX: b.minX + (nextX - (moving.x || 0)),
        targetMinY: b.minY + (nextY - (moving.y || 0)),
        otherItems: (currentSheet.placed || []).filter((i) => i.id !== itemId),
        sheet: currentSheet,
        spacing: resolvedSpacing,
        gridStep: resolvedGridStep,
        snapEnabled,
        snapThreshold,
      });
      setSnapGuides(guides);
      updateCurrentEditedSheet((sheet) => ({
        ...sheet,
        placed: (sheet.placed || []).map((i) => (i.id === itemId ? item : i)),
      }));
    },
    [
      allowEdit,
      currentSheet,
      isEditMode,
      resolvedGridStep,
      resolvedSpacing,
      snapEnabled,
      snapThreshold,
      updateCurrentEditedSheet,
    ],
  );
  const handleHoverPickedItem = useCallback(
    (mouseX, mouseY) => {
      if (!pickedLibraryItem || !currentSheet) return;
      const { item, guides } = buildSnappedCandidate(
        pickedLibraryItem.item,
        mouseX,
        mouseY,
        currentSheet.placed || [],
      );
      setPickedPreviewItem(item);
      setSnapGuides(guides);
    },
    [buildSnappedCandidate, currentSheet, pickedLibraryItem],
  );
  const handlePlacePickedItem = useCallback(
    (mouseX, mouseY) => {
      if (!pickedLibraryItem || !currentSheet) return;
      const { item } = buildSnappedCandidate(
        pickedLibraryItem.item,
        mouseX,
        mouseY,
        currentSheet.placed || [],
      );
      updateCurrentEditedSheet((sheet) => ({
        ...sheet,
        placed: [...(sheet.placed || []), item],
      }));
      setPickedLibraryItem(null);
      setPickedPreviewItem(null);
      setSnapGuides(EMPTY_GUIDES);
    },
    [
      buildSnappedCandidate,
      currentSheet,
      pickedLibraryItem,
      updateCurrentEditedSheet,
    ],
  );
  const handleDeleteSelected = useCallback(() => {
    if (!isEditMode) return;
    if (pickedLibraryItem) {
      returnPickedItemToLibrary();
      return;
    }
    if (!selectedItemId || !currentSheet) return;
    const item = currentSheet.placed?.find((i) => i.id === selectedItemId);
    if (!item) return;
    updateCurrentEditedSheet((sheet) => ({
      ...sheet,
      placed: (sheet.placed || []).filter((i) => i.id !== selectedItemId),
    }));
    setSheetLibraries((c) => ({
      ...c,
      [selectedSheet]: [...(c[selectedSheet] || []), clonePlacedItem(item)],
    }));
    setSelectedItemId(null);
    setSnapGuides(EMPTY_GUIDES);
  }, [
    currentSheet,
    isEditMode,
    pickedLibraryItem,
    returnPickedItemToLibrary,
    selectedItemId,
    selectedSheet,
    updateCurrentEditedSheet,
  ]);
  const handleRotateSelection = useCallback(() => {
    if (!isEditMode) return;
    if (pickedLibraryItem) {
      setPickedLibraryItem((c) =>
        c ? { ...c, item: rotatePlacedItem90(c.item) } : c,
      );
      setPickedPreviewItem(null);
      setSnapGuides(EMPTY_GUIDES);
      return;
    }
    if (!selectedItemId) return;
    updateCurrentEditedSheet((sheet) => ({
      ...sheet,
      placed: (sheet.placed || []).map((i) =>
        i.id === selectedItemId ? rotatePlacedItem90(i) : i,
      ),
    }));
    setSnapGuides(EMPTY_GUIDES);
  }, [isEditMode, pickedLibraryItem, selectedItemId, updateCurrentEditedSheet]);
  const handlePickLibraryGroup = useCallback(
    (groupKey) => {
      if (!isEditMode || pickedLibraryItem) return;
      const items = sheetLibraries[selectedSheet] || [];
      const idx = items.findIndex(
        (item) =>
          `${item.sizeName || "Unknown"}::${item.foot || ""}` === groupKey,
      );
      if (idx < 0) return;
      const item = items[idx];
      setSheetLibraries((c) => ({
        ...c,
        [selectedSheet]: items.filter((_, i) => i !== idx),
      }));
      setPickedLibraryItem({
        sourceSheetIndex: selectedSheet,
        item: clonePlacedItem(item),
      });
      setPickedPreviewItem(null);
      setSelectedItemId(null);
      setSnapGuides(EMPTY_GUIDES);
    },
    [isEditMode, pickedLibraryItem, selectedSheet, sheetLibraries],
  );
  const handleToggleEditMode = useCallback(() => {
    if (!allowEdit || !currentSheet?.placed?.length) return;
    if (isEditMode) {
      if (currentDirty || currentLibraryItems.length > 0 || pickedLibraryItem) {
        const ok = window.confirm(
          "Bạn đang có thay đổi edit chưa lưu. Thoát sẽ hủy phiên edit của tấm này. Tiếp tục??",
        );
        if (!ok) return;
        returnPickedItemToLibrary();
        clearCurrentDraft(selectedSheet);
      }
      setIsEditMode(false);
      setSelectedItemId(null);
      setPickedPreviewItem(null);
      setSnapGuides(EMPTY_GUIDES);
      return;
    }
    setEditedSheets((c) =>
      c[selectedSheet]
        ? c
        : {
            ...c,
            [selectedSheet]: cloneSheet(sourceSheet || currentSheet || {}),
          },
    );
    setIsEditMode(true);
    setSelectedItemId(null);
    setSnapGuides(EMPTY_GUIDES);
  }, [
    allowEdit,
    clearCurrentDraft,
    currentDirty,
    currentLibraryItems.length,
    currentSheet,
    isEditMode,
    pickedLibraryItem,
    returnPickedItemToLibrary,
    selectedSheet,
    sourceSheet,
  ]);
  const handleCancelEdit = useCallback(() => {
    returnPickedItemToLibrary();
    clearCurrentDraft(selectedSheet);
    setSelectedItemId(null);
    setPickedPreviewItem(null);
    setSnapGuides(EMPTY_GUIDES);
    setIsEditMode(false);
  }, [clearCurrentDraft, returnPickedItemToLibrary, selectedSheet]);
  const handleSaveEdit = useCallback(() => {
    if (
      !onResultChange ||
      !currentSheet ||
      validation.invalidCount > 0 ||
      (!currentDirty && currentLibraryItems.length === 0)
    )
      return;
    const nextSheets = resolvedSheets.map((sheet, i) =>
      i === selectedSheet ? cloneSheet(currentSheet) : sheet,
    );
    onResultChange((prev) =>
      prev ? buildUpdatedNestingResult(prev, nextSheets) : prev,
    );
    clearCurrentDraft(selectedSheet);
    setSelectedItemId(null);
    setPickedLibraryItem(null);
    setPickedPreviewItem(null);
    setSnapGuides(EMPTY_GUIDES);
    setIsEditMode(false);
  }, [
    clearCurrentDraft,
    currentDirty,
    currentLibraryItems.length,
    currentSheet,
    onResultChange,
    resolvedSheets,
    selectedSheet,
    validation.invalidCount,
  ]);
  const handleSelectSheet = useCallback(
    (index) => {
      if (pickedLibraryItem) returnPickedItemToLibrary();
      setSelectedItemId(null);
      setPickedPreviewItem(null);
      setSnapGuides(EMPTY_GUIDES);
      setSelectedSheet(index);
    },
    [pickedLibraryItem, returnPickedItemToLibrary],
  );
  useEffect(() => {
    if (!isEditMode) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Delete") {
        e.preventDefault();
        handleDeleteSelected();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (pickedLibraryItem) returnPickedItemToLibrary();
        else {
          setSelectedItemId(null);
          setSnapGuides(EMPTY_GUIDES);
        }
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleRotateSelection();
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setSnapEnabled((c) => !c);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleDeleteSelected,
    handleRotateSelection,
    isEditMode,
    pickedLibraryItem,
    returnPickedItemToLibrary,
  ]);
  if (!sheets.length)
    return (
      <div className="flex h-48 items-center justify-center text-sm text-white/40">
        Chưa có kết quả Nesting. Hãy cấu hình và bấm Chạy Nesting.
      </div>
    );
  const canEditCurrentSheet = allowEdit && !!currentSheet?.placed?.length;
  const saveDisabled = !currentDirty || validation.invalidCount > 0;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleToggleEditMode}
        disabled={!canEditCurrentSheet}
        className={`rounded-lg border px-3 py-1 text-xs transition-colors ${isEditMode ? "border-amber-400/30 bg-amber-500/20 text-amber-200" : "border-white/10 bg-white/10 text-white/70 hover:bg-white/20"} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {isEditMode ? "Thoát edit" : "Edit layout"}
      </button>
      {isEditMode ? (
        <>
          <button
            type="button"
            onClick={handleRotateSelection}
            disabled={!selectedItemId && !pickedLibraryItem}
            className="rounded-lg border border-sky-400/30 bg-sky-500/20 px-3 py-1 text-xs text-sky-200 transition-colors hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Xoay 90°
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={!selectedItemId && !pickedLibraryItem}
            className="rounded-lg border border-red-400/30 bg-red-500/20 px-3 py-1 text-xs text-red-200 transition-colors hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Xóa vào thư viện
          </button>
          <button
            type="button"
            onClick={() => setIsLibraryOpen((c) => !c)}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/70 transition-colors hover:bg-white/20"
          >
            {isLibraryOpen ? "Ẩn thư viện" : "Mở thư viện"} (
            {currentLibraryItems.length})
          </button>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
            <button
              type="button"
              onClick={() => setSnapEnabled((c) => !c)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${snapEnabled ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/60"}`}
            >
              {snapEnabled ? "Snap on" : "Snap off"}
            </button>
            <input
              type="range"
              min="2"
              max="30"
              step="1"
              value={snapThreshold}
              onChange={(e) => setSnapThreshold(Number(e.target.value))}
              className="w-20"
            />
            <span className="w-8 text-right text-[11px] text-white/55">
              {snapThreshold}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSaveEdit}
            disabled={saveDisabled}
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Lưu
          </button>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/70 transition-colors hover:bg-white/20"
          >
            Hủy
          </button>
        </>
      ) : null}
    </div>
  );
  const status = isEditMode ? (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${validation.invalidCount > 0 ? "border-red-400/30 bg-red-500/15 text-red-200" : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"}`}
    >
      {validation.invalidCount > 0
        ? `Có ${validation.invalidCount} chi tiết đang vi phạm khoảng cách ${resolvedSpacing} mm hoặc ra ngoài tấm. Item lỗi hiện màu đỏ.`
        : `Kéo để di chuyển, R để xoay 90°, Delete để đưa vào thư viện. Snap đang bám theo khoảng cách ${resolvedSpacing} mm và lưới ${resolvedGridStep} mm.`}
      {pickedLibraryItem
        ? ` Đang cầm Size ${pickedLibraryItem.item.sizeName}${pickedLibraryItem.item.foot || ""}, click vào tấm để đặt lại.`
        : ""}
    </div>
  ) : null;
  const library =
    isEditMode && isLibraryOpen ? (
      <div className="rounded-xl border border-white/10 bg-black/15 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white">Thư viện tấm</div>
            <div className="text-[11px] text-white/45">
              Chi tiết xóa khỏi tấm hiện tại sẽ nằm ở đây cho tới khi bạn lưu
              hoặc hủy edit.
            </div>
          </div>
          <div className="rounded-full bg-amber-500/20 px-2 py-1 text-[11px] text-amber-200">
            {currentLibraryItems.length} item
          </div>
        </div>
        {libraryGroups.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {libraryGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                disabled={!!pickedLibraryItem}
                onClick={() => handlePickLibraryGroup(group.key)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">
                    Size {group.sizeName} {group.foot || ""}
                  </div>
                  <div className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">
                    {group.count}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-white/45">
                  Bấm để lấy lại chi tiết vào vùng edit
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/35">
            Chưa có item nào trong thư viện của tấm này.
          </div>
        )}
      </div>
    ) : null;
  const canvas = currentSheet?.placed?.length ? (
    <SheetCanvas
      sheet={currentSheet}
      sizeColorMap={sizeColorMap}
      scale={scale}
      compactMode={compactMode}
      isRotated={isRotated}
      isEditMode={allowEdit && isEditMode}
      selectedItemId={selectedItemId}
      invalidItemIds={activeInvalidItemIds}
      snapEnabled={snapEnabled}
      snapGuides={snapGuides}
      pickedPreviewItem={pickedPreviewItem}
      onSelectItem={setSelectedItemId}
      onMoveItem={handleMoveItem}
      onHoverPickedItem={handleHoverPickedItem}
      onPlacePickedItem={handlePlacePickedItem}
      onClearSnapGuides={() => setSnapGuides(EMPTY_GUIDES)}
    />
  ) : (
    <div
      className={`flex items-center justify-center rounded-lg border border-white/10 bg-gray-900 text-sm text-white/50 ${compactMode ? "min-h-[50vh] xl:min-h-[78vh]" : "min-h-[60vh]"}`}
    >
      {loadingSheetIndex === selectedSheet
        ? "Đang tải chi tiết tấm..."
        : "Chưa có dữ liệu chi tiết cho tấm này."}
    </div>
  );
  if (compactMode)
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 p-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-emerald-400">Bố cục tấm PU</span>
            {currentSheet ? (
              <span className="text-[11px] text-white/35">
                ({currentSheet.sheetWidth}×{currentSheet.sheetHeight} mm)
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {toolbar}
            <label className="group flex cursor-pointer items-center gap-2">
              <div
                className={`h-4 w-8 rounded-full p-0.5 transition-all duration-300 ${isRotated ? "bg-amber-500" : "bg-white/10"}`}
              >
                <div
                  className={`h-3 w-3 rounded-full bg-white shadow-md transition-transform duration-300 ${isRotated ? "translate-x-4" : "translate-x-0"}`}
                />
              </div>
              <input
                type="checkbox"
                hidden
                checked={isRotated}
                onChange={(e) => setIsRotated(e.target.checked)}
              />
              <span
                className={`text-[11px] font-medium transition-colors ${isRotated ? "text-amber-400" : "text-white/40 group-hover:text-white/60"}`}
              >
                Xoay ngang
              </span>
            </label>
          </div>
        </div>
        {status}
        {library}
        {sheets.length > 1 ? (
          <div
            ref={sheetTabsRef}
            className="grid max-w-full grid-flow-col auto-cols-[7.5rem] gap-1 overflow-x-auto pb-1 pr-1"
          >
            {displaySheets.map((sheet, i) => (
              <button
                key={sheet?.sheetIndex ?? i}
                data-sheet-index={i}
                type="button"
                onClick={() => handleSelectSheet(i)}
                className={`inline-flex w-full items-center justify-center rounded px-2 py-0.5 text-xs font-medium transition-all ${selectedSheet === i ? "bg-amber-500 text-white" : "bg-white/10 text-white/60 hover:bg-white/20"}`}
              >
                Tấm {i + 1}{" "}
                <span className="opacity-60">
                  ({displaySheetStats[i]?.efficiency || 0}%)
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {canvas}
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          { label: "Số tấm PU", value: totalSheets, color: "blue" },
          {
            label: "Số đôi xếp được",
            value: `${livePairCount} đôi`,
            color: "green",
          },
          {
            label: "Tổng chiếc",
            value: `${livePlacedCount} chiếc`,
            color: "emerald",
          },
          {
            label: "Chưa xếp",
            value: `${liveUnplacedCount} chiếc`,
            color: liveUnplacedCount > 0 ? "red" : "gray",
          },
          { label: "Hiệu suất", value: `${liveEfficiency}%`, color: "yellow" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-white/10 bg-white/10 p-2 text-center"
          >
            <div
              className={`text-lg font-bold ${STAT_CLASS[stat.color] || "text-white"}`}
            >
              {stat.value}
            </div>
            <div className="text-xs text-white/50">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50">Thu phóng:</span>
          {[0.3, 0.5, 0.7, 1].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setScale(v)}
              className={`rounded px-2 py-0.5 text-xs ${scale === v ? "bg-white/30 text-white" : "bg-white/10 text-white/60 hover:bg-white/20"}`}
            >
              {(v * 100).toFixed(0)}%
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <p className="text-xs text-white/40">
            Thời gian tính: {(timeMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>
      {status}
      {library}
      <div
        ref={sheetTabsRef}
        className="grid max-w-full grid-flow-col gap-1 overflow-x-auto pb-1 pr-1"
        style={{ gridAutoColumns: "calc((100% - 2rem) / 9)" }}
      >
        {displaySheets.map((sheet, i) => (
          <button
            key={sheet?.sheetIndex ?? i}
            data-sheet-index={i}
            type="button"
            onClick={() => handleSelectSheet(i)}
            className={`inline-flex w-full items-center justify-center rounded-lg px-3 py-1 text-xs font-medium transition-all ${selectedSheet === i ? "bg-blue-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
          >
            Tấm {i + 1}{" "}
            <span className="opacity-70">
              ({displaySheetStats[i]?.efficiency || 0}% |{" "}
              {displaySheetStats[i]?.placedCount || 0} chiếc)
            </span>
          </button>
        ))}
      </div>
      {canvas}
      <div className="flex flex-wrap gap-3 pt-1">
        {Object.entries(sizeColorMap).map(([sizeName, color]) => (
          <div key={sizeName} className="flex items-center gap-1.5">
            <div
              className="h-4 w-4 rounded-sm border border-white/20"
              style={{ background: color }}
            />
            <span className="text-xs text-white/60">Size {sizeName}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div
            className="h-4 w-4 rounded-sm border-2 border-red-400 border-dashed"
            style={{ background: "rgba(248,113,113,0.2)" }}
          />
          <span className="text-xs text-white/60">
            Lỗi khoảng cách / chạm biên
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-xs text-white/55">
          Tấm hiện tại:{" "}
          <span className="font-semibold text-white">
            {currentStats.placedCount} chiếc
          </span>{" "}
          →{" "}
          <span className="font-semibold text-amber-300">
            {currentStats.efficiency}%
          </span>
        </div>
        <div className="text-xs text-white/55">
          Tổng sau chỉnh sửa:{" "}
          <span className="font-semibold text-white">
            {livePlacedCount} chiếc
          </span>{" "}
          →{" "}
          <span className="font-semibold text-emerald-300">
            {liveEfficiency}%
          </span>
        </div>
      </div>
    </div>
  );
}
