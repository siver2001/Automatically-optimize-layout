import { CapacityTestDoubleInsoleDoubleContourPattern } from './CapacityTestDoubleInsoleDoubleContourPattern.js';
import { normalizeAngleDegrees } from './utils.js';

export class CapacityTestDoubleInsoleHorizontalPattern extends CapacityTestDoubleInsoleDoubleContourPattern {
  _getDoubleContourPreferredAngles() {
    return [90];
  }

  _getDoubleContourRelativeAngles(fastMode = false) {
    return fastMode ? [180] : [180, 0];
  }

  _allowFiller90(config) {
    return false;
  }

  _getSplitFillAngles(config = {}) {
    const baseAngles = [90, 270];
    const offsets = this._getDoubleContourFineRotateOffsets(config);
    const angles = [];
    for (const baseAngle of baseAngles) {
      for (const offset of offsets) {
        angles.push(normalizeAngleDegrees(baseAngle + offset));
      }
    }
    return [...new Set(angles)];
  }

  _getSameSideBaseAngles(config = {}) {
    return [90];
  }

  _allowSameSideFiller90(config = {}) {
    return false;
  }

  _getPreferredAngles() {
    return [90];
  }
}
