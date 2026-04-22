/**
 * DieCutLayout.js - Main Page for Die-Cut Nesting
 * Refactored for better readability and maintainability.
 */
import React, { startTransition, useState, useMemo, useEffect } from 'react';

// Core Sub-components
import DieCutDxfUploader from './DieCutDxfUploader.js';
import DieCutExcelUploader from './DieCutExcelUploader.js';

// Extracted Sub-components
import SheetConfigPanel from './SheetConfigPanel.js';
import SheetVisualizerPanel from './SheetVisualizerPanel.js';
import TestCapacityResult from './TestCapacityResult.js';
import NormalNestingResult from './NormalNestingResult.js';
import ExportSheetPickerModal from './ExportSheetPickerModal.js';

// Services & Utilities
import { diecutExportService } from '../../services/diecutExportService.js';
import { 
  PAIR_CAPACITY_MODE,
  applyRecommendedMode,
  mergeShapesAndQuantities,
  buildExportFileBase,
  getCapacityModeLabel
} from './DieCutUtils.js';

const DieCutLayout = () => {
  // --- UTILS ---
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

  // --- STATE ---
  const [shapes, setShapes] = useState([]); // from DXF
  const [importAnalysis, setImportAnalysis] = useState(null);
  const [quantities, setQuantities] = useState([]); // from Excel
  const [nestingResult, setNestingResult] = useState(null);
  const [isNesting, setIsNesting] = useState(false);
  const [nestError, setNestError] = useState(null);
  const [activeStep, setActiveStep] = useState(1); // 1=DXF, 2=Excel, 3=Config, 4=Result
  const [isTestMode, setIsTestMode] = useState(false); // Test Capacity Mode
  const [testResult, setTestResult] = useState(null); // Test Result
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testError, setTestError] = useState(null);
  const [showEmptySizeRows, setShowEmptySizeRows] = useState(false);
  
  const [exportPicker, setExportPicker] = useState({
    isOpen: false,
    format: 'pdf',
    source: 'nesting',
    items: [],
    selectedSheetIndexes: [],
    isSubmitting: false
  });

  const [config, setConfig] = useState({
    sheetWidth: 1100,
    sheetHeight: 2000,
    spacing: 3,
    staggerSpacing: 3,
    marginX: 5,
    marginY: 5,
    allowRotate90: true,
    mirrorPairs: true,
    pairingStrategy: 'pair',
    gridStep: 0.5,
    capacityLayoutMode: PAIR_CAPACITY_MODE,
    layers: 1,
    nestingStrategy: 'single-size-per-sheet'
  });

  // --- COMPUTED ---
  const sizeList = useMemo(() => {
    if (shapes.length === 0) return [];
    if (quantities.length === 0) {
      return shapes.map(s => ({ ...s, quantity: 0, pairQuantity: 0, pieceQuantity: 0 }));
    }
    return mergeShapesAndQuantities(shapes, quantities);
  }, [shapes, quantities]);

  const totalPieces = sizeList.reduce((s, item) => s + (item.quantity || 0) * 2, 0);

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
        placedBySize[key] = (placedBySize[key] || 0) + (item.pieceCount || 1);
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



  // --- EFFECTS ---
  useEffect(() => {
    setShowEmptySizeRows(false);
  }, [nestingResult]);

  useEffect(() => {
    setExportPicker((current) => ({
      ...current,
      isOpen: false,
      isSubmitting: false,
      items: [],
      selectedSheetIndexes: []
    }));
  }, [nestingResult?.resultId, nestingResult?.totalSheets, testResult]);

  // --- HANDLERS: EXPORT PICKER ---
  const openExportPicker = (format, source, items) => {
    const sheetIndexes = (items || []).map((_, index) => index);
    if (!sheetIndexes.length) return;
    setExportPicker({
      isOpen: true,
      format,
      source,
      items,
      selectedSheetIndexes: sheetIndexes,
      isSubmitting: false
    });
  };

  const closeExportPicker = () => {
    setExportPicker((current) => ({ ...current, isOpen: false, isSubmitting: false }));
  };

  const toggleExportSheetIndex = (sheetIndex) => {
    setExportPicker((current) => {
      const exists = current.selectedSheetIndexes.includes(sheetIndex);
      return {
        ...current,
        selectedSheetIndexes: exists
          ? current.selectedSheetIndexes.filter((index) => index !== sheetIndex)
          : [...current.selectedSheetIndexes, sheetIndex].sort((l, r) => l - r)
      };
    });
  };

  const selectAllExportSheets = () => {
    setExportPicker((current) => ({
      ...current,
      selectedSheetIndexes: (current.items || []).map((_, index) => index)
    }));
  };

  const clearAllExportSheets = () => {
    setExportPicker((current) => ({ ...current, selectedSheetIndexes: [] }));
  };

  const resolveSelectedNestingSheets = async (selectedSheetIndexes) => {
    const summarySheets = nestingResult?.sheets || [];
    const detailMap = new Map();
    const missingIndexes = selectedSheetIndexes.filter((idx) => !(summarySheets[idx]?.placed?.length));

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

  const buildTestExportItems = () => {
    const summary = testResult?.summary || [];
    const sheetsBySize = testResult?.sheetsBySize || {};
    return summary
      .map((entry) => {
        const sheet = sheetsBySize?.[entry.sizeName];
        const placedCount = sheet?.placedCount ?? entry.totalPieces ?? sheet?.placed?.length ?? 0;
        return {
          label: `Size ${entry.sizeName}`,
          metaLabel: `${entry.pairs ?? Math.floor((entry.totalPieces ?? 0) / 2)} đôi`,
          sizeName: entry.sizeName,
          totalPieces: entry.totalPieces ?? placedCount,
          placedCount,
          efficiency: entry.efficiency ?? sheet?.efficiency ?? 0,
          sheet
        };
      })
      .filter((item) => item.sheet?.placed?.length);
  };

  const handleConfirmExportSheets = async () => {
    const selectedSheetIndexes = [...exportPicker.selectedSheetIndexes].sort((l, r) => l - r);
    if (!selectedSheetIndexes.length || !exportPicker.items?.length) return;

    setExportPicker((current) => ({ ...current, isSubmitting: true }));
    try {
      if (exportPicker.format === 'dxf') {
        if (exportPicker.source === 'test') {
          const selectedItems = selectedSheetIndexes
            .map((idx) => exportPicker.items[idx])
            .filter((item) => item?.sheet?.placed?.length);

          if (!selectedItems.length) throw new Error('KhÃ´ng láº¥y Ä‘Æ°á»£c dá»¯ liá»‡u chi tiáº¿t cá»§a cÃ¡c size Ä‘Ã£ chá»n.');

          for (const item of selectedItems) {
            const activeSizes = item.sizeName ? [{ sizeName: item.sizeName }] : shapes;
            await diecutExportService.exportDxf({
              sheets: [item.sheet],
              sheetWidth: item.sheet?.sheetWidth || config.sheetWidth,
              sheetHeight: item.sheet?.sheetHeight || config.sheetHeight,
              sizeList: activeSizes,
              title: item.sizeName ? `Capacity Test - Size ${item.sizeName}` : 'Capacity Test Result',
              subtitle: buildExportSubtitle(config, `${item.totalPieces ?? item.sheet?.placed?.length ?? 0} pieces | 1 sheet`)
            });
          }
        } else {
          const selectedSheets = await resolveSelectedNestingSheets(selectedSheetIndexes);
          if (!selectedSheets.length) throw new Error('KhÃ´ng láº¥y Ä‘Æ°á»£c dá»¯ liá»‡u chi tiáº¿t cá»§a cÃ¡c táº¥m Ä‘Ã£ chá»n.');

          for (const [index, sheet] of selectedSheets.entries()) {
            await diecutExportService.exportDxf({
              sheets: [sheet],
              sheetWidth: sheet?.sheetWidth || config.sheetWidth,
              sheetHeight: sheet?.sheetHeight || config.sheetHeight,
              sizeList,
              title: `Die-Cut Nesting Result - Sheet ${selectedSheetIndexes[index] + 1}`,
              subtitle: buildExportSubtitle(config, `${sheet?.placedCount || sheet?.placed?.length || 0} pieces | 1 sheet`)
            });
          }
        }

        closeExportPicker();
        return;
      }

      let exportPayload;
      if (exportPicker.source === 'test') {
        const selectedItems = selectedSheetIndexes
          .map((idx) => exportPicker.items[idx])
          .filter((item) => item?.sheet?.placed?.length);
        
        if (!selectedItems.length) throw new Error('Không lấy được dữ liệu chi tiết của các size đã chọn.');

        const selectedSheets = selectedItems.map((item) => item.sheet);
        const activeSizes = selectedItems.map((item) => item.sizeName).filter(Boolean);
        const pieces = selectedItems.reduce((sum, item) => sum + (item.totalPieces ?? item.sheet?.placed?.length ?? 0), 0);

        exportPayload = {
          sheets: selectedSheets,
          sheetWidth: selectedSheets[0]?.sheetWidth || config.sheetWidth,
          sheetHeight: selectedSheets[0]?.sheetHeight || config.sheetHeight,
          sizeList: activeSizes.length ? activeSizes.map((sizeName) => ({ sizeName })) : shapes,
          fileNameBase: buildExportFileBase({ orderNames: exportOrderNames, mode: 'capacity', activeSizes }),
          title: activeSizes.length === 1 ? `Capacity Test - Size ${activeSizes[0]}` : 'Capacity Test Result',
          subtitle: buildExportSubtitle(config, `${pieces} pieces | ${selectedSheets.length} sheets`)
        };
      } else {
        const selectedSheets = await resolveSelectedNestingSheets(selectedSheetIndexes);
        if (!selectedSheets.length) throw new Error('Không lấy được dữ liệu chi tiết của các tấm đã chọn.');

        exportPayload = {
          sheets: selectedSheets,
          sheetWidth: config.sheetWidth,
          sheetHeight: config.sheetHeight,
          sizeList,
          fileNameBase: buildExportFileBase({ orderNames: exportOrderNames, mode: 'nesting', activeSizes: activeExportSizes }),
          title: 'Die-Cut Nesting Result',
          subtitle: buildExportSubtitle(config, `${selectedSheets.reduce((s, sh) => s + (sh.placedCount || 0), 0)} pieces | ${selectedSheets.length} sheets`)
        };
      }

      await diecutExportService.exportPdf(exportPayload);

      closeExportPicker();
    } catch (err) {
      console.error(`[DieCut] export error:`, err);
      window.alert(err.message || `Không thể xuất file.`);
      setExportPicker((current) => ({ ...current, isSubmitting: false }));
    }
  };

  // --- HANDLERS: MAIN FLOW ---
  const handleRunNesting = async () => {
    if (sizeList.length === 0) return;
    if (!sizeList.some(s => s.quantity > 0)) {
      setNestError('Chưa nhập số lượng. Hãy import Excel hoặc nhập thủ công.');
      return;
    }

    setIsNesting(true);
    setNestError(null);
    try {
      const payload = { sizeList, ...applyRecommendedMode(config, importAnalysis) };
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

  const handleRunTest = async () => {
    if (shapes.length === 0) return;
    setIsTestRunning(true);
    setTestError(null);
    setTestResult(null);
    try {
      const payload = { sizeList: shapes, ...applyRecommendedMode(config, importAnalysis) };
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
    const valStr = value.replace(/[^0-9]/g, '');
    const qty = parseInt(valStr) || 0;
    setQuantities(prev => {
      const idx = prev.findIndex(q => q.sizeName === sizeName);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], _rawInput: valStr, pairQuantity: qty, pieceQuantity: qty * 2 };
        return next;
      }
      return [...prev, { sizeName, _rawInput: valStr, pairQuantity: qty, pieceQuantity: qty * 2 }];
    });
  };

  // --- RENDER HELPERS ---
  const renderStep1 = () => (
    <div className="space-y-4">
      <DieCutDxfUploader
        onShapesLoaded={({ shapes: nS, importAnalysis: nIA }) => {
          setShapes(nS);
          setImportAnalysis(nIA || null);
          setConfig((curr) => applyRecommendedMode(curr, nIA));
        }}
        initialShapes={shapes.length > 0 ? shapes : null}
        initialImportAnalysis={importAnalysis}
      />
      {shapes.length > 0 && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setActiveStep(isTestMode ? 3 : 2)}
            className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-lg text-white ${
              isTestMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-purple-500 hover:bg-purple-600'
            }`}
          >
            Tiếp theo: {isTestMode ? 'Cấu hình Test' : 'Nhập số lượng'} →
          </button>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
      <DieCutExcelUploader onQuantitiesLoaded={setQuantities} />
      <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 space-y-3 h-full">
        <h3 className="text-white font-semibold text-sm">✏️ Hoặc nhập thủ công</h3>
        {shapes.length === 0 ? (
          <p className="text-white/40 text-sm">Hãy import DXF trước (Bước 1)</p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto space-y-1">
            {shapes.map((s, i) => {
              const matched = sizeList.find(sl => sl.sizeName === s.sizeName);
              return (
                <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                  <span className="text-white font-medium text-sm w-16">Size {s.sizeName}</span>
                  <input
                    type="text"
                    value={matched?._rawInput ?? (matched?.pairQuantity || 0)}
                    onChange={e => handleQuantityManualChange(s.sizeName, e.target.value)}
                    className="w-20 bg-white/10 border border-white/20 text-white rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:border-purple-400"
                  />
                  <span className="text-white/50 text-xs">đôi</span>
                  <span className="text-emerald-300 text-xs ml-auto">= {matched?.pieceQuantity || 0} chiếc</span>
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
  );

  const renderStep3 = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        <SheetConfigPanel config={config} onChange={setConfig} isTestMode={isTestMode} importAnalysis={importAnalysis} />
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-3 space-y-2">
          <h3 className="text-white font-semibold text-sm">📋 Tóm tắt trước khi chạy</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <div className="text-white/50 text-xs mb-0.5">Loại biên dạng</div>
              <div className="text-white font-medium text-sm">{shapes.length} size</div>
            </div>
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <div className="text-white/50 text-xs mb-0.5">{isTestMode ? 'Chế độ' : 'Tổng chiếc'}</div>
              <div className={`font-medium text-sm ${isTestMode ? 'text-amber-300' : 'text-emerald-300'}`}>
                {isTestMode ? 'Test Max' : `${totalPieces} chiếc (${effectiveTotalPieces} trên sơ đồ)`}
              </div>
              {!isTestMode && config.layers > 1 && (
                <div className="text-[10px] text-white/35 mt-1">
                  Xếp chồng {config.layers} lớp
                </div>
              )}
            </div>
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <div className="text-white/50 text-xs mb-0.5">Khổ PU</div>
              <div className="text-white font-medium text-sm">{config.sheetWidth}×{config.sheetHeight}</div>
            </div>
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <div className="text-white/50 text-xs mb-0.5">Cách sắp</div>
              <div className="text-white font-medium text-[10px] leading-tight">
                {config.spacing}mm / sole {config.staggerSpacing ?? config.spacing}mm
              </div>
              <div className="text-[10px] text-white/35 mt-1">{getCapacityModeLabel(config)}</div>
            </div>
          </div>

          {(nestError || testError) && (
            <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 text-red-200 text-sm">
              {nestError || testError}
            </div>
          )}

          <button
            onClick={isTestMode ? handleRunTest : handleRunNesting}
            disabled={isTestRunning || isNesting || (!isTestMode && totalPieces === 0) || !hasData}
            className={`w-full py-2.5 text-white font-semibold rounded-xl transition-all shadow-lg text-sm flex items-center justify-center gap-3 mt-2 ${
              isTestMode ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'
            }`}
          >
            {(isTestRunning || isNesting) ? (
              <>
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
                  <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Đang tính toán...
              </>
            ) : isTestMode ? 'Test: Tính số lượng tối đa' : 'Chạy Nesting True Shape'}
          </button>
          <p className="text-white/30 text-[10px] text-center italic">
            {isTestMode ? '✓ Tự động xếp tối đa từng size lên 1 tấm PU' : '✓ Thuật toán đo lường biên dạng thực tế'}
          </p>
        </div>
      </div>
      <SheetVisualizerPanel config={config} />
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4">
      {isTestMode && testResult ? (
        <TestCapacityResult
          result={testResult}
          config={config}
          onExportPdf={() => openExportPicker('pdf', 'test', buildTestExportItems())}
          onExportDxf={() => openExportPicker('dxf', 'test', buildTestExportItems())}
          onClose={() => setActiveStep(3)}
        />
      ) : (
        <NormalNestingResult
          nestingResult={nestingResult}
          sizeList={sizeList}
          config={config}
          sizeSummary={nestingResultSizeSummary}
          activeSizeSummary={activeNestingResultSizeSummary}
          emptySizeSummary={emptyNestingResultSizeSummary}
          showEmptySizeRows={showEmptySizeRows}
          setShowEmptySizeRows={setShowEmptySizeRows}
          onExportPdf={() => openExportPicker('pdf', 'nesting', (nestingResult?.sheets || []).map((s, i) => ({ label: `Tấm ${i+1}`, sheet: s, placedCount: s.placedCount, efficiency: s.efficiency })))}
          onExportDxf={() => openExportPicker('dxf', 'nesting', (nestingResult?.sheets || []).map((s, i) => ({ label: `Tấm ${i+1}`, sheet: s, placedCount: s.placedCount, efficiency: s.efficiency })))}
          onResultChange={setNestingResult}
          onClose={() => { setActiveStep(3); setNestingResult(null); }}
        />
      )}
    </div>
  );

  // --- MAIN RENDER ---
  return (
    <div className="min-h-screen py-2 px-2 md:px-4">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-white text-lg font-bold">Nesting Hàng Die-Cut</h1>
              <p className="text-white/50 text-[11px]">Sắp xếp biên dạng thực tế (True Shape) cho miếng lót giày</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-xs">Chế độ:</span>
            <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5">
              <button
                onClick={() => { setIsTestMode(false); if (activeStep === 4) setActiveStep(3); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${!isTestMode ? 'bg-purple-500 text-white' : 'text-white/50 hover:text-white/80'}`}
              >
                Nesting
              </button>
              <button
                onClick={() => { setIsTestMode(true); if (activeStep === 2) setActiveStep(3); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${isTestMode ? 'bg-amber-500 text-white' : 'text-white/50 hover:text-white/80'}`}
              >
                Test Capacity
              </button>
            </div>
          </div>
        </div>

        {/* Step Navigation */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {(isTestMode 
            ? [{ n: 1, l: '1. Biên dạng DXF' }, { n: 3, l: '2. Cấu hình & Test' }, { n: 4, l: '3. Kết quả' }]
            : [{ n: 1, l: '1. Biên dạng DXF' }, { n: 2, l: '2. Số lượng Excel' }, { n: 3, l: '3. Cấu hình & Chạy' }, { n: 4, l: '4. Kết quả' }]
          ).map(s => (
            <button
              key={s.n}
              onClick={() => setActiveStep(s.n)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                activeStep === s.n 
                  ? 'bg-white/20 text-white border-white/30 shadow-lg' 
                  : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'
              }`}
            >
              {s.l}
            </button>
          ))}
        </div>

        {/* Main Content Areas */}
        {activeStep === 1 && renderStep1()}
        {activeStep === 2 && !isTestMode && renderStep2()}
        {activeStep === 3 && renderStep3()}
        {activeStep === 4 && renderStep4()}
      </div>

      <ExportSheetPickerModal
        isOpen={exportPicker.isOpen}
        format={exportPicker.format}
        items={exportPicker.items}
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
