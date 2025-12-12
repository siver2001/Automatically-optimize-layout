
import PackingOrchestrator from '../server/services/packingOrchestrator.js';
import fs from 'fs';

// Mock container
const container = { width: 2400, length: 1200, layers: 1 };

// Mock rectangles (2 types)
const rects = [
    { id: 101, width: 500, length: 500, name: 'Item A', color: '#ff0000' },
    { id: 102, width: 300, length: 300, name: 'Item B', color: '#00ff00' }
];

async function runTest() {
    const output = [];
    output.push('=== TEST RUN 1: Item A (Qty 5) ===');
    const qty1 = { 101: 5, 102: 0 };
    const res1 = await PackingOrchestrator.optimizeBatch(container, rects, qty1, 'AREA_OPTIMIZED', [], 1);

    // Check results for Run 1
    const placed1 = res1.packingResult.rectangles;
    const countA1 = placed1.filter(r => r.typeId === 101).length;
    output.push(`Run 1 Result: Item A = ${countA1} (Expected 5)`);
    placed1.forEach(r => output.push(` - ID: ${r.id}, Name: ${r.name}, W: ${r.width}, L: ${r.length}, Layer: ${r.layer}`));

    output.push('\n=== TEST RUN 2: Item B (Qty 5) ONLY ===');
    const qty2 = { 101: 0, 102: 5 };
    const res2 = await PackingOrchestrator.optimizeBatch(container, rects, qty2, 'AREA_OPTIMIZED', [], 1);

    const placed2 = res2.packingResult.rectangles;
    const countA2 = placed2.filter(r => r.typeId === 101).length;
    const countB2 = placed2.filter(r => r.typeId === 102).length;
    output.push(`Run 2 Result: Item A = ${countA2} (Expected 0), Item B = ${countB2} (Expected 5)`);
    placed2.forEach(r => output.push(` - ID: ${r.id}, Name: ${r.name}, W: ${r.width}, L: ${r.length}, Layer: ${r.layer}`));

    fs.writeFileSync('repro_output.txt', output.join('\n'));
    console.log('Test completed. Results written to repro_output.txt');
}

runTest().catch(console.error);
