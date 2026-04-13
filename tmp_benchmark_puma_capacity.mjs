import fs from 'fs/promises';
import path from 'path';
import { parseCadBufferToSizedShapesWithAnalysis } from './server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestSameSidePattern } from './server/algorithms/diecut/strategies/capacity/CapacityTestSameSidePattern.js';
import { CapacityTestPumaDoubleContourPattern } from './server/algorithms/diecut/strategies/capacity/CapacityTestPumaDoubleContourPattern.js';

const entries = await fs.readdir('.');
const dxfPath = entries.find((name) => name.startsWith('PUMA-DC-') && name.toLowerCase().endsWith('.dxf'));
if (!dxfPath) {
  throw new Error('Missing PUMA-DC dxf file in workspace root');
}

const config = {
  sheetWidth: 1100,
  sheetHeight: 2000,
  spacing: 3,
  marginX: 5,
  marginY: 5,
  allowRotate90: true,
  allowRotate180: true,
  mirrorPairs: false,
  pairingStrategy: 'same-side',
  gridStep: 0.5,
  parallelSizes: false,
  maxTimeMs: 60000
};

const buffer = await fs.readFile(dxfPath);
const { shapes, importAnalysis } = await parseCadBufferToSizedShapesWithAnalysis(
  buffer,
  path.resolve(dxfPath),
  3.5,
  0.5
);

const bandedConfig = { ...config, capacityLayoutMode: 'same-side-banded' };
const pumaConfig = { ...config, capacityLayoutMode: 'same-side-puma-double-contour' };

const banded = await new CapacityTestSameSidePattern(bandedConfig).testCapacity(shapes, bandedConfig);
const puma = await new CapacityTestPumaDoubleContourPattern(pumaConfig).testCapacity(shapes, pumaConfig);

const bandedMap = new Map((banded.summary || []).map((item) => [item.sizeName, item]));
const pumaMap = new Map((puma.summary || []).map((item) => [item.sizeName, item]));

const deltas = [];
for (const [sizeName, bandedItem] of bandedMap.entries()) {
  const pumaItem = pumaMap.get(sizeName);
  if (!pumaItem) continue;
  deltas.push({
    sizeName,
    banded: bandedItem.placedCount || 0,
    puma: pumaItem.placedCount || 0,
    delta: (pumaItem.placedCount || 0) - (bandedItem.placedCount || 0),
    bandedEff: bandedItem.efficiency || 0,
    pumaEff: pumaItem.efficiency || 0
  });
}

const improved = deltas.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta || a.sizeName.localeCompare(b.sizeName));
const worse = deltas.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta || a.sizeName.localeCompare(b.sizeName));

console.log(JSON.stringify({
  dxfPath,
  shapeCount: shapes.length,
  importAnalysis,
  bandedDefault: {
    defaultSizeName: banded.defaultSizeName,
    totalPlaced: banded.totalPlaced,
    efficiency: banded.efficiency
  },
  pumaDefault: {
    defaultSizeName: puma.defaultSizeName,
    totalPlaced: puma.totalPlaced,
    efficiency: puma.efficiency
  },
  improvedCount: improved.length,
  worseCount: worse.length,
  topImproved: improved.slice(0, 8),
  topWorse: worse.slice(0, 8)
}, null, 2));

