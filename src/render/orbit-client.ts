import type { OrbitRequest, OrbitResult } from './orbit';

/**
 * Sends reference orbit requests to a worker. A new request cancels the one
 * in flight by restarting the worker, since a BigInt loop can't be interrupted.
 */
export class OrbitClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (result: OrbitResult) => void; reject: (error: Error) => void } | null = null;

  compute(request: Omit<OrbitRequest, 'id'>): Promise<OrbitResult> {
    this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      worker.postMessage({ ...request, id } satisfies OrbitRequest);
    });
  }

  cancel(): void {
    if (!this.pending) return;
    this.pending.reject(new CancelledError());
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }

  /** Stops the worker. The client starts a new one if it's used again. */
  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./orbit.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<OrbitResult>) => {
      if (this.pending?.id !== event.data.id) return;
      this.pending.resolve(event.data);
      this.pending = null;
    };
    worker.onerror = (event) => {
      this.pending?.reject(new Error(event.message));
      this.pending = null;
    };
    this.worker = worker;
    return worker;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}
