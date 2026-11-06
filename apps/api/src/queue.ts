/** Serialises async jobs on one promise chain: one sender wallet, one tx at a time, no nonce races. */
export class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;
  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    const p = this.tail.then(() => job());
    this.tail = p.then(() => undefined, () => undefined).finally(() => { this.depth--; });
    return p;
  }
  get pending(): number { return this.depth; }
}
