import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { buildSplitHalfDefinitions } from '../server/algorithms/diecut/strategies/capacity/splittingUtils.js';

async function run() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size9_5 = shapes.find(shape => {
    const name = shape.sizeName || shape.name;
    return name === '9.5' || name === '9_5' || name === '95';
  });

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    staggerSpacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: false
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  engine._fillMarginHalves = function(sizeName, polygon, candidate, config, workWidth, workHeight) {
    const step = Math.max(0.5, config.gridStep || 1);
    const spacing = config.spacing || 0;
    
    const sourceShape = this._doubleContourSourceBySize?.get(sizeName);
    const halfDefs = buildSplitHalfDefinitions(
      sourceShape?.polygon || polygon,
      sourceShape?.internals?.[0] || []
    );
    
    const orientVariants = [];
    const fullPolygon = sourceShape?.polygon || polygon;
    for (const angle of this._getSplitFillAngles(config)) {
      for (const halfDef of halfDefs) {
        orientVariants.push(this._decorateSplitHalfOrient(sizeName, halfDef, angle, config, step));
      }
    }
    
    console.log("=== ORIENT VARIANTS ===");
    for (const o of orientVariants) {
      const bb = o.bb || getBoundingBox(o.polygon);
      console.log(`Foot: ${o.foot} | Angle: ${o.angle} | splitOutwardSide: ${o.splitOutwardSide} | bb: [${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}, ${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}] | width: ${(bb.maxX - bb.minX).toFixed(1)} | height: ${(bb.maxY - bb.minY).toFixed(1)}`);
    }
    
    process.exit(0);
  };
  
  await engine.testCapacity([size9_5], config);
}

run().catch(console.error);
