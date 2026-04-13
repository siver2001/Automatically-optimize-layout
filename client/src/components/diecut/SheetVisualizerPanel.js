import React from 'react';

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
        <span className="text-xl">📐</span> Mô phỏng cấu hình tấm PU ({w} × {h})
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

export default SheetVisualizerPanel;
