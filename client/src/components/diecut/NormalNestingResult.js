import React from "react";
import DieCutNestingBoard from "./DieCutNestingBoard.js";
import { getNestingStrategyLabel } from "./DieCutUtils.js";

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
  onExportCyc,
  showCycExport = false,
  onResultChange,
  onClose,
}) => {
  const totalPairs = Math.floor((nestingResult?.placedCount || 0) / 2);
  const totalPieces = nestingResult?.placedCount || 0;
  const totalSheets =
    nestingResult?.totalSheets || nestingResult?.sheets?.length || 0;
  const totalTimeSeconds = ((nestingResult?.timeMs || 0) / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-2 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-2 shadow-lg">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold leading-tight text-white">
              Kết quả Nesting
              <span className="rounded-md border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-0 text-[10px] font-medium text-fuchsia-300">
                {getNestingStrategyLabel(
                  nestingResult?.nestingStrategy || config.nestingStrategy,
                )}
              </span>
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-white/40">
              <span className="flex items-center gap-1">
                <span className="text-blue-400">△</span>
                {config.sheetWidth}×{config.sheetHeight} mm
              </span>
              <span className="h-0.5 w-0.5 rounded-full bg-white/20" />
              <span>{nestingResult?.layers || config.layers || 1} lớp</span>
              <span className="h-0.5 w-0.5 rounded-full bg-white/20" />
              <span className="flex items-center gap-1">
                <span className="text-purple-400">⏱</span>
                {totalTimeSeconds}s
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onExportPdf}
            disabled={!nestingResult?.sheets?.length}
            className="rounded-lg border border-emerald-400/20 bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-200 transition-all hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export PDF
          </button>
          <button
            onClick={onExportDxf}
            disabled={!nestingResult?.sheets?.length}
            className="rounded-lg border border-sky-400/20 bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-200 transition-all hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export DXF
          </button>
          {showCycExport ? (
            <button
              onClick={onExportCyc}
              disabled={!nestingResult?.sheets?.length}
              className="rounded-lg border border-amber-400/20 bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-200 transition-all hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export CYC
            </button>
          ) : null}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-white transition-all hover:bg-white/20"
          >
            <span>←</span> Chạy lại
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[280px_1fr]">
        <div className="custom-scrollbar flex max-h-[78vh] flex-col gap-2 overflow-y-auto pr-1">
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded-lg border border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-500/20 to-pink-500/20 p-2 text-center">
              <div className="text-[0.8rem] leading-none font-black text-fuchsia-200">
                {totalSheets}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase text-white/60">
                Tấm
              </div>
            </div>
            <div className="rounded-lg border border-white/20 bg-white/10 p-2 text-center">
              <div className="text-[0.8rem] leading-none font-black text-emerald-300">
                {totalPairs}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase text-white/60">
                Đôi
              </div>
            </div>
            <div className="rounded-lg border border-white/20 bg-white/10 p-2 text-center">
              <div className="text-[0.8rem] leading-none font-black text-amber-300">
                {totalPieces}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase text-white/60">
                Chiếc
              </div>
            </div>
            <div className="rounded-lg border border-white/20 bg-white/10 p-2 text-center">
              <div className="text-[0.8rem] leading-none font-black text-blue-300">
                {nestingResult?.efficiency || 0}%
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase text-white/60">
                Hiệu suất
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/20 bg-white/10 shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white">
                Thống kê size
              </span>
              <span className="ml-auto rounded border border-fuchsia-400/20 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-bold text-fuchsia-200">
                {activeSizeSummary.length} size có dữ liệu
              </span>
            </div>
            <div className="custom-scrollbar flex-1 overflow-y-auto bg-black/20">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-white/10 bg-gray-900">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-white/50">
                      Size
                    </th>
                    <th className="px-1 py-1.5 text-center font-medium text-white/50">
                      Đã xếp cặp
                    </th>
                    <th className="px-1 py-1.5 text-center font-medium text-white/50">
                      Đã xếp chiếc
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeSizeSummary.map((item) => (
                    <tr
                      key={item.sizeName}
                      className="border-b border-white/5 hover:bg-white/5"
                    >
                      <td className="px-2 py-1.5 font-medium text-white/80">
                        {item.sizeName}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <span className="text-emerald-300/90">
                          {item.placedPairs}
                        </span>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <span className="text-amber-300/90">
                          {item.placedPieces}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {showEmptySizeRows &&
                    emptySizeSummary.map((item) => (
                      <tr
                        key={item.sizeName}
                        className="border-b border-white/5 bg-white/[0.03]"
                      >
                        <td className="px-2 py-1.5 font-medium text-white/45">
                          {item.sizeName}
                        </td>
                        <td className="px-1 py-1.5 text-center text-white/30">
                          0
                        </td>
                        <td className="px-1 py-1.5 text-center text-white/30">
                          0
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {emptySizeSummary.length > 0 && (
              <button
                onClick={() => setShowEmptySizeRows(!showEmptySizeRows)}
                className="border-t border-white/10 bg-white/5 py-1 text-[10px] text-white/40 hover:text-white/60"
              >
                {showEmptySizeRows
                  ? "Ẩn các size trống"
                  : `Xem thêm ${emptySizeSummary.length} size không có dữ liệu`}
              </button>
            )}
          </div>
        </div>

        <div className="min-w-0 min-h-[50vh] h-full overflow-hidden xl:min-h-[78vh]">
          <DieCutNestingBoard
            nestingResult={nestingResult}
            sizeList={sizeList}
            compactMode
            allowEdit={typeof onResultChange === "function"}
            onResultChange={onResultChange}
          />
        </div>
      </div>
    </div>
  );
};

export default NormalNestingResult;
