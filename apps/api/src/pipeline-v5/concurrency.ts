// pipeline-v5/concurrency.ts
// Small dependency-free concurrency primitives for parallelising the v5 pipeline (chunk Gen1, asset fill,
// context rewrite) and for bounding the number of simultaneous Remotion renders (each spawns headless
// Chrome ~1-2GB, so it MUST be capped regardless of how many videos/slots run in parallel).

/**
 * Run `fn` over `items` with at most `limit` concurrent in-flight calls. Results are returned in input
 * order (results[i] corresponds to items[i]). `fn` should handle its own per-item errors — a throw will
 * reject the whole batch. Order-preserving + bounded so callers can fan out safely.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (!items.length) return results;
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Counting semaphore. release() hands a freed slot DIRECTLY to the next waiter (no avail bump in between),
 * so there is no window where a fresh acquire() could jump the queue — strict FIFO, exact cap.
 */
export class Semaphore {
  private avail: number;
  private waiters: Array<() => void> = [];
  constructor(n: number) {
    this.avail = Math.max(1, Math.floor(n) || 1);
  }
  private acquire(): Promise<void> {
    if (this.avail > 0) {
      this.avail--;
      return Promise.resolve();
    }
    // No slot: wait. When release() wakes us it has reserved the slot for us (it did NOT bump avail).
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private release(): void {
    const w = this.waiters.shift();
    if (w) w(); // hand the slot straight to the next waiter
    else this.avail++; // no waiter: return the slot to the pool
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Monotonic counter for building collision-free temp dir names under concurrency. */
let _seq = 0;
export function nextSeq(): number {
  _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER;
  return _seq;
}

/**
 * SHARED, process-wide cap on simultaneous Remotion renders — used by EVERY headless-Chrome render path
 * (renderTemplateCapsule, renderCapsuleStill, renderFinalVideoV5) so the total is bounded no matter how
 * many videos/chunks/slots fan out. The real memory cost is RENDER_CONCURRENCY × RENDER_TABS_PER_JOB Chrome
 * tabs (each render call opens up to `concurrency` tabs; Remotion defaults to ~cpus/2 ≈ 8, which would blow
 * memory). Keep RENDER_CONCURRENCY × RENDER_TABS_PER_JOB tabs within the RAM budget (~1-1.5GB/tab).
 */
export const renderSemaphore = new Semaphore(Number(process.env.RENDER_CONCURRENCY ?? 3));
export const RENDER_TABS_PER_JOB = Math.max(1, Number(process.env.RENDER_TABS_PER_JOB ?? 2));
