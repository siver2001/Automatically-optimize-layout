import React, { useState, useMemo, useEffect } from 'react';
import DieCutNestingBoard from './DieCutNestingBoard.js';

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
  // eslint-disable-next-line no-unused-vars
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
              <span className="flex items-center gap-1"><span className="text-blue-400">📐</span> {config.sheetWidth}×{config.sheetHeight} mm</span>
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

        {/* CỘT TRÁI: Stats + Bảng size (Scrollable nếu dài) */}
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

        {/* CỘT PHẢI: Bố cục SVG tấm PU (tự fit màn hình) */}
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

export default TestCapacityResult;
