import fs from 'fs';
import { parseCadBufferToSizedShapes } from '../server/algorithms/diecut/core/dxfParser.js';
import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';
import { clearCapacityResultCache } from '../server/algorithms/diecut/strategies/capacity/capacityResultCache.js';
import { normalizeAngleDegrees } from '../server/algorithms/diecut/strategies/capacity/double-contour/utils.js';

async function run() {
  clearCapacityResultCache();
  const dxfFile = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
  const buffer = fs.readFileSync(dxfFile);
  const shapes = await parseCadBufferToSizedShapes(buffer, dxfFile);
  
  const size4_5 = shapes.find(shape => (shape.sizeName || shape.name) === '4.5');
  if (!size4_5) {
    console.error('Size 4.5 not found');
    return;
  }

  const runAnalysis = async (width, height) => {
    console.log(`\n=== COMPARING VARIANTS FOR ${width}x${height} ===`);
    const config = {
      sheetWidth: width,
      sheetHeight: height,
      marginX: 5,
      marginY: 5,
      spacing: 3,
      staggerSpacing: 3,
      gridStep: 0.5,
      preparedSplitFillEnabled: true,
      preparedSplitFillDeep: true,
      capacityLayoutMode: 'same-side-double-contour',
      allowRotate180: true,
      parallelSizes: false
    };

    const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
    const step = 0.5;
    const workWidth = width - 10;
    const workHeight = height - 10;

    const angle = 0;
    const relAngle = 180;
    const orient = engine._decorateOrient('4.5', 'X', size4_5.polygon, angle, config, step);
    const pairedAngle = normalizeAngleDegrees(angle + relAngle);
    const pairedOrient = {
      ...engine._decorateOrient('4.5', 'X', size4_5.polygon, pairedAngle, config, step),
      isAlternate: true
    };

    // Calculate dxMm
    const dxMm = engine._findAlignedBodyDx(orient, pairedOrient, config, step);
    console.log(`For relAngle=180: dxMm = ${dxMm}`);

    // Build variants
    const variants = engine._buildDoubleContourVariants(
      orient, 
      dxMm, 
      workWidth, 
      workHeight, 
      config, 
      step, 
      pairedOrient
    );

    console.log(`Total variants generated for relAngle=180: ${variants.length}`);
    
    // Look for target variant: bodyCols = 7, rowShiftXmm = 24.49 (or close to 24.49), bodyDyMm = 237.83 (or close to 237.83)
    console.log("Searching for the 1070x1970 layout variant properties...");
    const matches = variants.filter(v => {
      const isShiftClose = Math.abs(v.rowShiftXmm - 24.49) < 1.0;
      const isDxClose = Math.abs(v.bodyDxMm - 146.62) < 1.0;
      return v.bodyCols === 7 && isShiftClose;
    });

    if (matches.length > 0) {
      console.log(`Found ${matches.length} matching variants:`);
      for (const m of matches) {
        console.log(`  - bodyCols: ${m.bodyCols}, bodyDxMm: ${m.bodyDxMm}, bodyDyMm: ${m.bodyDyMm}, rowShiftXmm: ${m.rowShiftXmm}, rowShiftYmm: ${m.rowShiftYmm}, bodyPrimaryAngle: ${m.bodyPrimaryAngle}, bodyAlternateAngle: ${m.bodyAlternateAngle}`);
      }
    } else {
      console.log("No matching variant found!");
      // Print top 10 variants by bodyDyMm
      console.log("Top 10 variants:");
      variants.slice(0, 10).forEach((v, idx) => {
        console.log(`  [${idx}] bodyCols: ${v.bodyCols}, bodyDxMm: ${v.bodyDxMm}, bodyDyMm: ${v.bodyDyMm}, rowShiftXmm: ${v.rowShiftXmm}, rowShiftYmm: ${v.rowShiftYmm}`);
      });
    }
  };

  await runAnalysis(1070, 1970);
  await runAnalysis(1080, 1980);
}

run().catch(console.error);
