import { CapacityTestDoubleInsoleDoubleContourPattern } from '../server/algorithms/diecut/strategies/capacity/double-contour/CapacityTestDoubleInsoleDoubleContourPattern.js';

const engine = new CapacityTestDoubleInsoleDoubleContourPattern({});

console.log("Testing _findFirstSafeBinary...");
// 1. safeVal < unsafeVal: safeVal=100, unsafeVal=500
// Suppose safety boundary is at 300 (safe for x <= 300)
const isSafe1 = (x) => x <= 300;
const res1 = engine._findFirstSafeBinary(isSafe1, 500, 100, 0.1);
console.log(`Test 1: expected around 300, got ${res1}`);

// 2. safeVal > unsafeVal: safeVal=900, unsafeVal=500
// Suppose safety boundary is at 700 (safe for x >= 700)
const isSafe2 = (x) => x >= 700;
const res2 = engine._findFirstSafeBinary(isSafe2, 500, 900, 0.1);
console.log(`Test 2: expected around 700, got ${res2}`);

console.log("Testing complete!");
