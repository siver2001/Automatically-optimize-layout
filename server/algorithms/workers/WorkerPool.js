import { Worker, isMainThread } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WorkerPool {
    constructor(workerScript, poolSize = Math.max(2, os.cpus().length - 1)) { // Dynamic pool size
        this.workerScript = workerScript;
        this.poolSize = poolSize;
        this.workers = [];
        this.queue = [];
        this.activeWorkers = 0;

        // Initialize pool
        for (let i = 0; i < this.poolSize; i++) {
            this._addNewWorker();
        }
    }

    _addNewWorker() {
        const worker = new Worker(this.workerScript);

        worker.on('message', (result) => {
            worker.busy = false;
            this.activeWorkers--;
            if (worker.taskCallback) {
                worker.taskCallback(null, result);
                worker.taskCallback = null;
            }
            this._processQueue();
        });

        worker.on('error', (error) => {
            console.error('Worker error:', error);
            worker.busy = false;
            this.activeWorkers--;
            if (worker.taskCallback) {
                worker.taskCallback(error, null);
                worker.taskCallback = null;
            }
            // Replace dead worker
            this.workers = this.workers.filter(w => w !== worker);
            this._addNewWorker();
            this._processQueue();
        });

        worker.busy = false;
        this.workers.push(worker);
    }

    _processQueue() {
        if (this.queue.length === 0) return;

        const availableWorker = this.workers.find(w => !w.busy);
        if (!availableWorker) return;

        const { taskData, resolve, reject } = this.queue.shift();

        availableWorker.busy = true;
        this.activeWorkers++;
        availableWorker.taskCallback = (err, result) => {
            if (err) reject(err);
            else resolve(result);
        };

        availableWorker.postMessage(taskData);
    }

    executeTask(taskData) {
        return new Promise((resolve, reject) => {
            this.queue.push({ taskData, resolve, reject });
            this._processQueue();
        });
    }

    terminate() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        this.queue = [];
    }
}

// Singleton instance - ONLY IN MAIN THREAD
let pool = null;
if (isMainThread) {
    const workerScriptPath = path.join(__dirname, 'strategyWorker.js');
    pool = new WorkerPool(workerScriptPath);
}

export default pool;
