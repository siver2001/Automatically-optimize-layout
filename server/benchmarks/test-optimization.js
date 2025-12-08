
import PackingAlgorithm from '../algorithms/packingAlgorithm.js';

const runTest = async () => {
    const algorithm = new PackingAlgorithm();
    const container = { width: 1200, length: 2400 }; // Standard sheet

    console.log('--- STARTING OPTIMIZATION BENCHMARK ---');

    // Helper to generate rects
    const generateRects = (type, count) => {
        const rects = [];
        for (let i = 0; i < count; i++) {
            let w, l;
            if (type === 'uniform') {
                // 10 different sizes repeated
                const seed = i % 10;
                w = 100 + seed * 50;
                l = 100 + seed * 50;
            } else if (type === 'long') {
                // High aspect ratio
                w = 100;
                l = 800 + (i % 5) * 100;
            } else {
                // Random
                w = 100 + Math.floor(Math.random() * 500);
                l = 100 + Math.floor(Math.random() * 500);
            }
            rects.push({ id: `r${i}`, width: w, length: l, quantity: 1 });
        }
        return rects;
    };

    const runScenario = async (name, rects) => {
        console.log(`\nScenario: ${name} (${rects.length} items)`);
        const start = Date.now();
        try {
            // Using default strategy (AREA_OPTIMIZED -> HybridStrategy)
            const result = await algorithm.optimize(container, rects, 10, 'AREA_OPTIMIZED');
            const duration = Date.now() - start;
            console.log(`Duration: ${duration}ms`);
            console.log(`Sheets Used: ${result.layersUsed}`);
            console.log(`Efficiency: ${result.efficiency.toFixed(2)}%`);
        } catch (err) {
            console.error('Error:', err.message);
        }
    };

    // 1. Uniform Scenario (Should trigger Rule 1: Grouped/Shelf)
    const uniformRects = generateRects('uniform', 500);
    await runScenario('Uniform (Heuristic: Similarity)', uniformRects);

    // 2. Long Strip Scenario (Should trigger Rule 2: Aspect Ratio)
    const longRects = generateRects('long', 500);
    await runScenario('Long Strips (Heuristic: Aspect Ratio)', longRects);

    // 3. Random Scenario (Should run race/default)
    const randomRects = generateRects('random', 200); // Smaller count to be fast but trigger race if > 100
    await runScenario('Random (Default Race)', randomRects);

    // 4. Large Scale Scenario (10k items)
    console.log('\n--- LARGE SCALE TEST (10,000 Items) ---');
    const largeRects = generateRects('uniform', 10000);
    await runScenario('Large Scale Uniform (10k)', largeRects);

    console.log('\n--- BENCHMARK COMPLETE ---');
};

runTest();
