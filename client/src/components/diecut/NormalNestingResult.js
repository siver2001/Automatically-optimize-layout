import React from 'react';
import DieCutNestingBoard from './DieCutNestingBoard.js';
import { getNestingStrategyLabel } from './DieCutUtils.js';

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
          <div>
            <h2 className="text-white font-bold text-sm leading-tight flex items-center gap-2">
              Kết quả Nesting
              <span className="text-fuchsia-300 font-medium px-2 py-0 rounded-md bg-fuchsia-400/10 border border-fuchsia-400/20 text-[10px]">
                {getNestingStrategyLabel(nestingResult?.nestingStrategy || config.nestingStrategy)}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-white/40 text-[10px] mt-0.5 flex-wrap">
              <span className="flex items-center gap-1"><span className="text-blue-400">📐</span> {config.sheetWidth}×{config.sheetHeight} mm</span>
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
              <div className="text-[0.8rem] font-black text-fuchsia-200 leading-none">{totalSheets}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Tấm</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[0.8rem] font-black text-emerald-300 leading-none">{totalPairs}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Đôi</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[0.8rem] font-black text-amber-300 leading-none">{totalPieces}</div>
              <div className="text-white/60 text-[10px] uppercase font-semibold mt-1">Chiếc</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 text-center">
              <div className="text-[0.8rem] font-black text-blue-300 leading-none">{nestingResult?.efficiency || 0}%</div>
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
                    <th className="text-white/50 font-medium text-center py-1.5 px-1">Đã xếp cặp</th>
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
                onClick={() => setShowEmptySizeRows(!showEmptySizeRows)}
                className="py-1 text-[10px] text-white/40 hover:text-white/60 bg-white/5 border-t border-white/10"
              >
                {showEmptySizeRows ? 'Ẩn các size trống' : `Xem thêm ${emptySizeSummary.length} size không có dữ liệu`}
              </button>
            )}
          </div>
        </div>

        <div className="min-w-0 h-full min-h-[50vh] xl:min-h-[78vh] overflow-hidden">
          <DieCutNestingBoard
            nestingResult={nestingResult}
            sizeList={sizeList}
            compactMode
            onResultChange={onResultChange}
          />
        </div>
      </div>
    </div>
  );
};

export default NormalNestingResult;
