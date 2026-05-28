import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

function runMockTest() {
  console.log("=== RUNNING MOCK ALIGNMENT TEST ===");
  
  const config = {
    sheetWidth: 1000,
    sheetHeight: 1000,
    marginX: 5,
    marginY: 5,
    spacing: 3,
    gridStep: 0.5
  };
  
  const engine = new CapacityTestDoubleInsoleDoubleContourPattern(config);
  
  // Define standard orient shapes
  const wholeOrient = {
    foot: 'X',
    bb: { minX: 0, minY: 0, maxX: 200, maxY: 150 },
    polygon: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }
    ]
  };
  
  const splitOrient = {
    foot: 'split-left',
    bb: { minX: 0, minY: 0, maxX: 100, maxY: 150 },
    polygon: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }
    ]
  };

  const horizontalSplitOrient = {
    foot: 'split-left',
    bb: { minX: 0, minY: 0, maxX: 200, maxY: 75 },
    polygon: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 75 }, { x: 0, y: 75 }
    ]
  };

  // Mock a column of whole pieces at X=400 (center)
  const placements = [
    { id: 'whole_1', orient: wholeOrient, x: 400, y: 200 },
    { id: 'whole_2', orient: wholeOrient, x: 400, y: 400 },
    { id: 'whole_3', orient: wholeOrient, x: 400, y: 600 }
  ];
  
  // Mock some right-margin splits with jagged initial X-coordinates
  // sheetWidth = 1000, X is around 850, Y is far from top/bottom
  placements.push(
    { id: 'margin_fill_right_1', orient: splitOrient, x: 800, y: 300, isSplit: true },
    { id: 'margin_fill_right_2', orient: splitOrient, x: 820, y: 500, isSplit: true },
    { id: 'margin_fill_right_3', orient: splitOrient, x: 780, y: 700, isSplit: true }
  );

  // Mock a bottom-margin split which should snap to the column above it (at X=400, width=200 -> center X is 500)
  // Let's place it at x=350, y=850 (close to bottom 1000)
  placements.push(
    { id: 'margin_fill_bottom_1', orient: horizontalSplitOrient, x: 350, y: 850, isSplit: true }
  );

  console.log("Initial Placements:");
  placements.forEach(p => {
    const isSplit = engine._isSplitFillPlacement(p);
    console.log(` - ${p.id} (Split: ${isSplit}) | x: ${p.x}, y: ${p.y}`);
  });
  
  // Run the alignment algorithm with a dummy size to simulate the finalization phase
  const aligned = engine._alignMarginSplits(placements, config, 1000, 1000, 'mockSize');
  
  console.log("\nAligned Placements:");
  aligned.forEach(p => {
    console.log(` - ${p.id} | x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}`);
  });
  
  // Verify right splits are perfectly aligned (same X coordinate)
  const rightSplits = aligned.filter(p => p.id.includes('right'));
  const firstX = rightSplits[0].x;
  const allAligned = rightSplits.every(p => Math.abs(p.x - firstX) < 1e-3);
  
  console.log("\nVerification:");
  console.log(` - Are all right-margin splits perfectly aligned in a straight column? ${allAligned ? "YES" : "NO"} (X: ${firstX.toFixed(2)})`);
  
  // Verify bottom split is aligned with the column above it
  const bottomSplit = aligned.find(p => p.id.includes('bottom'));
  const wholeColumnCenterX = 400 + (200 / 2); // column above is at X=400, width=200 -> center is 500
  const bottomSplitCenterX = bottomSplit.x + (200 / 2);
  const bottomAligned = Math.abs(bottomSplitCenterX - wholeColumnCenterX) < 1e-3;
  console.log(` - Is the bottom-margin split perfectly aligned with the column center above it? ${bottomAligned ? "YES" : "NO"} (Center X: ${bottomSplitCenterX.toFixed(2)})`);
}

runMockTest();
