// TEST-ONLY in-memory PaisaStore. Never wired into the running server (src/index.ts uses createArkivStore).
import type { Address, Hex, Invoice, Merchant, Note, PaisaStore, Payment } from "@paisalink/shared";

export class MemoryStore implements PaisaStore {
  merchants = new Map<string, Merchant>();
  invoices = new Map<string, Invoice>();
  payments = new Map<string, Payment>();
  notes = new Map<number, Note>();
  failWrites = 0; // make the next N writes throw (to test retries)
  private maybeFail() { if (this.failWrites > 0) { this.failWrites--; throw new Error("simulated store outage"); } }

  async upsertMerchant(m: Merchant) { this.maybeFail(); this.merchants.set(m.wallet.toLowerCase(), { ...m }); return m; }
  async getMerchant(w: Address) { return this.merchants.get(w.toLowerCase()) ?? null; }
  async setMerchantVerified(w: Address, v: boolean) { const m = this.merchants.get(w.toLowerCase()); if (m) m.verified = v; }
  async addMerchantGasUsed(w: Address, d: bigint) { this.maybeFail(); const m = this.merchants.get(w.toLowerCase()); if (m) m.gasUsedWei = (BigInt(m.gasUsedWei) + d).toString(); }
  async upsertInvoice(i: Invoice) { this.maybeFail(); this.invoices.set(i.invoiceId.toLowerCase(), { ...i }); return i; }
  async getInvoice(id: Hex) { const i = this.invoices.get(id.toLowerCase()); return i ? { ...i } : null; }
  async listInvoicesByMerchant(m: Address) { return [...this.invoices.values()].filter((i) => i.merchant.toLowerCase() === m.toLowerCase()); }
  async recordPayment(p: Payment) { this.maybeFail(); this.payments.set(p.invoiceId.toLowerCase(), { ...p }); return p; }
  async getPayment(id: Hex) { return this.payments.get(id.toLowerCase()) ?? null; }
  async listPaymentsByMerchant(m: Address) { return [...this.payments.values()].filter((p) => p.merchant.toLowerCase() === m.toLowerCase()); }
  async upsertNote(n: Note) { this.notes.set(n.noteId, n); return n; }
  async listNotes() { return [...this.notes.values()]; }
  watchMerchant() { return () => {}; }
}
