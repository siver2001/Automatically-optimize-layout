// client/src/utils/geometryUtils.js

/**
 * Kiểm tra xem hai hình chữ nhật có chồng lấn không
 */
export const checkOverlap = (rect1, rect2) => {
  return !(
    rect1.x + rect1.width <= rect2.x ||
    rect2.x + rect2.width <= rect1.x ||
    rect1.y + rect1.length <= rect2.y ||
    rect2.y + rect2.length <= rect1.y
  );
};

/**
 * Tính khoảng cách giữa hai điểm
 */
export const distance = (x1, y1, x2, y2) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

/**
 * Tìm điểm snap gần nhất trên grid
 */
export const snapToGrid = (value, gridSize) => {
  return Math.round(value / gridSize) * gridSize;
};

/**
 * Kiểm tra xem một điểm có nằm trong hình chữ nhật không
 */
export const isPointInRect = (x, y, rect) => {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.length
  );
};

/**
 * Tính diện tích giao nhau giữa hai hình chữ nhật
 */
export const getIntersectionArea = (rect1, rect2) => {
  const xOverlap = Math.max(
    0,
    Math.min(rect1.x + rect1.width, rect2.x + rect2.width) -
      Math.max(rect1.x, rect2.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(rect1.y + rect1.length, rect2.y + rect2.length) -
      Math.max(rect1.y, rect2.y)
  );
  return xOverlap * yOverlap;
};

/**
 * Tìm tất cả các hình chữ nhật chồng lấn với một hình cho trước
 */
export const findOverlappingRects = (targetRect, allRects) => {
  return allRects.filter(
    (rect) => rect.id !== targetRect.id && checkOverlap(targetRect, rect)
  );
};

/**
 * Kiểm tra xem hình chữ nhật có nằm hoàn toàn trong container không
 */
export const isRectInsideContainer = (rect, containerWidth, containerLength) => {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= containerWidth &&
    rect.y + rect.length <= containerLength
  );
};

/**
 * Tính khoảng cách từ hình chữ nhật đến các cạnh của container
 */
export const getDistanceToEdges = (rect, containerWidth, containerLength) => {
  return {
    left: rect.x,
    right: containerWidth - (rect.x + rect.width),
    top: rect.y,
    bottom: containerLength - (rect.y + rect.length),
  };
};

/**
 * Tìm vị trí hợp lệ gần nhất cho một hình chữ nhật
 */
export const findNearestValidPosition = (
  targetRect,
  allRects,
  containerWidth,
  containerLength
) => {
  let x = targetRect.x;
  let y = targetRect.y;

  // Đảm bảo trong bounds
  x = Math.max(0, Math.min(x, containerWidth - targetRect.width));
  y = Math.max(0, Math.min(y, containerLength - targetRect.length));

  const testRect = { ...targetRect, x, y };

  // Nếu không chồng lấn, trả về vị trí hiện tại
  if (!findOverlappingRects(testRect, allRects).length) {
    return { x, y };
  }

  // Tìm khoảng trống gần nhất
  const searchRadius = 50;
  const step = 10;

  for (let r = step; r <= searchRadius; r += step) {
    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      const testX = x + r * Math.cos(rad);
      const testY = y + r * Math.sin(rad);

      const candidate = {
        ...targetRect,
        x: Math.max(0, Math.min(testX, containerWidth - targetRect.width)),
        y: Math.max(0, Math.min(testY, containerLength - targetRect.length)),
      };

      if (!findOverlappingRects(candidate, allRects).length) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // Nếu không tìm thấy, trả về vị trí ban đầu
  return { x: targetRect.x, y: targetRect.y };
};

/**
 * Tính toán snap points từ các hình chữ nhật khác
 */
export const calculateSnapPoints = (targetRect, allRects, threshold) => {
  const snapPoints = [];

  allRects.forEach((rect) => {
    if (rect.id === targetRect.id) return;

    // Snap to edges
    const edges = [
      { x: rect.x, label: 'left' },
      { x: rect.x + rect.width, label: 'right' },
      { y: rect.y, label: 'top' },
      { y: rect.y + rect.length, label: 'bottom' },
    ];

    edges.forEach((edge) => {
      if (edge.x !== undefined) {
        const dist = Math.abs(targetRect.x - edge.x);
        if (dist < threshold) {
          snapPoints.push({
            type: 'vertical',
            value: edge.x,
            distance: dist,
            label: edge.label,
          });
        }

        const distRight = Math.abs(targetRect.x + targetRect.width - edge.x);
        if (distRight < threshold) {
          snapPoints.push({
            type: 'vertical',
            value: edge.x - targetRect.width,
            distance: distRight,
            label: `${edge.label}-align-right`,
          });
        }
      }

      if (edge.y !== undefined) {
        const dist = Math.abs(targetRect.y - edge.y);
        if (dist < threshold) {
          snapPoints.push({
            type: 'horizontal',
            value: edge.y,
            distance: dist,
            label: edge.label,
          });
        }

        const distBottom = Math.abs(targetRect.y + targetRect.length - edge.y);
        if (distBottom < threshold) {
          snapPoints.push({
            type: 'horizontal',
            value: edge.y - targetRect.length,
            distance: distBottom,
            label: `${edge.label}-align-bottom`,
          });
        }
      }
    });

    // Snap to center alignment
    const rectCenterX = rect.x + rect.width / 2;
    const rectCenterY = rect.y + rect.length / 2;
    const targetCenterX = targetRect.x + targetRect.width / 2;
    const targetCenterY = targetRect.y + targetRect.length / 2;

    const distCenterX = Math.abs(targetCenterX - rectCenterX);
    const distCenterY = Math.abs(targetCenterY - rectCenterY);

    if (distCenterX < threshold) {
      snapPoints.push({
        type: 'vertical',
        value: rectCenterX - targetRect.width / 2,
        distance: distCenterX,
        label: 'center-x',
      });
    }

    if (distCenterY < threshold) {
      snapPoints.push({
        type: 'horizontal',
        value: rectCenterY - targetRect.length / 2,
        distance: distCenterY,
        label: 'center-y',
      });
    }
  });

  // Sort by distance and return closest snaps
  return snapPoints.sort((a, b) => a.distance - b.distance);
};

/**
 * Căn chỉnh nhiều hình chữ nhật theo một hướng
 */
export const alignRectangles = (rects, alignType) => {
  if (rects.length < 2) return rects;

  const aligned = [...rects];

  switch (alignType) {
    case 'left': {
      const minX = Math.min(...rects.map((r) => r.x));
      aligned.forEach((r) => (r.x = minX));
      break;
    }
    case 'right': {
      const maxX = Math.max(...rects.map((r) => r.x + r.width));
      aligned.forEach((r) => (r.x = maxX - r.width));
      break;
    }
    case 'top': {
      const minY = Math.min(...rects.map((r) => r.y));
      aligned.forEach((r) => (r.y = minY));
      break;
    }
    case 'bottom': {
      const maxY = Math.max(...rects.map((r) => r.y + r.length));
      aligned.forEach((r) => (r.y = maxY - r.length));
      break;
    }
    case 'center-horizontal': {
      const avgX =
        rects.reduce((sum, r) => sum + r.x + r.width / 2, 0) / rects.length;
      aligned.forEach((r) => (r.x = avgX - r.width / 2));
      break;
    }
    case 'center-vertical': {
      const avgY =
        rects.reduce((sum, r) => sum + r.y + r.length / 2, 0) / rects.length;
      aligned.forEach((r) => (r.y = avgY - r.length / 2));
      break;
    }
    default:
      break;
  }

  return aligned;
};

/**
 * Phân phối đều các hình chữ nhật
 */
export const distributeRectangles = (rects, direction) => {
  if (rects.length < 3) return rects;

  const sorted = [...rects].sort((a, b) =>
    direction === 'horizontal' ? a.x - b.x : a.y - b.y
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (direction === 'horizontal') {
    const totalSpace =
      last.x + last.width - first.x - rects.reduce((sum, r) => sum + r.width, 0);
    const spacing = totalSpace / (rects.length - 1);
    let currentX = first.x + first.width;

    for (let i = 1; i < sorted.length - 1; i++) {
      sorted[i].x = currentX + spacing;
      currentX = sorted[i].x + sorted[i].width;
    }
  } else {
    const totalSpace =
      last.y + last.length - first.y - rects.reduce((sum, r) => sum + r.length, 0);
    const spacing = totalSpace / (rects.length - 1);
    let currentY = first.y + first.length;

    for (let i = 1; i < sorted.length - 1; i++) {
      sorted[i].y = currentY + spacing;
      currentY = sorted[i].y + sorted[i].length;
    }
  }

  return sorted;
};

/**
 * Tính bounding box của một nhóm hình chữ nhật
 */
export const getBoundingBox = (rects) => {
  if (!rects.length) return null;

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.length));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    length: maxY - minY,
  };
};

/**
 * Tạo grid snapping points
 */
export const generateGridPoints = (
  containerWidth,
  containerLength,
  gridSize
) => {
  const points = [];

  for (let x = 0; x <= containerWidth; x += gridSize) {
    for (let y = 0; y <= containerLength; y += gridSize) {
      points.push({ x, y });
    }
  }

  return points;
};

/**
 * Tính toán khoảng cách giữa các hình chữ nhật
 */
export const calculateRectDistances = (rect1, rect2) => {
  const horizontalDist = Math.max(
    0,
    rect1.x > rect2.x + rect2.width
      ? rect1.x - (rect2.x + rect2.width)
      : rect2.x - (rect1.x + rect1.width)
  );

  const verticalDist = Math.max(
    0,
    rect1.y > rect2.y + rect2.length
      ? rect1.y - (rect2.y + rect2.length)
      : rect2.y - (rect1.y + rect1.length)
  );

  return {
    horizontal: horizontalDist,
    vertical: verticalDist,
    euclidean: Math.sqrt(
      Math.pow(horizontalDist, 2) + Math.pow(verticalDist, 2)
    ),
  };
};

const geometryUtils = {
  checkOverlap,
  distance,
  snapToGrid,
  isPointInRect,
  getIntersectionArea,
  findOverlappingRects,
  isRectInsideContainer,
  getDistanceToEdges,
  findNearestValidPosition,
  calculateSnapPoints,
  alignRectangles,
  distributeRectangles,
  getBoundingBox,
  generateGridPoints,
  calculateRectDistances,
};

export default geometryUtils;