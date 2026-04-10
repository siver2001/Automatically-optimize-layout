/**
 * DieCutLayout.js - Trang chính cho Nesting Hàng Die-Cut
 *
 * Luồng sử dụng (Nesting thường):
 * 1. Import DXF biên dạng (DieCutDxfUploader) → nhận shapes
 * 2. Import Excel đơn hàng (DieCutExcelUploader) → nhận quantities
 * 3. Merge shapes + quantities → sizeList để xếp
 * 4. Cấu hình tấm PU, khoảng cách, tùy chọn xoay
 * 5. Bấm "Chạy Nesting" → gọi /api/diecut/nest
 * 6. Hiển thị kết quả trên DieCutNestingBoard (SVG path thực tế)
 *
 * Luồng sử dụng (Test Mode):
 * 1. Import DXF biên dạng → nhận shapes
 * 2. (Bỏ qua bước nhập số lượng)
 * 3. Cấu hình tấm PU
 * 4. Bấm "Test Capacity" → gọi /api/diecut/test-capacity
 * 5. Xem số lượng tối đa từng size có thể xếp trên 1 tấm PU
 */
import React, { startTransition, useState, useMemo, useEffect } from 'react';
import DieCutDxfUploader from './DieCutDxfUploader.js';
import DieCutExcelUploader from './DieCutExcelUploader.js';
import DieCutNestingBoard from './DieCutNestingBoard.js';
import DieCutNestingStrategySelector, { DIECUT_NESTING_STRATEGY_OPTIONS } from './DieCutNestingStrategySelector.js';
import { diecutExportService } from '../../services/diecutExportService.js';

const DEFAULT_CAPACITY_MODE = {
  pairingStrategy: 'pair',
  capacityLayoutMode: 'pair-complementary'
};

function applyRecommendedMode(config, importAnalysis) {
  const recommendation = importAnalysis?.recommendation;
  if (!recommendation?.autoApply) {
    if (
      config.capacityLayoutMode === 'same-side-fine-rotate-5deg' ||
      config.capacityLayoutMode === 'same-side-prepaired-tight' ||
      config.capacityLayoutMode === 'same-side-orthogonal'
    ) {
      return {
        ...config,
        ...DEFAULT_CAPACITY_MODE
      };
    }
    return config;
  }

  return {
    ...config,
    pairingStrategy: recommendation.pairingStrategy,
    capacityLayoutMode: recommendation.capacityLayoutMode
  };
}

function isUsingRecommendedMode(config, importAnalysis) {
  const recommendation = importAnalysis?.recommendation;
  if (!recommendation) return true;

  return (
    config.pairingStrategy === recommendation.pairingStrategy &&
    config.capacityLayoutMode === recommendation.capacityLayoutMode
  );
}

function buildSameSideConfig(config, importAnalysis) {
  const recommendation = importAnalysis?.recommendation;
  const recommendedMode = recommendation?.pairingStrategy === 'same-side'
    ? recommendation.capacityLayoutMode
    : null;

  return {
    ...config,
    pairingStrategy: 'same-side',
    capacityLayoutMode: recommendedMode || 'same-side-banded'
  };
}

function getCapacityModeLabel(config) {
  if (config.pairingStrategy === 'same-side') {
    if (config.capacityLayoutMode === 'same-side-prepaired-tight') {
      return 'Ghép Chiếc (Cùng bên) - Tối ưu file ghép sẵn';
    }
    if (config.capacityLayoutMode === 'same-side-fine-rotate-5deg') {
      return 'Ghép Chiếc (Cùng bên) - Deep Search ±5°';
    }
    if (config.capacityLayoutMode === 'same-side-orthogonal') {
      return 'Ghép Chiếc (Cùng bên) - Hàng thẳng';
    }
    return 'Ghép Chiếc (Cùng bên)';
  }

  return 'Ghép Cặp (Trái-Phải)';
}

// ─────────────────────────────────────────
// Modal popup cấu hình Sheet PU
// ─────────────────────────────────────────
const SheetConfigPanel = ({ config, onChange, isTestMode, importAnalysis }) => {
  const recommendation = importAnalysis?.recommendation;
  const usingRecommendedMode = isUsingRecommendedMode(config, importAnalysis);

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-3 space-y-2">
      <h3 className="text-white font-semibold text-base flex items-center gap-2">
        <span className="text-xl">⚙️</span> Cấu hình Tấm PU
      </h3>
      
      <div className="grid grid-cols-1 gap-3">
        {/* Dimensions */}
        <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-2">
          <label className="text-white/60 text-xs font-medium flex items-center gap-1.5"><span className="text-blue-400">📏</span> Kích thước mặt cắt PU (mm)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={config.sheetWidth}
              onChange={e => onChange({ ...config, sheetWidth: Number(e.target.value) })}
              className="w-full bg-black/20 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Rộng (X)"
            />
            <span className="text-white/30 text-xs">×</span>
            <input
              type="number"
              value={config.sheetHeight}
              onChange={e => onChange({ ...config, sheetHeight: Number(e.target.value) })}
              className="w-full bg-black/20 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Cao (Y)"
            />
          </div>
        </div>

        {/* Spacing & Margins */}
        <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-2">
          <label className="text-white/60 text-xs font-medium flex items-center gap-1.5"><span className="text-green-400">↔️</span> Lề & Khoảng cách</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <div className="bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/75 text-[11px] font-semibold flex-1 leading-snug">Lề ngang</span>
                <input
                  type="number"
                  value={config.marginX}
                  onChange={e => onChange({ ...config, marginX: Number(e.target.value) })}
                  className="w-12 md:w-14 bg-transparent text-white text-sm text-right focus:outline-none shrink-0"
                />
              </div>
            </div>
            <div className="bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/75 text-[11px] font-semibold flex-1 leading-snug">Lề dọc</span>
                <input
                  type="number"
                  value={config.marginY}
                  onChange={e => onChange({ ...config, marginY: Number(e.target.value) })}
                  className="w-12 md:w-14 bg-transparent text-white text-sm text-right focus:outline-none shrink-0"
                />
              </div>
            </div>
            <div className="bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/75 text-[11px] font-semibold flex-1 leading-snug">Khoảng cách</span>
                <input
                  type="number"
                  value={config.spacing}
                  onChange={e => onChange({ ...config, spacing: Number(e.target.value) })}
                  className="w-12 md:w-14 bg-transparent text-white text-sm text-right focus:outline-none shrink-0"
                />
              </div>
            </div>
            <div className="bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/75 text-[11px] font-semibold flex-1 leading-snug">Khoảng cách so le</span>
                <input
                  type="number"
                  value={config.staggerSpacing}
                  onChange={e => onChange({ ...config, staggerSpacing: Number(e.target.value) })}
                  className="w-12 md:w-14 bg-transparent text-white text-sm text-right focus:outline-none shrink-0"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <div className="flex items-center gap-3">
          <span className="text-white/60 text-xs font-medium min-w-[100px]">Chiến lược sắp:</span>
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => onChange({
                ...config,
                pairingStrategy: 'pair',
                capacityLayoutMode: 'pair-complementary'
              })}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                config.pairingStrategy !== 'same-side'
                  ? 'bg-purple-500 text-white shadow-lg'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              👫 Ghép Cặp (Trái-Phải)
            </button>
            <button
              onClick={() => onChange(buildSameSideConfig(config, importAnalysis))}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                config.pairingStrategy === 'same-side'
                  ? 'bg-amber-500 text-white shadow-lg'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              👟 Ghép Chiếc (Cùng bên)
            </button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={config.allowRotate90}
              onChange={e => onChange({ ...config, allowRotate90: e.target.checked })}
              className="w-4 h-4 rounded border-white/20 bg-black/20 text-purple-500 focus:ring-purple-500/50"
            />
            <span className="text-white/80 text-sm group-hover:text-white transition-colors">Cho phép xoay 90° để lấp phần trống</span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-white/60 text-xs font-medium">Độ phân giải (mm):</span>
            <select 
              value={config.gridStep} 
              onChange={e => onChange({ ...config, gridStep: Number(e.target.value) })}
              className="bg-black/40 border border-white/10 text-white text-xs rounded px-2 py-1 focus:outline-none"
            >
              <option value={0.5}>0.5 mm (Rất chính xác)</option>
              <option value={1.0}>1.0 mm (Chính xác)</option>
              <option value={1.5}>1.5 mm (Cân bằng)</option>
              <option value={2.0}>2.0 mm (Nhanh)</option>
            </select>
          </div>
        </div>

        {recommendation && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs ${
              usingRecommendedMode
                ? 'bg-emerald-500/15 border-emerald-400/30'
                : 'bg-amber-500/15 border-amber-400/30'
            }`}
          >
            <div className={usingRecommendedMode ? 'text-emerald-200 font-semibold' : 'text-amber-200 font-semibold'}>
              {usingRecommendedMode
                ? `Đang dùng mode khuyến nghị: ${recommendation.modeLabel}`
                : `Mode hiện tại khác khuyến nghị cho file này: ${recommendation.modeLabel}`}
            </div>
            <div className="text-white/70 mt-1">
              {recommendation.reason}
            </div>
          </div>
        )}

        {!isTestMode && (
          <DieCutNestingStrategySelector value={config} onChange={onChange} />
        )}

      </div>
    </div>
  );
};

// ─────────────────────────────────────────
// Giao diện mô phỏng Tấm PU
// ─────────────────────────────────────────
const SheetVisualizerPanel = ({ config }) => {
  const w = config.sheetWidth || 1000;
  const h = config.sheetHeight || 1000;
  const mx = config.marginX || 0;
  const my = config.marginY || 0;
  const viewBoxW = w + 40;
  const viewBoxH = h + 40;

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 space-y-3 h-full flex flex-col">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
        <span className="text-xl">📏</span> Mô phỏng cấu hình tấm PU ({w} × {h})
      </h3>
      <div className="flex-1 bg-black/20 rounded-lg border border-white/10 flex items-center justify-center p-2 min-h-[420px]">
        <svg 
          viewBox={`-20 -20 ${viewBoxW} ${viewBoxH}`} 
          className="w-full h-full max-h-[560px]"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="pu-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
            </pattern>
            <pattern id="margin-hatch" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="20" stroke="#f87171" strokeWidth="2" strokeOpacity="0.4" />
            </pattern>
          </defs>
          
          {/* Tấm gốc */}
          <rect x="0" y="0" width={w} height={h} fill="rgba(59, 130, 246, 0.1)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth={Math.max(w,h)*0.005} />
          <rect x="0" y="0" width={w} height={h} fill="url(#pu-grid)" />
          
          {/* Vùng lề */}
          {(mx > 0 || my > 0) && (
            <>
              <rect x="0" y="0" width={w} height={h} fill="url(#margin-hatch)" />
              {/* Vùng sử dụng thật (khấu trừ lề) */}
              <rect 
                x={my} y={mx} 
                width={Math.max(0, w - my * 2)} 
                height={Math.max(0, h - mx * 2)} 
                fill="rgba(16, 185, 129, 0.1)" 
                stroke="rgba(16, 185, 129, 0.8)" 
                strokeWidth={Math.max(w,h)*0.005} 
                strokeDasharray={`${Math.max(w,h)*0.02},${Math.max(w,h)*0.01}`}
              />
              <text x={w/2} y={h/2} fill="rgba(16, 185, 129, 0.8)" fontSize={Math.max(w,h)*0.06} textAnchor="middle" dominantBaseline="middle">
                Vùng được cắt
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// Panel hiển thị kết quả Test Capacity — Layout 2 cột siêu nhỏ gọn
// ─────────────────────────────────────────────────────────
const TestCapacityResult = ({ result, config, onClose, onExportPdf, onExportDxf }) => {
  const summary = result?.summary || [];
  const sheetsBySize = result?.sheetsBySize || null;
  const initialSize = useMemo(() => {
    if (!result) return null;

    const resultSummary = result.summary || [];
    const resultSheetsBySize = result.sheetsBySize || null;
    const firstSizeWithLayout = resultSummary.find((item) => {
      const sheetForSize = resultSheetsBySize?.[item.sizeName];
      return (sheetForSize?.placedCount ?? item.totalPieces ?? 0) > 0;
    });

    return firstSizeWithLayout?.sizeName || result.defaultSizeName || resultSummary[0]?.sizeName || null;
  }, [result]);
  const [selectedSize, setSelectedSize] = useState(initialSize);

  useEffect(() => {
    if (!result) return;
    setSelectedSize(initialSize);
  }, [result, initialSize]);

  if (!result) return null;
  const { timeMs, sheet, efficiency } = result;
  const selectedSummary = summary.find(s => s.sizeName === selectedSize)
    || summary.find(s => (s.totalPieces ?? 0) > 0)
    || summary[0]
    || null;
  const selectedSheet = (sheetsBySize && selectedSummary?.sizeName && sheetsBySize[selectedSummary.sizeName])
    ? sheetsBySize[selectedSummary.sizeName]
    : sheet;
  const patternInfo = selectedSheet?.patternInfo || {};
  const totalPairs = selectedSummary?.pairs ?? (selectedSummary?.totalPieces != null ? Math.floor(selectedSummary.totalPieces / 2) : 0);
  const totalPieces = selectedSummary?.totalPieces ?? 0;
  const selectedEfficiency = selectedSummary?.efficiency ?? efficiency ?? 0;

  return (
    <div className="flex flex-col gap-2">

      {/* ── Header row siêu gọn ── */}
      <div className="flex items-center justify-between gap-4 mb-2 bg-white/5 p-2 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-base shadow-lg shadow-orange-500/20">🧪</div>
          <div>
            <h2 className="text-white font-bold text-sm leading-tight flex items-center gap-2">
              Kết quả Test Capacity
              {selectedSummary && (
                <span className="text-amber-400 font-medium px-2 py-0 rounded-md bg-amber-400/10 border border-amber-400/20 text-[10px]">
                  Size {selectedSummary.sizeName} · Hiệu suất: {selectedEfficiency}%
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2 text-white/40 text-[10px] mt-0.5">
              <span className="flex items-center gap-1"><span className="text-blue-400">📏</span> {config.sheetWidth}×{config.sheetHeight} mm</span>
              <span className="w-0.5 h-0.5 bg-white/20 rounded-full"></span>
              <span className="flex items-center gap-1"><span className="text-purple-400">⏱️</span> {(timeMs/1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onExportPdf?.({ selectedSizeName: selectedSummary?.sizeName, selectedSheet, selectedSummary })}
            disabled={!selectedSheet}
            className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 font-medium rounded-lg text-xs transition-all border border-emerald-400/20"
          >
            Export PDF
          </button>
          <button
            onClick={() => onExportDxf?.({ selectedSizeName: selectedSummary?.sizeName, selectedSheet, selectedSummary })}
            disabled={!selectedSheet}
            className="px-3 py-1 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sky-200 font-medium rounded-lg text-xs transition-all border border-sky-400/20"
          >
            Export DXF
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg text-xs transition-all flex items-center gap-1.5 border border-white/10"
          >
            <span>←</span> Trở lại
          </button>
        </div>
      </div>

      {/* ── Body: 2 cột (Trái 260px - Phải auto) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3 items-stretch">

        {/* ── CỘT TRÁI: Stats + Bảng size (Scrollable nếu dài) ── */}
        <div className="flex flex-col gap-2 max-h-[78vh] overflow-y-auto pr-1 custom-scrollbar">

          {/* 3 stat cards siêu nhỏ */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-400/30 rounded-lg p-2 text-center">
              <div className="text-2xl font-black text-amber-300 leading-none">{totalPieces}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Chiếc</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-2xl font-black text-emerald-300 leading-none">{totalPairs}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Đôi</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-2xl font-black text-blue-300 leading-none">{(timeMs/1000).toFixed(1)}s</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Thời gian</div>
            </div>
          </div>

          {/* Bảng kết quả từng size gọn nhẹ */}
          {false && (
            <div className="bg-white/5 rounded-lg border border-white/10 p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/70 text-[11px] font-medium uppercase tracking-wider">Pattern Info</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-400/20">
                  {patternInfo.layoutMode}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {patternInfo.layoutMode === 'pair-complementary' ? (
                  <>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Family: <span className="text-white">{patternInfo.patternFamily}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Top band: <span className="text-white">{patternInfo.topBandUsed ? `${patternInfo.topBandPairs} pairs` : 'off'}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Row 0 L/R: <span className="text-white">{patternInfo.bodyRow0LeftAngle} / {patternInfo.bodyRow0RightAngle} deg</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Row 1 L/R: <span className="text-white">{patternInfo.bodyRow1LeftAngle} / {patternInfo.bodyRow1RightAngle} deg</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Top L/R: <span className="text-white">{patternInfo.topBandAngleLeft ?? '-'} / {patternInfo.topBandAngleRight ?? '-'}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Pair dx / dy: <span className="text-white">{patternInfo.pairDxMm} / {patternInfo.pairDyMm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Stride X / Y: <span className="text-white">{patternInfo.rowStrideXmm} / {patternInfo.rowStrideYmm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Shift X / Y: <span className="text-white">{patternInfo.rowShiftXmm} / {patternInfo.rowShiftYmm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Rows / Cols: <span className="text-white">{patternInfo.usedRows} / {patternInfo.usedCols}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Used height: <span className="text-white">{patternInfo.usedHeightMm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70 col-span-2">Waste: <span className="text-white">{patternInfo.envelopeWasteMm2}</span></div>
                  </>
                ) : (
                  <>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Foot: <span className="text-white">{patternInfo.selectedFoot}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Mode: <span className="text-white">{patternInfo.rowMode ?? 'rows'}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Body: <span className="text-white">{patternInfo.bodyPrimaryAngle} / {patternInfo.bodyAlternateAngle} deg</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Rows / Cols: <span className="text-white">{patternInfo.bodyRows} / {patternInfo.bodyCols}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Body dx / dy: <span className="text-white">{patternInfo.bodyDxMm} / {patternInfo.bodyDyMm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Fill 90°: <span className="text-white">{patternInfo.filler90Used ? `${patternInfo.filler90Count} pcs` : 'off'}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Body pcs: <span className="text-white">{patternInfo.bodyCount}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Scan: <span className="text-white">{patternInfo.scanOrder ?? 'left-to-right'}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70">Used W / H: <span className="text-white">{patternInfo.usedWidthMm} / {patternInfo.usedHeightMm}</span></div>
                    <div className="bg-black/20 rounded px-2 py-1 text-white/70 col-span-2">Waste: <span className="text-white">{patternInfo.envelopeWasteMm2}</span></div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="bg-white/10 rounded-xl border border-white/20 overflow-hidden flex-1 flex flex-col shadow-xl">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-white/5">
              <span className="text-white font-semibold text-[11px] uppercase tracking-wider">Thống kê Size</span>
              {config.pairingStrategy === 'pair' && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded px-2 py-0.5 ml-auto font-bold">
                  Dạng Đôi
                </span>
              )}
            </div>
            <div className="overflow-y-auto flex-1 custom-scrollbar bg-black/20">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-900 border-b border-white/10 z-10">
                  <tr>
                    <th className="text-white/50 font-medium text-left py-1 px-2">Size</th>
                    {config.mirrorPairs && <th className="text-white/50 font-medium text-center py-1 px-1">Đôi</th>}
                    <th className="text-white/50 font-medium text-center py-1 px-1">Chiếc</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s, i) => (
                    <tr
                      key={s.sizeName}
                      onClick={() => setSelectedSize(s.sizeName)}
                      className={`border-b border-white/5 cursor-pointer ${
                        s.sizeName === selectedSize ? 'bg-amber-500/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <td className="py-1 px-2 text-white/80 font-medium">{s.sizeName}</td>
                      {config.mirrorPairs && (
                        <td className="py-1 px-1 text-center"><span className="text-emerald-300/90">{s.pairs ?? '—'}</span></td>
                      )}
                      <td className="py-1 px-1 text-center"><span className="text-amber-300/90">{s.totalPieces}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend nhỏ nhắn */}
          <div className="flex gap-2 justify-center py-1 bg-black/20 rounded-lg border border-white/5">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm border border-white/50" />
              <span className="text-white/40 text-[10px]">L (Trái)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm border-2 border-yellow-400/70" />
              <span className="text-white/40 text-[10px]">R (Phải)</span>
            </div>
          </div>
        </div>

        {/* ── CỘT PHẢI: Bố cục SVG tấm PU (tự fit màn hình) ── */}
        <div className="h-full min-h-[50vh] xl:min-h-[78vh]">
          {selectedSheet && selectedSheet.placed && selectedSheet.placed.length > 0 && (
            <DieCutNestingBoard
              nestingResult={{
                sheets: [selectedSheet],
                totalSheets: 1,
                placedCount: selectedSheet.placedCount,
                unplacedCount: 0,
                efficiency: selectedSheet.efficiency ?? selectedEfficiency,
                timeMs
              }}
              sizeList={summary.map(s => ({ sizeName: s.sizeName }))}
              compactMode
            />
          )}
        </div>
      </div>
    </div>
  );
};

const NormalNestingResult = ({
  nestingResult,
  sizeList,
  config,
  sizeSummary,
  activeSizeSummary,
  emptySizeSummary,
  showEmptySizeRows,
  setShowEmptySizeRows,
  onExportPdf,
  onExportDxf,
  onResultChange,
  onClose
}) => {
  const totalPairs = Math.floor((nestingResult?.placedCount || 0) / 2);
  const totalPieces = nestingResult?.placedCount || 0;
  const totalSheets = nestingResult?.totalSheets || nestingResult?.sheets?.length || 0;
  const totalTimeSeconds = ((nestingResult?.timeMs || 0) / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4 mb-2 bg-white/5 p-2 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center text-base shadow-lg shadow-pink-500/20">✂️</div>
          <div>
            <h2 className="text-white font-bold text-sm leading-tight flex items-center gap-2">
              Kết quả Nesting
              <span className="text-fuchsia-300 font-medium px-2 py-0 rounded-md bg-fuchsia-400/10 border border-fuchsia-400/20 text-[10px]">
                {getNestingStrategyLabel(nestingResult?.nestingStrategy || config.nestingStrategy)}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-white/40 text-[10px] mt-0.5 flex-wrap">
              <span className="flex items-center gap-1"><span className="text-blue-400">📏</span> {config.sheetWidth}×{config.sheetHeight} mm</span>
              <span className="w-0.5 h-0.5 bg-white/20 rounded-full"></span>
              <span>{nestingResult?.layers || config.layers || 1} lớp</span>
              <span className="w-0.5 h-0.5 bg-white/20 rounded-full"></span>
              <span className="flex items-center gap-1"><span className="text-purple-400">⏱️</span> {totalTimeSeconds}s</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={onExportPdf}
            disabled={!nestingResult?.sheets?.length}
            className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 font-medium rounded-lg text-xs transition-all border border-emerald-400/20"
          >
            Export PDF
          </button>
          <button
            onClick={onExportDxf}
            disabled={!nestingResult?.sheets?.length}
            className="px-3 py-1 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sky-200 font-medium rounded-lg text-xs transition-all border border-sky-400/20"
          >
            Export DXF
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg text-xs transition-all flex items-center gap-1.5 border border-white/10"
          >
            <span>←</span> Chạy lại
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-stretch">
        <div className="flex flex-col gap-2 max-h-[78vh] overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid grid-cols-4 gap-1.5">
            <div className="bg-gradient-to-br from-fuchsia-500/20 to-pink-500/20 border border-fuchsia-400/30 rounded-lg p-2 text-center">
              <div className="text-[1rem] font-black text-fuchsia-200 leading-none">{totalSheets}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Tấm</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[1rem] font-black text-emerald-300 leading-none">{totalPairs}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Đôi</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[1rem] font-black text-amber-300 leading-none">{totalPieces}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Chiếc</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[1rem] font-black text-blue-300 leading-none">{nestingResult?.efficiency || 0}%</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Hiệu suất</div>
            </div>
          </div>

          <div className="bg-white/10 rounded-xl border border-white/20 overflow-hidden flex-1 flex flex-col shadow-xl">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-white/5">
              <span className="text-white font-semibold text-[11px] uppercase tracking-wider">Thống kê Size</span>
              <span className="text-[10px] bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-400/20 rounded px-2 py-0.5 ml-auto font-bold">
                {activeSizeSummary.length} size có dữ liệu
              </span>
            </div>
            <div className="overflow-y-auto flex-1 custom-scrollbar bg-black/20">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-900 border-b border-white/10 z-10">
                  <tr>
                    <th className="text-white/50 font-medium text-left py-1.5 px-2">Size</th>
                    <th className="text-white/50 font-medium text-center py-1.5 px-1">Đã xếp đôi</th>
                    <th className="text-white/50 font-medium text-center py-1.5 px-1">Đã xếp chiếc</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSizeSummary.map((item) => (
                    <tr key={item.sizeName} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-1.5 px-2 text-white/80 font-medium">{item.sizeName}</td>
                      <td className="py-1.5 px-1 text-center"><span className="text-emerald-300/90">{item.placedPairs}</span></td>
                      <td className="py-1.5 px-1 text-center"><span className="text-amber-300/90">{item.placedPieces}</span></td>
                    </tr>
                  ))}
                  {showEmptySizeRows && emptySizeSummary.map((item) => (
                    <tr key={item.sizeName} className="border-b border-white/5 bg-white/[0.03]">
                      <td className="py-1.5 px-2 text-white/45 font-medium">{item.sizeName}</td>
                      <td className="py-1.5 px-1 text-center text-white/30">0</td>
                      <td className="py-1.5 px-1 text-center text-white/30">0</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {emptySizeSummary.length > 0 && (
              <button
                onClick={() => setShowEmptySizeRows((current) => !current)}
                className="px-3 py-2 border-t border-white/10 text-left text-[11px] text-white/55 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                {showEmptySizeRows
                  ? `Ẩn ${emptySizeSummary.length} size chưa có dữ liệu`
                  : `Xem thêm ${emptySizeSummary.length} size chưa có dữ liệu`}
              </button>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <DieCutNestingBoard
            nestingResult={nestingResult}
            sizeList={sizeList}
            compactMode
            allowEdit
            editConfig={config}
            onResultChange={onResultChange}
          />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────
// Merge Shapes (DXF) + Quantities (Excel) → size list
// ─────────────────────────────────────────────────────
function mergeShapesAndQuantities(shapes, quantities) {
  return shapes.map(shape => {
    const match = quantities.find(q => q.sizeName === shape.sizeName);
    return {
      ...shape,
      quantity: match ? match.pairQuantity : 0,
      pairQuantity: match ? match.pairQuantity : 0,
      pieceQuantity: match ? match.pieceQuantity : 0
    };
  });
}

function buildExportFileBase({
  orderNames = [],
  mode,
  selectedSizeName = null,
  activeSizes = []
}) {
  const uniqueOrders = [...new Set((orderNames || []).filter(Boolean))];
  const orderPart = uniqueOrders.length === 1
    ? uniqueOrders[0]
    : uniqueOrders.length > 1
      ? `${uniqueOrders.slice(0, 2).join('-')}${uniqueOrders.length > 2 ? '-multi' : ''}`
      : 'diecut';

  const sizePart = selectedSizeName
    ? `size-${selectedSizeName}`
    : activeSizes.length === 1
      ? `size-${activeSizes[0]}`
      : activeSizes.length > 1
        ? 'multi-size'
        : 'layout';

  return `${orderPart}_${mode}_${sizePart}`;
}

function getNestingStrategyLabel(strategy) {
  const matched = DIECUT_NESTING_STRATEGY_OPTIONS.find((option) => option.value === strategy);
  return matched?.title || 'Bình thường';
}

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────
const ExportSheetPickerModal = ({
  isOpen,
  format,
  sheets,
  selectedSheetIndexes,
  isSubmitting,
  onClose,
  onToggleSheet,
  onSelectAll,
  onClearAll,
  onConfirm
}) => {
  if (!isOpen) return null;

  const selectedCount = selectedSheetIndexes.length;
  const formatLabel = format === 'dxf' ? 'DXF' : 'PDF';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-white font-bold text-base">Chọn tấm để xuất {formatLabel}</h3>
            <p className="text-white/45 text-xs mt-1">
              Có thể chọn 1 tấm, nhiều tấm hoặc toàn bộ. Hiện đang chọn {selectedCount}/{sheets.length} tấm.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm disabled:opacity-40"
          >
            Đóng
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onSelectAll}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs border border-emerald-400/20 disabled:opacity-40"
            >
              Chọn tất cả
            </button>
            <button
              onClick={onClearAll}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-xs border border-white/10 disabled:opacity-40"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <div className="text-white/45 text-xs">
            {selectedCount === 0 ? 'Chưa chọn tấm nào' : `Sẽ xuất ${selectedCount} tấm`}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto custom-scrollbar px-5 py-4 space-y-2">
          {sheets.map((sheet, index) => {
            const isSelected = selectedSheetIndexes.includes(index);
            return (
              <label
                key={index}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-sky-400/30 bg-sky-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSheet(index)}
                  disabled={isSubmitting}
                  className="h-4 w-4 rounded border-white/20 bg-black/20 text-sky-500 focus:ring-sky-500/40"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm">Tấm {index + 1}</div>
                  <div className="text-white/45 text-xs mt-1 flex items-center gap-2 flex-wrap">
                    <span>{sheet?.sheetWidth || 0}×{sheet?.sheetHeight || 0} mm</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{sheet?.placedCount || 0} chiếc</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{sheet?.efficiency || 0}% hiệu suất</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm disabled:opacity-40"
          >
            Hủy
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting || selectedCount === 0}
            className="px-4 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-sm border border-sky-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Đang xuất...' : `Xuất ${formatLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const DieCutLayout = () => {
  const buildExportSubtitle = (configValue, extraText = '') => {
    if (!configValue) return extraText || '';
    const parts = [
      `${configValue.sheetWidth} x ${configValue.sheetHeight} mm`,
      `spacing ${configValue.spacing} mm`,
      `margin ${configValue.marginX}/${configValue.marginY} mm`,
      (configValue.staggerSpacing ?? configValue.spacing) !== configValue.spacing
        ? `sole ${configValue.staggerSpacing} mm`
        : null,
      configValue.layers > 1 ? `layers ${configValue.layers}` : null,
      extraText || null
    ].filter(Boolean);
    return parts.join(' | ');
  };
  const [shapes, setShapes] = useState([]);               // từ DXF
  const [importAnalysis, setImportAnalysis] = useState(null);
  const [quantities, setQuantities] = useState([]);        // từ Excel
  const [nestingResult, setNestingResult] = useState(null);
  const [isNesting, setIsNesting] = useState(false);
  const [nestError, setNestError] = useState(null);
  const [activeStep, setActiveStep] = useState(1);         // 1=DXF, 2=Excel, 3=Config, 4=Result
  const [isTestMode, setIsTestMode] = useState(false);     // Chế độ Test Capacity
  const [testResult, setTestResult] = useState(null);      // Kết quả test
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testError, setTestError] = useState(null);
  const [showEmptySizeRows, setShowEmptySizeRows] = useState(false);
  const [exportPicker, setExportPicker] = useState({
    isOpen: false,
    format: 'pdf',
    selectedSheetIndexes: [],
    isSubmitting: false
  });
  const [config, setConfig] = useState({
    sheetWidth: 1100,
    sheetHeight: 2000,
    spacing: 2,
    staggerSpacing: 2,
    marginX: 5,
    marginY: 5,
    allowRotate90: true,
    pairingStrategy: 'pair', // 'pair' hoặc 'same-side'
    gridStep: 0.5,
    capacityLayoutMode: 'pair-complementary',
    layers: 1,
    nestingStrategy: 'ordered'
  });

  // Merge shapes + quantities
  const sizeList = useMemo(() => {
    if (shapes.length === 0) return [];
    if (quantities.length === 0) {
      return shapes.map(s => ({ ...s, quantity: 0, pairQuantity: 0, pieceQuantity: 0 }));
    }
    return mergeShapesAndQuantities(shapes, quantities);
  }, [shapes, quantities]);

  // Tự động tính số lượng chiếc dựa trên strategy
  const totalPieces = sizeList.reduce((s, item) => {
    // Cả 2 strategy đều là sắp xếp theo cặp (2 chiếc lẻ thành 1 đơn vị)
    return s + item.quantity * 2;
  }, 0);
  const effectiveTotalPairs = useMemo(() => {
    const layers = Math.max(1, Math.floor(Number(config.layers) || 1));
    return sizeList.reduce((sum, item) => sum + Math.ceil((item.quantity || 0) / layers), 0);
  }, [config.layers, sizeList]);
  const effectiveTotalPieces = effectiveTotalPairs * 2;
  const hasData = shapes.length > 0;
  const exportOrderNames = [...new Set(quantities.map(item => item.orderName).filter(Boolean))];
  const activeExportSizes = sizeList
    .filter((item) => (item.quantity ?? item.pairQuantity ?? 0) > 0)
    .map((item) => item.sizeName)
    .filter(Boolean);
  const nestingResultSizeSummary = useMemo(() => {
    if (!nestingResult?.planningSummary?.sizes?.length) return [];

    const placedBySize = {};
    for (const sheet of nestingResult.sheets || []) {
      for (const item of sheet.placed || []) {
        const key = item.sizeName || 'Unknown';
        placedBySize[key] = (placedBySize[key] || 0) + 1;
      }
    }

    return nestingResult.planningSummary.sizes.map((size) => ({
      ...size,
      placedPieces: size.placedPieces ?? (placedBySize[size.sizeName] || 0),
      placedPairs: size.placedPairs ?? Math.floor((placedBySize[size.sizeName] || 0) / 2)
    }));
  }, [nestingResult]);
  const activeNestingResultSizeSummary = useMemo(
    () => nestingResultSizeSummary.filter((item) =>
      (item.originalPairs || 0) > 0
      || (item.plannedPairs || 0) > 0
      || (item.placedPairs || 0) > 0
      || (item.placedPieces || 0) > 0
    ),
    [nestingResultSizeSummary]
  );
  const emptyNestingResultSizeSummary = useMemo(
    () => nestingResultSizeSummary.filter((item) =>
      (item.originalPairs || 0) === 0
      && (item.plannedPairs || 0) === 0
      && (item.placedPairs || 0) === 0
      && (item.placedPieces || 0) === 0
    ),
    [nestingResultSizeSummary]
  );
  const usingRecommendedMode = useMemo(
    () => isUsingRecommendedMode(config, importAnalysis),
    [config, importAnalysis]
  );

  useEffect(() => {
    setShowEmptySizeRows(false);
  }, [nestingResult]);

  useEffect(() => {
    setExportPicker((current) => ({
      ...current,
      isOpen: false,
      isSubmitting: false,
      selectedSheetIndexes: []
    }));
  }, [nestingResult?.resultId, nestingResult?.totalSheets]);

  const openExportPicker = (format) => {
    const sheetIndexes = (nestingResult?.sheets || []).map((_, index) => index);
    if (!sheetIndexes.length) return;

    setExportPicker({
      isOpen: true,
      format,
      selectedSheetIndexes: sheetIndexes,
      isSubmitting: false
    });
  };

  const closeExportPicker = () => {
    setExportPicker((current) => ({
      ...current,
      isOpen: false,
      isSubmitting: false
    }));
  };

  const toggleExportSheetIndex = (sheetIndex) => {
    setExportPicker((current) => {
      const exists = current.selectedSheetIndexes.includes(sheetIndex);
      return {
        ...current,
        selectedSheetIndexes: exists
          ? current.selectedSheetIndexes.filter((index) => index !== sheetIndex)
          : [...current.selectedSheetIndexes, sheetIndex].sort((left, right) => left - right)
      };
    });
  };

  const selectAllExportSheets = () => {
    setExportPicker((current) => ({
      ...current,
      selectedSheetIndexes: (nestingResult?.sheets || []).map((_, index) => index)
    }));
  };

  const clearAllExportSheets = () => {
    setExportPicker((current) => ({
      ...current,
      selectedSheetIndexes: []
    }));
  };

  const resolveSelectedNestingSheets = async (selectedSheetIndexes) => {
    const summarySheets = nestingResult?.sheets || [];
    const detailMap = new Map();
    const missingIndexes = selectedSheetIndexes.filter((index) => !(summarySheets[index]?.placed?.length));

    if (missingIndexes.length && nestingResult?.resultId) {
      const loadedSheets = await diecutExportService.fetchNestingSheetDetails(nestingResult.resultId, missingIndexes);
      for (const entry of loadedSheets) {
        detailMap.set(entry.sheetIndex, entry.sheet);
      }
    }

    return selectedSheetIndexes
      .map((index) => detailMap.get(index) || summarySheets[index])
      .filter((sheet) => sheet?.placed?.length);
  };

  const handleConfirmExportSheets = async () => {
    const selectedSheetIndexes = [...exportPicker.selectedSheetIndexes].sort((left, right) => left - right);
    if (!selectedSheetIndexes.length || !nestingResult?.sheets?.length) return;

    setExportPicker((current) => ({ ...current, isSubmitting: true }));

    try {
      const selectedSheets = await resolveSelectedNestingSheets(selectedSheetIndexes);
      if (!selectedSheets.length) {
        throw new Error('Không lấy được dữ liệu chi tiết của các tấm đã chọn.');
      }

      const exportPayload = {
        sheets: selectedSheets,
        sheetWidth: config.sheetWidth,
        sheetHeight: config.sheetHeight,
        sizeList,
        fileNameBase: buildExportFileBase({
          orderNames: exportOrderNames,
          mode: 'nesting',
          activeSizes: activeExportSizes
        }),
        title: 'Die-Cut Nesting Result',
        subtitle: buildExportSubtitle(
          config,
          `${selectedSheets.reduce((sum, sheet) => sum + (sheet.placedCount || 0), 0)} pieces | ${selectedSheets.length} sheets`
        )
      };

      if (exportPicker.format === 'dxf') {
        await diecutExportService.exportDxf(exportPayload);
      } else {
        await diecutExportService.exportPdf(exportPayload);
      }

      closeExportPicker();
    } catch (err) {
      console.error(`[DieCut] export nesting ${exportPicker.format} error:`, err);
      window.alert(err.message || `Không thể xuất file ${exportPicker.format === 'dxf' ? 'DXF' : 'PDF'}.`);
      setExportPicker((current) => ({ ...current, isSubmitting: false }));
    }
  };

  const handleExportNestingPdf = async () => {
    openExportPicker('pdf');
  };

  const handleExportNestingDxf = async () => {
    openExportPicker('dxf');
  };

  const handleExportTestPdf = async ({ selectedSizeName, selectedSheet, selectedSummary } = {}) => {
    if (!selectedSheet?.placed?.length) return;
    try {
      await diecutExportService.exportPdf({
        sheets: [selectedSheet],
        sheetWidth: selectedSheet.sheetWidth || config.sheetWidth,
        sheetHeight: selectedSheet.sheetHeight || config.sheetHeight,
        sizeList: selectedSizeName ? [{ sizeName: selectedSizeName }] : shapes,
        fileNameBase: buildExportFileBase({
          orderNames: exportOrderNames,
          mode: 'capacity',
          selectedSizeName
        }),
        title: selectedSizeName ? `Capacity Test - Size ${selectedSizeName}` : 'Capacity Test Result',
        subtitle: buildExportSubtitle(
          config,
          `${selectedSummary?.totalPieces || selectedSheet.placed.length} pieces`
        )
      });
    } catch (err) {
      console.error('[DieCut] export test pdf error:', err);
      window.alert(err.message || 'Không thể xuất file PDF.');
    }
  };

  const handleExportTestDxf = async ({ selectedSizeName, selectedSheet, selectedSummary } = {}) => {
    if (!selectedSheet?.placed?.length) return;
    try {
      await diecutExportService.exportDxf({
        sheets: [selectedSheet],
        sheetWidth: selectedSheet.sheetWidth || config.sheetWidth,
        sheetHeight: selectedSheet.sheetHeight || config.sheetHeight,
        sizeList: selectedSizeName ? [{ sizeName: selectedSizeName }] : shapes,
        fileNameBase: buildExportFileBase({
          orderNames: exportOrderNames,
          mode: 'capacity',
          selectedSizeName
        }),
        title: selectedSizeName ? `Capacity Test - Size ${selectedSizeName}` : 'Capacity Test Result',
        subtitle: buildExportSubtitle(
          config,
          `${selectedSummary?.totalPieces || selectedSheet.placed.length} pieces`
        )
      });
    } catch (err) {
      console.error('[DieCut] export test dxf error:', err);
      window.alert(err.message || 'Không thể xuất file DXF.');
    }
  };

  // ─── Handler: Chạy Nesting thường ───
  const handleRunNesting = async () => {
    if (sizeList.length === 0) return;
    const hasQty = sizeList.some(s => s.quantity > 0);
    if (!hasQty) {
      setNestError('Chưa nhập số lượng. Hãy import Excel hoặc nhập thủ công.');
      return;
    }

    setIsNesting(true);
    setNestError(null);

    try {
      const payload = { sizeList, ...config };
      const res = await fetch('/api/diecut/nest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi server');
      startTransition(() => {
        setNestingResult(data);
        setActiveStep(4);
      });
    } catch (err) {
      setNestError(err.message);
    } finally {
      setIsNesting(false);
    }
  };

  // ─── Handler: Chạy Test Capacity ───
  const handleRunTest = async () => {
    if (shapes.length === 0) return;

    setIsTestRunning(true);
    setTestError(null);
    setTestResult(null);

    try {
      // Chỉ gửi shapes (polygon) + config, không cần quantity
      const payload = { sizeList: shapes, ...config };
      const res = await fetch('/api/diecut/test-capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi server');
      startTransition(() => {
        setTestResult(data);
        setActiveStep(4);
      });
    } catch (err) {
      setTestError(err.message);
    } finally {
      setIsTestRunning(false);
    }
  };

  const handleQuantityManualChange = (sizeName, value) => {
    // Cho phép nhập rỗng
    const valStr = value.replace(/[^0-9]/g, '');
    const qty = parseInt(valStr) || 0;

    setQuantities(prev => {
      // Tìm xem size này đã có trong list quantities chưa
      const existingIdx = prev.findIndex(q => q.sizeName === sizeName);
      if (existingIdx >= 0) {
        const nextReq = [...prev];
        nextReq[existingIdx] = {
          ...nextReq[existingIdx],
          _rawInput: valStr,
          pairQuantity: qty,
          pieceQuantity: qty * 2
        };
        return nextReq;
      } else {
        // Chưa có thì push vào
        return [...prev, {
          sizeName,
          _rawInput: valStr,
          pairQuantity: qty,
          pieceQuantity: qty * 2
        }];
      }
    });
  };

  // ─── RENDER ───────────────────────────────────
  return (
    <div className="min-h-screen py-2 px-2 md:px-4">
      <div className="max-w-[1600px] mx-auto">

        {/* Page Header */}
        <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center text-base">✂️</div>
            <div>
              <h1 className="text-white text-lg font-bold">Nesting Hàng Die-Cut</h1>
              <p className="text-white/50 text-[11px]">Sắp xếp biên dạng thực tế (True Shape) cho miếng lót giày</p>
            </div>
          </div>

          {/* Toggle Test Mode */}
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-xs">Chế độ:</span>
            <button
              onClick={() => {
                setIsTestMode(false);
                setTestError(null);
                if (activeStep === 4 && testResult) setActiveStep(3);
              }}
              className={`px-3 py-1 rounded-l-lg text-xs font-medium border transition-all ${
                !isTestMode
                  ? 'bg-purple-500 text-white border-purple-400'
                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
              }`}
            >
              🏭 Nesting
            </button>
            <button
              onClick={() => {
                setIsTestMode(true);
                setNestError(null);
                // Nếu đang ở bước 2 (Excel) và chuyển sang test mode → skip lên bước 3
                if (activeStep === 2) setActiveStep(3);
              }}
              className={`px-3 py-1 rounded-r-lg text-xs font-medium border transition-all ${
                isTestMode
                  ? 'bg-amber-500 text-white border-amber-400'
                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
              }`}
            >
              🧪 Test Capacity
            </button>
          </div>
        </div>

        {/* Test Mode Banner — ẩn khi đang xem kết quả */}
        {isTestMode && activeStep !== 4 && (
          <div className="mb-2 bg-amber-500/10 border border-amber-400/30 rounded-lg px-2 py-1 flex items-center gap-2">
            <span className="text-sm">🧪</span>
            <span className="text-amber-300 text-[11px] font-medium">Test Capacity</span>
            <span className="text-white/50 text-[10px]">— Tính số lượng tối đa / tấm PU. Bỏ qua bước nhập số lượng.</span>
          </div>
        )}

        {importAnalysis?.recommendation && activeStep !== 4 && (
          <div
            className={`mb-2 rounded-lg px-2 py-1 flex items-start gap-2 border ${
              usingRecommendedMode
                ? 'bg-emerald-500/10 border-emerald-400/30'
                : 'bg-amber-500/10 border-amber-400/30'
            }`}
          >
            <span className="text-sm">{usingRecommendedMode ? '👫' : '⚠️'}</span>
            <div>
              <div className={usingRecommendedMode ? 'text-emerald-300 text-[11px] font-medium' : 'text-amber-300 text-[11px] font-medium'}>
                {usingRecommendedMode
                  ? `Đã tự động chọn mode ${importAnalysis.recommendation.modeLabel}`
                  : `File này đang có khuyến nghị dùng mode ${importAnalysis.recommendation.modeLabel}`}
              </div>
              <div className="text-white/50 text-[10px]">
                {importAnalysis.recommendation.reason}
              </div>
            </div>
          </div>
        )}

        {/* Step tabs */}
        <div className="flex gap-1 mb-2 flex-wrap">
          {(isTestMode
            ? [
                { n: 1, label: '1. Biên dạng DXF' },
                { n: 3, label: '2. Cấu hình & Test' },
                { n: 4, label: '3. Kết quả' }
              ]
            : [
                { n: 1, label: '1. Biên dạng DXF' },
                { n: 2, label: '2. Số lượng Excel' },
                { n: 3, label: '3. Cấu hình & Chạy' },
                { n: 4, label: '4. Kết quả' }
              ]
          ).map(step => (
            <button
              key={step.n}
              onClick={() => setActiveStep(step.n)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeStep === step.n
                  ? isTestMode
                    ? 'bg-amber-500/30 text-amber-200 border border-amber-400/40'
                    : 'bg-white/20 text-white border border-white/30'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
              }`}
            >
              {step.label}
            </button>
          ))}
        </div>

        {/* ── STEP 1: DXF ── */}
        {activeStep === 1 && (
          <div className="space-y-4">
            {/* Uploader - full width */}
            <DieCutDxfUploader
              onShapesLoaded={({ shapes: nextShapes, importAnalysis: nextImportAnalysis }) => {
                setShapes(nextShapes);
                setImportAnalysis(nextImportAnalysis || null);
                setConfig((currentConfig) => applyRecommendedMode(currentConfig, nextImportAnalysis));
              }}
              initialShapes={shapes.length > 0 ? shapes : null}
              initialImportAnalysis={importAnalysis}
            />

            {/* Nút Next - chỉ hiện sau khi tải xong */}
            {shapes.length > 0 && (
              <div className="flex justify-end gap-3">
                {/* Trong test mode, bỏ qua bước 2 */}
                {isTestMode ? (
                  <button
                    onClick={() => setActiveStep(3)}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg"
                  >
                    Tiếp theo: Cấu hình Test →
                  </button>
                ) : (
                  <button
                    onClick={() => setActiveStep(2)}
                    className="px-6 py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg"
                  >
                    Tiếp theo: Nhập số lượng →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: EXCEL (chỉ hiện khi không test mode) ── */}
        {activeStep === 2 && !isTestMode && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <DieCutExcelUploader onQuantitiesLoaded={setQuantities} />

            {/* Nhập số lượng thủ công nếu không có Excel */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 space-y-3 h-full">
              <h3 className="text-white font-semibold text-sm">✏️ Hoặc nhập thủ công</h3>
              {shapes.length === 0 ? (
                <p className="text-white/40 text-sm">Hãy import DXF trước (Bước 1)</p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto space-y-1">
                  {shapes.map((s, i) => {
                    const merged = sizeList.find(sl => sl.sizeName === s.sizeName);
                    return (
                      <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                        <span className="text-white font-medium text-sm w-16">Size {s.sizeName}</span>
                        <input
                          type="text"
                          value={merged?._rawInput !== undefined ? merged._rawInput : (merged?.pairQuantity || 0)}
                          onChange={e => handleQuantityManualChange(s.sizeName, e.target.value)}
                          className="w-20 bg-white/10 border border-white/20 text-white rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:border-purple-400"
                        />
                        <span className="text-white/50 text-xs">đôi</span>
                        <span className="text-emerald-300 text-xs ml-auto">= {merged?.pieceQuantity || 0} chiếc</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="pt-1 border-t border-white/10 flex justify-between text-sm">
                <span className="text-white/50">Tổng cộng:</span>
                <span className="text-white font-medium">{totalPieces} chiếc lót</span>
              </div>
              <button
                onClick={() => setActiveStep(3)}
                disabled={totalPieces === 0}
                className="w-full py-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                Tiếp theo: Cấu hình →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: CONFIG + RUN ── */}
        {activeStep === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* CỘT TRÁI: Cấu hình và Tóm tắt */}
            <div className="flex flex-col gap-2">
              <SheetConfigPanel
                config={config}
                onChange={setConfig}
                isTestMode={isTestMode}
                importAnalysis={importAnalysis}
              />

              <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-3 space-y-2">
                <h3 className="text-white font-semibold text-sm">📋 Tóm tắt trước khi chạy</h3>
                {/* Thu hẹp padding và gap để gọn màn hình */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                  <div className="text-white/50 text-xs mb-0.5">Loại biên dạng</div>
                  <div className="text-white font-medium text-sm">{shapes.length} size</div>
                </div>
                <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                  <div className="text-white/50 text-xs mb-0.5">{isTestMode ? 'Chế độ' : 'Tổng đơn / trên sơ đồ'}</div>
                  <div className={`font-medium text-sm ${isTestMode ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {isTestMode ? '🧪 Test Max' : `${totalPieces} / ${effectiveTotalPieces} chiếc`}
                  </div>
                  {!isTestMode && (
                    <div className="text-[10px] text-white/35 mt-1">
                      {config.layers > 1 ? `${config.layers} lớp cắt` : '1 lớp cắt'}
                    </div>
                  )}
                </div>
                <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                  <div className="text-white/50 text-xs mb-0.5">Kích thước tấm PU</div>
                  <div className="text-white font-medium text-sm">{config.sheetWidth}×{config.sheetHeight} mm</div>
                </div>
                <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                  <div className="text-white/50 text-xs mb-0.5">Cấu hình nesting</div>
                  <div className="text-white font-medium text-sm">
                    {config.spacing}mm / sole {config.staggerSpacing ?? config.spacing}mm {(config.allowRotate90 ? <span className="text-green-400">(90° On)</span> : <span className="text-white/40">(90° Off)</span>)}
                  </div>
                  <div className="text-[10px] text-white/35 mt-1">
                    {getCapacityModeLabel(config)}
                    {!isTestMode ? ` · ${getNestingStrategyLabel(config.nestingStrategy)}` : ''}
                  </div>
                </div>
              </div>

              {/* Error messages */}
              {nestError && (
                <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 text-red-200 text-sm">
                  {nestError}
                </div>
              )}
              {testError && (
                <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 text-red-200 text-sm">
                  {testError}
                </div>
              )}

              {/* Nút chạy: hiển thị theo mode */}
              {isTestMode ? (
                <>
                  <button
                    onClick={handleRunTest}
                    disabled={isTestRunning || !hasData}
                    className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed
                      text-white font-semibold rounded-xl transition-all shadow-lg text-sm flex items-center justify-center gap-3 mt-2"
                  >
                    {isTestRunning ? (
                      <>
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
                          <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Đang tính số lượng tối đa...
                      </>
                    ) : '🧪 Test: Tính số lượng tối đa / tấm PU'}
                  </button>
                  <p className="text-amber-300/50 text-xs text-center">
                    Test sẽ xếp tối đa có thể lên 1 tấm PU — không cần nhập số lượng đơn hàng
                  </p>
                </>
              ) : (
                <>
                  <button
                    onClick={handleRunNesting}
                    disabled={isNesting || totalPieces === 0 || !hasData}
                    className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-40 disabled:cursor-not-allowed
                      text-white font-semibold rounded-xl transition-all shadow-lg text-sm flex items-center justify-center gap-3 mt-2"
                  >
                    {isNesting ? (
                      <>
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
                          <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Đang tính toán True Shape Nesting...
                      </>
                    ) : '✂️ Chạy Nesting True Shape'}
                  </button>
                  <p className="text-white/30 text-xs text-center">
                    Thuật toán True Shape Nesting – lồng biên dạng thực, tối ưu diện tích tối đa
                  </p>
                </>
              )}
            </div>
          </div>

            {/* CỘT PHẢI: Mô phỏng PU (trải dài hết chiều cao) */}
            <SheetVisualizerPanel config={config} />
          </div>
        )}

        {/* ── STEP 4: RESULT ── */}
        {activeStep === 4 && (
          <div className="space-y-4">
            {/* Test Mode Result */}
            {isTestMode && testResult ? (
              <TestCapacityResult
                result={testResult}
                config={config}
                onExportPdf={handleExportTestPdf}
                onExportDxf={handleExportTestDxf}
                onClose={() => { setActiveStep(3); }}
              />
            ) : (
              /* Normal Nesting Result */
              <>
                <NormalNestingResult
                  nestingResult={nestingResult}
                  sizeList={sizeList}
                  config={config}
                  sizeSummary={nestingResultSizeSummary}
                  activeSizeSummary={activeNestingResultSizeSummary}
                  emptySizeSummary={emptyNestingResultSizeSummary}
                  showEmptySizeRows={showEmptySizeRows}
                  setShowEmptySizeRows={setShowEmptySizeRows}
                  onExportPdf={handleExportNestingPdf}
                  onExportDxf={handleExportNestingDxf}
                  onResultChange={setNestingResult}
                  onClose={() => { setActiveStep(3); setNestingResult(null); }}
                />
                {false && (
                  <>
                {nestingResultSizeSummary.length > 0 && (
                  <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 bg-white/5">
                      <div className="text-white font-semibold text-sm">Số lượng theo từng size</div>
                      <div className="text-white/45 text-xs mt-1">
                        Hiển thị đơn gốc, số đôi sau khi chia layers và số lượng đã xếp thực tế.
                      </div>
                    </div>
                    <div className="max-h-[320px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-black/20">
                          <tr>
                            <th className="text-left text-white/50 font-medium px-4 py-2">Size</th>
                            <th className="text-center text-white/50 font-medium px-3 py-2">Gốc (đôi)</th>
                            <th className="text-center text-white/50 font-medium px-3 py-2">Sau chia (đôi)</th>
                            <th className="text-center text-white/50 font-medium px-3 py-2">Đã xếp (đôi)</th>
                            <th className="text-center text-white/50 font-medium px-3 py-2">Đã xếp (chiếc)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeNestingResultSizeSummary.map((item) => (
                            <tr key={item.sizeName} className="border-t border-white/5">
                              <td className="px-4 py-2 text-white font-medium">{item.sizeName}</td>
                              <td className="px-3 py-2 text-center text-white/75">{item.originalPairs}</td>
                              <td className="px-3 py-2 text-center text-cyan-200">{item.plannedPairs}</td>
                              <td className="px-3 py-2 text-center text-emerald-300">{item.placedPairs}</td>
                              <td className="px-3 py-2 text-center text-amber-300">{item.placedPieces}</td>
                            </tr>
                          ))}
                          {showEmptySizeRows && emptyNestingResultSizeSummary.map((item) => (
                            <tr key={item.sizeName} className="border-t border-white/5 bg-white/[0.03]">
                              <td className="px-4 py-2 text-white/50 font-medium">{item.sizeName}</td>
                              <td className="px-3 py-2 text-center text-white/35">0</td>
                              <td className="px-3 py-2 text-center text-white/35">0</td>
                              <td className="px-3 py-2 text-center text-white/35">0</td>
                              <td className="px-3 py-2 text-center text-white/35">0</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {emptyNestingResultSizeSummary.length > 0 && (
                      <button
                        onClick={() => setShowEmptySizeRows((current) => !current)}
                        className="w-full px-4 py-2 border-t border-white/10 text-left text-xs text-white/55 hover:text-white/80 hover:bg-white/5 transition-colors"
                      >
                        {showEmptySizeRows
                          ? `Ẩn ${emptyNestingResultSizeSummary.length} size chưa có dữ liệu`
                          : `Xem thêm ${emptyNestingResultSizeSummary.length} size chưa có dữ liệu`}
                      </button>
                    )}
                  </div>
                )}
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
                  <div>
                    <h2 className="text-white font-semibold">Kết quả Nesting</h2>
                    <div className="text-white/45 text-xs mt-1">
                      {getNestingStrategyLabel(nestingResult?.nestingStrategy || config.nestingStrategy)}
                      {' · '}
                      {(nestingResult?.layers || config.layers || 1)} lớp
                      {nestingResult?.planningSummary?.plannedPieces
                        ? ` · Sơ đồ ${nestingResult.planningSummary.plannedPieces} chiếc`
                        : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleExportNestingPdf}
                      disabled={!nestingResult?.sheets?.length}
                      className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 rounded-lg text-sm transition-colors border border-emerald-400/20"
                    >
                      Export PDF
                    </button>
                    <button
                      onClick={handleExportNestingDxf}
                      disabled={!nestingResult?.sheets?.length}
                      className="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sky-200 rounded-lg text-sm transition-colors border border-sky-400/20"
                    >
                      Export DXF
                    </button>
                    <button
                      onClick={() => { setActiveStep(3); setNestingResult(null); }}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-sm transition-colors"
                    >
                      ← Chạy lại
                    </button>
                  </div>
                </div>
                <DieCutNestingBoard
                  nestingResult={nestingResult}
                  sizeList={sizeList}
                  compactMode
                  allowEdit
                  editConfig={config}
                  onResultChange={setNestingResult}
                />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <ExportSheetPickerModal
        isOpen={exportPicker.isOpen}
        format={exportPicker.format}
        sheets={nestingResult?.sheets || []}
        selectedSheetIndexes={exportPicker.selectedSheetIndexes}
        isSubmitting={exportPicker.isSubmitting}
        onClose={closeExportPicker}
        onToggleSheet={toggleExportSheetIndex}
        onSelectAll={selectAllExportSheets}
        onClearAll={clearAllExportSheets}
        onConfirm={handleConfirmExportSheets}
      />
    </div>
  );
};

export default DieCutLayout;
