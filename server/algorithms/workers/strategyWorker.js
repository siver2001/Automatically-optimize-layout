import { parentPort } from 'worker_threads';
import HybridStrategy from '../strategies/HybridStrategy.js';

parentPort.on('message', (taskData) => {
    try {
        const { strategyName, container, rectangles, method, params } = taskData;

        // Instantiate strategy
        // Note: We create a new instance for each task to ensure isolation.
        // Optimization: Could cache instance if container is same, but overhead is low.
        const strategy = new HybridStrategy(container);

        let result;

        if (method && typeof strategy[method] === 'function') {
            // Execute specific method (e.g., _maxRectsBSSF)
            // params is an array of arguments
            const { placed, remaining } = strategy[method](...params);
            result = { placed, remaining };
        } else if (method === 'executeFinalSheet_Worker') {
            // Special case for parallel deep search
            // params: [rectangles, iterations]
            const [rects, iterations] = params;
            // We need to implement a worker-specific version or expose a method on HybridStrategy
            // Since HybridStrategy.executeFinalSheet is now async/orchestrator, we need the "inner" logic here.
            // Let's assume we add a helper _runDeepSearchBatch to HybridStrategy for this purpose.
            const batchResult = strategy._runDeepSearchBatch(rects, iterations);
            result = batchResult;
        } else {
            throw new Error(`Unknown method: ${method}`);
        }

        parentPort.postMessage({
            strategyName,
            result
        });

    } catch (error) {
        // Send error back to main thread
        // We can't send Error objects directly easily, so send message
        parentPort.postMessage({
            error: error.message,
            stack: error.stack
        });
    }
});
