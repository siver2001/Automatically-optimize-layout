import axios from 'axios';

async function benchmark() {
    const container = { width: 2400, length: 1200, layers: 30 };
    const rectangles = [
        { id: 1, width: 600, length: 400, color: '#ff0000', name: 'Item 1' },
        { id: 2, width: 800, length: 300, color: '#00ff00', name: 'Item 2' },
        { id: 3, width: 500, length: 500, color: '#0000ff', name: 'Item 3' }
    ];
    // 1000 items total
    const quantities = { 1: 500, 2: 300, 3: 200 };

    console.log('Starting benchmark with 1000 items...');
    const start = Date.now();

    try {
        const response = await axios.post('http://localhost:5000/api/packing/optimize-batch', {
            container,
            rectangles,
            quantities,
            strategy: 'AREA_OPTIMIZED',
            unsplitableRectIds: [],
            layers: 30
        });

        const duration = Date.now() - start;
        console.log(`Benchmark completed in ${duration}ms`);
        console.log(`Success: ${response.data.success}`);
        console.log(`Plates: ${response.data.packingResult.plates.length}`);

    } catch (error) {
        console.error('Benchmark failed:', error.message);
    }
}

benchmark();
