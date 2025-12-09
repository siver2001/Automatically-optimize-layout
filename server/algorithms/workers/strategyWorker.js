import { parentPort } from 'worker_threads';
import PackingAlgorithm from '../packingAlgorithm.js';

parentPort.on('message', async (taskData) => {
    try {
        const { id, method, params } = taskData;

        if (method === 'optimize') {
            const [container, rectangles, layers, strategyName] = params;
            const algorithm = new PackingAlgorithm();

            // Execute optimization
            const result = await algorithm.optimize(container, rectangles, layers, strategyName);

            parentPort.postMessage({
                id,
                result
            });
        } else {
            throw new Error(`Unknown method: ${method}`);
        }

    } catch (error) {
        parentPort.postMessage({
            id: taskData.id,
            error: error.message,
            stack: error.stack
        });
    }
});

