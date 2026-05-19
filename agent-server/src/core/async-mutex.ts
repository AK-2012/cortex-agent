// input:  nothing (leaf module)
// output: AsyncMutex
// pos:    promise-based mutex for serializing async operations
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            const next = this.queue.shift();
            if (next) next();
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
