import fs from 'fs';
import path from 'path';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

async function run() {
  const dxfFiles = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.dxf'));
  console.log(`Found DXF files: ${dxfFiles.join(', ')}`);

  const config = {
    sheetWidth: 1070,
    sheetHeight: 1970,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    staggerSpacing: 3,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);

  for (const dxfFile of dxfFiles) {
    console.log(`\nParsing ${dxfFile}...`);
    const buffer = fs.readFileSync(dxfFile);
    const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
    
    const sizes = shapes.map(shape => ({
      ...shape,
      sizeName: shape.sizeName || shape.name || 'Unknown'
    }));

    for (const size of sizes) {
      // Run test capacity for just this size
      const res = await engine.testCapacity([size], { ...config, parallelSizes: false });
      const sheet = res.sheetsBySize[size.sizeName];
      const placements = sheet ? (sheet.placed || sheet.placements) : [];
      
      // Look for top or bottom split placements based on their Y coordinate in sheet
      const topSplits = placements.filter(p => p.foot?.startsWith('split-') && p.y > 1970 - 350);
      const bottomSplits = placements.filter(p => p.foot?.startsWith('split-') && p.y < 350);
      
      if (topSplits.length > 0 || bottomSplits.length > 0) {
        console.log(`[FOUND] File: ${dxfFile} | Size: ${size.sizeName} has ${topSplits.length} top-splits and ${bottomSplits.length} bottom-splits`);
      }
    }
  }
}

run().catch(console.error);
