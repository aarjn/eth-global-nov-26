// Shared types. Frozen at 09:30 IST on 6 Nov (PLAN.md section 3). Change only via docs/handoffs.md.
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type InvoiceState = "open" | "paid" | "refunded" | "financed" | "settled";

export interface Invoice { invoiceId: Hex; merchant: Address; amountUsdt: string; dueAt: number; memo: string; state: InvoiceState; swarmRef?: string; payTx?: Hex; }
export interface Payment { invoiceId: Hex; merchant: Address; payer: Address; amountUsdt: string; txHash: Hex; gasless: boolean; paidAt: number; refundTx?: Hex; }
export interface Merchant { wallet: Address; handle: string; verified: boolean; gasUsedWei: string; createdAt: number; }
export interface Note { noteId: number; invoiceId: Hex; issuer: Address; investor?: Address; faceUsdt: string; priceUsdt: string; maturity: number; state: "issued" | "funded" | "settled"; }
export interface Eip3009Authorization { from: Address; to: Address; value: string; validAfter: number; validBefore: number; nonce: Hex; }
export interface RelayRequest { invoiceId: Hex; authorization: Eip3009Authorization; signature: Hex; }
export interface RelayResponse { txHash: Hex; explorerUrl: string; }
export type RelayErrorCode = "MERCHANT_NOT_VERIFIED" | "BUDGET_EXCEEDED" | "RATE_LIMITED" | "BAD_AUTHORIZATION" | "SIMULATION_FAILED";
export interface RelayError { error: string; code: RelayErrorCode; }

/** Storage interface. Production implementation: ArkivStore in @paisalink/arkiv (W4).
 *  Arkiv is the ONLY database. A MemoryStore may exist for unit tests only and must never be wired into the running app. */
export interface PaisaStore {
  upsertMerchant(m: Merchant): Promise<Merchant>;
  getMerchant(wallet: Address): Promise<Merchant | null>;
  setMerchantVerified(wallet: Address, verified: boolean): Promise<void>;
  addMerchantGasUsed(wallet: Address, weiDelta: bigint): Promise<void>;
  upsertInvoice(inv: Invoice): Promise<Invoice>;
  getInvoice(invoiceId: Hex): Promise<Invoice | null>;
  listInvoicesByMerchant(merchant: Address): Promise<Invoice[]>;
  recordPayment(p: Payment): Promise<Payment>;
  getPayment(invoiceId: Hex): Promise<Payment | null>;
  listPaymentsByMerchant(merchant: Address): Promise<Payment[]>;
  upsertNote(n: Note): Promise<Note>;
  listNotes(): Promise<Note[]>;
  /** Live updates (Arkiv watchEntityEvents over WebSocket). Returns an unsubscribe function. */
  watchMerchant(merchant: Address, onChange: (kind: "invoice" | "payment" | "note", id: string) => void): () => void;
}
