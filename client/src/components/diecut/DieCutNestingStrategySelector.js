import React from 'react';

export const DIECUT_NESTING_STRATEGY_OPTIONS = [
  {
    value: 'ordered',
    title: 'B\u00ecnh th\u01b0\u1eddng',
    description: 'X\u1ebfp l\u1ea7n l\u01b0\u1ee3t c\u00e1c size theo th\u1ee9 t\u1ef1 hi\u1ec7n t\u1ea1i. \u0110\u00e2y l\u00e0 ch\u1ebf \u0111\u1ed9 m\u1eb7c \u0111\u1ecbnh.'
  },
  {
    value: 'mixed-size-area',
    title: 'T\u1ed1i \u01b0u - Tr\u1ed9n Size',
    description: '\u01afu ti\u00ean size l\u1edbn tr\u01b0\u1edbc, sau \u0111\u00f3 d\u00f9ng size nh\u1ecf \u0111\u1ec3 l\u1ea5p c\u00e1c khe tr\u1ed1ng tr\u00ean c\u00f9ng t\u1ea5m.'
  },
  {
    value: 'single-size-per-sheet',
    title: 'T\u1ed1i \u01b0u - \u0110\u1ed9c Size',
    description: 'M\u1ed7i t\u1ea5m PU ch\u1ec9 ch\u1ee9a duy nh\u1ea5t m\u1ed9t size. Kh\u00f4ng ch\u00e8n th\u00eam size kh\u00e1c v\u00e0o ph\u1ea7n d\u01b0.'
  }
];

const DieCutNestingStrategySelector = ({ value, onChange }) => (
  <div className="bg-white/5 p-2.5 rounded-xl border border-white/10 space-y-2.5">
    <div className="flex items-start justify-between gap-2.5">
      <div>
        <label className="text-white/60 text-[11px] font-medium flex items-center gap-1.5">
          <span className="text-fuchsia-300">Layers</span> {'S\u1ed1 l\u1edbp d\u1eadp'}
        </label>
        <p className="text-white/35 text-[10px] mt-0.5 leading-relaxed max-w-[620px]">
          {'S\u1ed1 l\u01b0\u1ee3ng c\u1ea7n x\u1ebfp s\u1ebd \u0111\u01b0\u1ee3c chia theo s\u1ed1 l\u1edbp c\u1eaft \u0111\u1ec3 ph\u00f9 h\u1ee3p th\u1ef1c t\u1ebf d\u1eadp khu\u00f4n.'}
        </p>
      </div>
      <input
        type="number"
        min={1}
        step={1}
        value={value.layers}
        onChange={(event) => {
          const nextLayers = Math.max(1, Math.floor(Number(event.target.value) || 1));
          onChange({ ...value, layers: nextLayers });
        }}
        className="w-20 bg-black/20 border border-white/10 text-white rounded-lg px-2.5 py-1 text-sm text-right focus:outline-none focus:border-fuchsia-400 transition-colors"
      />
    </div>

    <div className="space-y-1.5">
      <label className="text-white/60 text-[11px] font-medium flex items-center gap-1.5">
        <span className="text-cyan-300">Mode</span> {'Chi\u1ebfn l\u01b0\u1ee3c Nesting'}
      </label>

      <div className="space-y-1.5">
        {DIECUT_NESTING_STRATEGY_OPTIONS.map((option) => {
          const active = value.nestingStrategy === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ ...value, nestingStrategy: option.value })}
              className={`w-full text-left rounded-xl border px-3 py-1.5 transition-all ${
                active
                  ? 'bg-cyan-500/15 border-cyan-400/40 shadow-lg shadow-cyan-500/10'
                  : 'bg-black/20 border-white/10 hover:bg-white/5'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                  active ? 'border-cyan-300' : 'border-white/20'
                }`}>
                  <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-cyan-300' : 'bg-transparent'}`} />
                </div>
                <div>
                  <div className={`text-[13px] font-semibold leading-snug ${active ? 'text-cyan-200' : 'text-white/85'}`}>
                    {option.title}
                  </div>
                  <p className="text-[10px] text-white/45 mt-0.5 leading-relaxed">
                    {option.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

export default DieCutNestingStrategySelector;
