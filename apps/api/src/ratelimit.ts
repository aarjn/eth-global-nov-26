// Sliding-window-log rate limiter (in memory, single process). Reference: Code Garage
// engineering.algorithms.rate-limiting (sliding window). Written new: no TS item matched.

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly limit: number, readonly windowMs: number, private now: () => number = Date.now) {}

  private live(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length) this.hits.set(key, arr); else this.hits.delete(key);
    return arr;
  }
  /** Remaining hits in the window for this key. */
  remaining(key: string): number { return Math.max(0, this.limit - this.live(key).length); }
  /** Seconds until the oldest hit leaves the window (0 when not limited). */
  retryAfterSec(key: string): number {
    const arr = this.live(key);
    if (arr.length < this.limit) return 0;
    return Math.max(1, Math.ceil((arr[0]! + this.windowMs - this.now()) / 1000));
  }
  hit(key: string): void { const arr = this.live(key); arr.push(this.now()); this.hits.set(key, arr); }
  size(): number { return this.hits.size; }
}

export interface LimitCheck { limiter: SlidingWindowLimiter; key: string; name: string; }

/** Check every limiter first and consume from all of them only if all pass (no partial consumption).
 *  Returns null when allowed, or the first limit that blocked with its retry-after. */
export function consumeAll(checks: LimitCheck[]): { name: string; retryAfterSec: number } | null {
  for (const c of checks) {
    if (c.limiter.remaining(c.key) <= 0) return { name: c.name, retryAfterSec: c.limiter.retryAfterSec(c.key) };
  }
  for (const c of checks) c.limiter.hit(c.key);
  return null;
}
