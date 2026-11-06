import type { Address } from "@paisalink/shared";

/** Per-merchant daily sponsored-gas budget (UTC day). Tracked in memory; the cumulative total is also
 *  written to the merchant entity on Arkiv (gas_used_wei) after every confirmed tx.
 *  Reservations stop two concurrent requests from both passing the check. */
export class GasBudget {
  private used = new Map<string, bigint>();     // `${day}:${merchant}` -> confirmed wei
  private reserved = new Map<string, bigint>(); // `${day}:${merchant}` -> in-flight estimate wei
  private nextId = 1;
  private open = new Map<number, { k: string; wei: bigint }>();

  constructor(readonly dailyLimitWei: bigint, private now: () => number = Date.now) {}

  private k(m: Address) { return `${new Date(this.now()).toISOString().slice(0, 10)}:${m.toLowerCase()}`; }

  usedToday(m: Address): bigint { return this.used.get(this.k(m)) ?? 0n; }
  reservedToday(m: Address): bigint { return this.reserved.get(this.k(m)) ?? 0n; }
  remainingToday(m: Address): bigint {
    const r = this.dailyLimitWei - this.usedToday(m) - this.reservedToday(m);
    return r > 0n ? r : 0n;
  }

  /** Reserve an estimated cost. Returns a reservation id, or null if it would exceed the daily limit. */
  reserve(m: Address, estimateWei: bigint): number | null {
    if (estimateWei > this.remainingToday(m)) return null;
    const k = this.k(m);
    this.reserved.set(k, (this.reserved.get(k) ?? 0n) + estimateWei);
    const id = this.nextId++;
    this.open.set(id, { k, wei: estimateWei });
    return id;
  }
  /** Release the reservation and record the actual cost (0 if the tx never landed). */
  settle(id: number, actualWei: bigint): void {
    const r = this.open.get(id);
    if (!r) return;
    this.open.delete(id);
    this.reserved.set(r.k, (this.reserved.get(r.k) ?? 0n) - r.wei);
    if (actualWei > 0n) this.used.set(r.k, (this.used.get(r.k) ?? 0n) + actualWei);
  }
  /** Today's per-merchant usage, for /health. */
  snapshot(): { merchant: string; usedWei: string; reservedWei: string }[] {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const out: { merchant: string; usedWei: string; reservedWei: string }[] = [];
    for (const [k, v] of this.used) if (k.startsWith(day)) out.push({ merchant: k.slice(11), usedWei: v.toString(), reservedWei: (this.reserved.get(k) ?? 0n).toString() });
    return out;
  }
}
