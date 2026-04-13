import { DIECUT_NESTING_STRATEGY_OPTIONS } from './DieCutNestingStrategySelector.js';

export const PAIR_CAPACITY_MODE = 'pair-complementary';
export const SINGLE_INSOLE_CAPACITY_MODE = 'same-side-banded';
export const DOUBLE_INSOLE_CAPACITY_MODE = 'same-side-double-contour';

export const SAME_SIDE_MODE_OPTIONS = [
  {
    value: 'same-side-banded',
    label: 'Cùng bên tiêu chuẩn'
  },
  {
    value: 'same-side-orthogonal',
    label: 'Hàng thẳng'
  },
  {
    value: 'same-side-double-contour',
    label: 'Biên kép'
  }
];

export function buildPairConfig(config) {
  return {
    ...config,
    mirrorPairs: true,
    pairingStrategy: 'pair',
    capacityLayoutMode: PAIR_CAPACITY_MODE
  };
}

export function buildSameSideConfig(config, importAnalysis) {
  return {
    ...config,
    mirrorPairs: false,
    pairingStrategy: 'same-side',
    capacityLayoutMode: importAnalysis?.recommendation?.capacityLayoutMode === DOUBLE_INSOLE_CAPACITY_MODE
      ? DOUBLE_INSOLE_CAPACITY_MODE
      : SINGLE_INSOLE_CAPACITY_MODE
  };
}

export function applyRecommendedMode(config, importAnalysis) {
  const recommendation = importAnalysis?.recommendation;
  if (!recommendation?.autoApply) {
    if (
      config.capacityLayoutMode === DOUBLE_INSOLE_CAPACITY_MODE ||
      config.capacityLayoutMode === 'same-side-prepaired-tight'
    ) {
      return buildPairConfig(config);
    }

    if (config.pairingStrategy === 'same-side' || config.mirrorPairs === false) {
      return buildSameSideConfig(config, importAnalysis);
    }

    return buildPairConfig(config);
  }

  return buildSameSideConfig(config, importAnalysis);
}

export function isUsingRecommendedMode(config, importAnalysis) {
  if (!importAnalysis?.recommendation?.autoApply) return false;

  return (
    config.pairingStrategy === 'same-side' &&
    config.mirrorPairs === false &&
    config.capacityLayoutMode === (
      importAnalysis?.recommendation?.capacityLayoutMode === DOUBLE_INSOLE_CAPACITY_MODE
        ? DOUBLE_INSOLE_CAPACITY_MODE
        : SINGLE_INSOLE_CAPACITY_MODE
    )
  );
}

export function getDisplayFileType(importAnalysis) {
  return importAnalysis?.recommendation?.kind === 'double-insole-double-contour'
    ? 'File ghép sẵn'
    : 'File thường';
}

export function getDisplayAutoLayout(config, importAnalysis) {
  if (!importAnalysis?.recommendation?.autoApply) {
    return 'Chọn thủ công';
  }

  return config.capacityLayoutMode === DOUBLE_INSOLE_CAPACITY_MODE
    ? 'Tối ưu cho file ghép sẵn'
    : 'Tối ưu cho file thường';
}

export function getCapacityModeLabel(config) {
  if (config.pairingStrategy === 'same-side') {
    if (config.capacityLayoutMode === 'same-side-double-contour') {
      return 'Ghép Chiếc - Biên kép';
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

export function mergeShapesAndQuantities(shapes, quantities) {
  return shapes.map((shape) => {
    const match = quantities.find((q) => q.sizeName === shape.sizeName);
    return {
      ...shape,
      quantity: match ? match.pairQuantity : 0,
      pairQuantity: match ? match.pairQuantity : 0,
      pieceQuantity: match ? match.pieceQuantity : 0
    };
  });
}

export function buildExportFileBase({
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

export function getNestingStrategyLabel(strategy) {
  const matched = DIECUT_NESTING_STRATEGY_OPTIONS.find((option) => option.value === strategy);
  return matched?.title || 'Bình thường';
}
