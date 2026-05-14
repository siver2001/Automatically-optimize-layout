import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { getBoundingBox } from '../server/algorithms/diecut/core/polygonUtils.js';
import { cachedPolygonsOverlap } from '../server/algorithms/diecut/strategies/capacity/patternCapacityUtils.js';

async function verifyIntegrity() {
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  if (!fs.existsSync(dxfFile)) {
    console.error(`File not found: ${dxfFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  console.log(`Verifying integrity for ${shapes.length} sizes...\n`);

  const config = {
    sheetWidth: 1100,
    sheetHeight: 2000,
    marginX: 5,
    marginY: 20,
    spacing: 4,
    gridStep: 0.5,
    preparedSplitFillEnabled: true,
    capacityLayoutMode: 'same-side-double-contour',
    allowRotate180: true,
    parallelSizes: true
  };

  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  const testSizes = shapes.map(shape => ({
    ...shape,
    sizeName: shape.sizeName || shape.name || 'Unknown'
  }));

  console.log(`Running engine for all sizes (Parallel)...`);
  const startTime = Date.now();
  const results = await engine.testCapacity(testSizes, config);
  const duration = (Date.now() - startTime) / 1000;
  console.log(`Engine finished in ${duration.toFixed(1)}s. Processing results...\n`);
  
  if (!results.summary || results.summary.length === 0) {
    console.error("No summary found in results");
    process.exit(1);
  }

  let totalErrors = 0;
  const auditReport = [];

  for (const summaryItem of results.summary) {
    const sizeName = summaryItem.sizeName;
    const sheet = results.sheetsBySize[sizeName];
    const placedItems = sheet?.placed || [];
    const errors = [];
    
    console.log(`Auditing Size ${sizeName} (${placedItems.length} items, ${summaryItem.pairs} pairs, Efficiency ${summaryItem.efficiency}%)...`);

    if (placedItems.length === 0) {
        errors.push(`No placements found for size ${sizeName}`);
    }

    // 1. Boundary Check
    for (const p of placedItems) {
      // NOTE: materialized polygons are already in world coordinates
      const bb = getBoundingBox(p.polygon);
      const minX = bb.minX;
      const maxX = bb.maxX;
      const minY = bb.minY;
      const maxY = bb.maxY;

      const margin = 1e-2;
      if (minX < -margin || maxX > config.sheetWidth + margin || minY < -margin || maxY > config.sheetHeight + margin) {
        errors.push(`Boundary violation: Piece ${p.id} at (${p.x.toFixed(1)},${p.y.toFixed(1)}) Bounds[${minX.toFixed(1)},${maxX.toFixed(1)},${minY.toFixed(1)},${maxY.toFixed(1)}]`);
      }
    }

    // 2. Overlap Check (Sampled)
    const checkCount = placedItems.length;
    const sampleLimit = 150;
    for (let i = 0; i < checkCount; i++) {
      const step = checkCount > sampleLimit ? Math.floor(checkCount / 20) : 1;
      for (let j = i + 1; j < checkCount; j += step) {
        const p1 = placedItems[i];
        const p2 = placedItems[j];
        
        // Since p1.polygon and p2.polygon are absolute, we pass {x:0, y:0} as offset
        if (cachedPolygonsOverlap(
            p1.polygon, p2.polygon,
            { x: 0, y: 0 }, { x: 0, y: 0 },
            config.spacing - 0.1,
            getBoundingBox(p1.polygon), getBoundingBox(p2.polygon)
        )) {
            errors.push(`Overlap/Gap violation between ${p1.id} and ${p2.id}`);
        }
      }
    }

    // 3. Outward Facing Check
    const splitPieces = placedItems.filter(p => p.id?.includes('split') || p.id?.includes('fill'));
    for (const p of splitPieces) {
        const orient = p.orient || p;
        const v = orient.splitOutwardVector;
        if (!v) continue;
        
        const bb = getBoundingBox(p.polygon);
        const cx = (bb.minX + bb.maxX)/2;
        const cy = (bb.minY + bb.maxY)/2;
        
        const towardsLeft = v.x < -0.7;
        const towardsRight = v.x > 0.7;
        const towardsTop = v.y < -0.7;
        const towardsBottom = v.y > 0.7;
        
        const layoutWidth = config.sheetWidth;
        const layoutHeight = config.sheetHeight;

        if (towardsLeft && cx > layoutWidth * 0.85) errors.push(`Piece ${p.id} faces LEFT but is at X=${cx.toFixed(1)}`);
        if (towardsRight && cx < layoutWidth * 0.15) errors.push(`Piece ${p.id} faces RIGHT but is at X=${cx.toFixed(1)}`);
    }

    if (errors.length > 0) {
      console.error(`  FAIL: ${errors.length} errors found`);
      errors.slice(0, 3).forEach(e => console.error(`    - ${e}`));
      totalErrors += errors.length;
    } else {
      console.log(`  PASS`);
    }
    
    auditReport.push({ 
        Size: sizeName, 
        Pairs: summaryItem.pairs, 
        Pieces: placedItems.length, 
        Efficiency: summaryItem.efficiency + '%', 
        Status: errors.length > 0 ? 'FAIL' : 'PASS' 
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('FINAL NESTING INTEGRITY AUDIT');
  console.table(auditReport);
  console.log(`Total Errors Across All Sizes: ${totalErrors}`);
  console.log(`Execution Time: ${duration.toFixed(1)}s`);
  console.log('='.repeat(80));

  if (totalErrors > 0) {
    // process.exit(1); 
  }
}

verifyIntegrity().catch(console.error);
