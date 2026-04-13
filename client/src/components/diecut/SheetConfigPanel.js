import React from 'react';
import DieCutNestingStrategySelector from './DieCutNestingStrategySelector.js';
import {
  buildPairConfig,
  buildSameSideConfig,
  getDisplayAutoLayout,
  getDisplayFileType,
  isUsingRecommendedMode
} from './DieCutUtils.js';

const SheetConfigPanel = ({ config, onChange, isTestMode, importAnalysis }) => {
  const recommendation = importAnalysis?.recommendation;
  const usingRecommendedMode = isUsingRecommendedMode(config, importAnalysis);
  const autoApplyRecommendation = recommendation?.autoApply === true;

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-3 space-y-2">
      <h3 className="text-white font-semibold text-base flex items-center gap-2">
        <span className="text-xl">⚙️</span> Cấu hình Tấm PU
      </h3>

      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-2">
          <label className="text-white/60 text-xs font-medium flex items-center gap-1.5">
            <span className="text-blue-400">📐</span> Kích thước mặt cắt PU (mm)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={config.sheetWidth}
              onChange={(e) => onChange({ ...config, sheetWidth: Number(e.target.value) })}
              className="w-full bg-black/20 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Rộng (X)"
            />
            <span className="text-white/30 text-xs">×</span>
            <input
              type="number"
              value={config.sheetHeight}
              onChange={(e) => onChange({ ...config, sheetHeight: Number(e.target.value) })}
              className="w-full bg-black/20 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Cao (Y)"
            />
          </div>
        </div>

        <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-2">
          <label className="text-white/60 text-xs font-medium flex items-center gap-1.5">
            <span className="text-green-400">📏</span> Lề & Khoảng cách
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <div className="bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/75 text-[11px] font-semibold flex-1 leading-snug">Lề ngang</span>
                <input
                  type="number"
                  value={config.marginX}
                  onChange={(e) => onChange({ ...config, marginX: Number(e.target.value) })}
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
                  onChange={(e) => onChange({ ...config, marginY: Number(e.target.value) })}
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
                  onChange={(e) => onChange({ ...config, spacing: Number(e.target.value) })}
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
                  onChange={(e) => onChange({ ...config, staggerSpacing: Number(e.target.value) })}
                  className="w-12 md:w-14 bg-transparent text-white text-sm text-right focus:outline-none shrink-0"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <div className="grid grid-cols-1 md:[grid-template-columns:minmax(140px,0.62fr)_minmax(0,1.78fr)] gap-2">
          <div className="bg-black/20 rounded-lg border border-white/10 px-3 py-2">
            <div className="text-white/45 text-[11px] uppercase tracking-wide">Loại file</div>
            <div className="text-white text-sm font-semibold mt-1">{getDisplayFileType(importAnalysis)}</div>
          </div>

          {autoApplyRecommendation ? (
            <div className="bg-black/20 rounded-lg border border-white/10 px-3 py-2">
              <div className="text-white/45 text-[11px] uppercase tracking-wide">Layout tự động</div>
              <div className="text-white text-sm font-semibold mt-1">
                {getDisplayAutoLayout(config, importAnalysis)}
              </div>
            </div>
          ) : (
            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <div className="flex items-center justify-between gap-3 flex-wrap xl:flex-nowrap">
                <div className="shrink-0">
                  <div className="text-white/60 text-xs font-medium">Chiến lược sắp</div>
                </div>
                <div className="flex w-full xl:w-auto bg-black/40 p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => onChange(buildPairConfig(config))}
                    className={`flex-1 xl:flex-none flex items-center justify-center px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      config.pairingStrategy !== 'same-side'
                        ? 'bg-purple-500 text-white shadow-lg'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    Ghép Cặp (Trái-Phải)
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(buildSameSideConfig(config, importAnalysis))}
                    className={`flex-1 xl:flex-none flex items-center justify-center px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      config.pairingStrategy === 'same-side'
                        ? 'bg-amber-500 text-white shadow-lg'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    Ghép Chiếc (Cùng bên)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={config.allowRotate90}
              onChange={(e) => onChange({ ...config, allowRotate90: e.target.checked })}
              className="w-4 h-4 rounded border-white/20 bg-black/20 text-purple-500 focus:ring-purple-500/50"
            />
            <span className="text-white/80 text-sm group-hover:text-white transition-colors">
              Cho phép xoay 90° để lấp phần trống
            </span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-white/60 text-xs font-medium">Độ phân giải (mm):</span>
            <select
              value={config.gridStep}
              onChange={(e) => onChange({ ...config, gridStep: Number(e.target.value) })}
              className="bg-black/40 border border-white/10 text-white text-xs rounded px-2 py-1 focus:outline-none"
            >
              <option value={0.5}>0.5 mm (Rất chính xác)</option>
              <option value={1.0}>1.0 mm (Chính xác)</option>
              <option value={1.5}>1.5 mm (Cân bằng)</option>
              <option value={2.0}>2.0 mm (Nhanh)</option>
            </select>
          </div>
        </div>

        {autoApplyRecommendation && recommendation && (
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
            <div className="text-white/70 mt-1">{recommendation.reason}</div>
          </div>
        )}

        {!autoApplyRecommendation && (
          <div className="rounded-xl border px-3 py-2 text-xs bg-sky-500/10 border-sky-400/20 text-sky-100">
            File thường sẽ cho chọn ghép cặp hoặc ghép chiếc như trước; chỉ file ghép sẵn mới tự động.
          </div>
        )}

        {!isTestMode && (
          <DieCutNestingStrategySelector value={config} onChange={onChange} />
        )}
      </div>
    </div>
  );
};

export default SheetConfigPanel;
