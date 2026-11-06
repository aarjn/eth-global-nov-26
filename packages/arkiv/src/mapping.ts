// Pure mapping between PaisaLink domain objects (@paisalink/shared) and Arkiv attribute values,
// plus the expiry policy. No I/O here, so it is unit-tested without a node.
import { ExpirationTime, MAX_LIFETIME } from "@arkiv-network/sdk";
import type { Expiry, FullRow, CreateEntityValues } from "@arkiv-network/sdk";
import { addr, dec, str, u256, u64 } from "@arkiv-network/sdk/schema";
import type { Address, Hex, Invoice, InvoiceState, Merchant, Note, Payment } from "@paisalink/shared";
import { getAddress } from "viem";
import { Invoices, Merchants, Notes, Payments } from "./schemas";

export const BLOCK_SECONDS = 2;
export const DAY = 24 * 60 * 60;

/** Lifetimes in days (PLAN.md section 2, "Arkiv: the only database"). */
export const TTL = {
  merchantDays: 180, // renewed on every merchant write (a lease kept alive by activity)
  invoiceAfterDueDays: 30, // an invoice lives until 30 days after it is due
  invoiceMinDays: 7, // an invoice due in the past still lives a week
  invoiceSettledDays: 90, // paid/refunded/financed/settled invoices stay for the refund window + accountant
  paymentDays: 90, // the receipt lives for the refund/dispute window
  noteAfterMaturityDays: 30,
} as const;

const INVOICE_STATES: readonly InvoiceState[] = ["open", "paid", "refunded", "financed", "settled"];
const NOTE_STATES: readonly Note["state"][] = ["issued", "funded", "settled"];

/** Natural ids are stored lowercase so eq() lookups match whatever case the caller used. */
export const normId = (id: string): string => id.toLowerCase();

const utf8Len = (s: string) => new TextEncoder().encode(s).length;
function checkStr(field: string, s: string, max = 128) {
  if (utf8Len(s) > max) throw new RangeError(`${field} is ${utf8Len(s)} bytes; Arkiv str attributes hold at most ${max}`);
  return str(s);
}
const bit = (b: boolean) => u64(b ? 1n : 0n);
const num = (v: { value: bigint }) => Number(v.value);

// ---------- expiry ----------

/** Lifetime in blocks from now until `untilSec`, clamped to [minDays, protocol max]. */
export function blocksUntil(untilSec: number, nowSec: number, minDays: number): bigint {
  const secs = Math.max(untilSec - nowSec, minDays * DAY);
  const blocks = BigInt(Math.ceil(secs / BLOCK_SECONDS));
  return blocks > MAX_LIFETIME ? MAX_LIFETIME : blocks;
}

export function merchantLifetime(): bigint {
  return BigInt((TTL.merchantDays * DAY) / BLOCK_SECONDS);
}
export function invoiceLifetime(inv: Pick<Invoice, "dueAt" | "state">, nowSec: number): bigint {
  const base = blocksUntil(inv.dueAt + TTL.invoiceAfterDueDays * DAY, nowSec, TTL.invoiceMinDays);
  if (inv.state === "open") return base;
  const settled = blocksUntil(nowSec + TTL.invoiceSettledDays * DAY, nowSec, 0);
  return base > settled ? base : settled;
}
export function paymentLifetime(): bigint {
  return BigInt((TTL.paymentDays * DAY) / BLOCK_SECONDS);
}
export function noteLifetime(n: Pick<Note, "maturity">, nowSec: number): bigint {
  return blocksUntil(n.maturity + TTL.noteAfterMaturityDays * DAY, nowSec, 1);
}
export const toExpiry = (blocks: bigint): Expiry => ExpirationTime.fromBlocks(Number(blocks));

// ---------- merchants ----------

export type MerchantValues = CreateEntityValues<typeof Merchants>;
export function merchantToValues(m: Merchant): MerchantValues {
  return {
    wallet: addr(m.wallet),
    handle: checkStr("handle", m.handle),
    verified: bit(m.verified),
    gas_used_wei: u256(BigInt(m.gasUsedWei)),
    created_at: u64(BigInt(m.createdAt)),
  };
}
export type MerchantRow = Pick<FullRow<typeof Merchants>, "wallet" | "handle" | "verified" | "gas_used_wei" | "created_at">;
export function merchantFromRow(r: MerchantRow): Merchant {
  return {
    wallet: getAddress(r.wallet.value),
    handle: r.handle.value,
    verified: r.verified.value === 1n,
    gasUsedWei: r.gas_used_wei.value.toString(),
    createdAt: num(r.created_at),
  };
}

// ---------- invoices ----------

export type InvoiceValues = CreateEntityValues<typeof Invoices>;
export function invoiceToValues(inv: Invoice): InvoiceValues {
  if (!INVOICE_STATES.includes(inv.state)) throw new RangeError(`unknown invoice state ${inv.state}`);
  return {
    merchant: addr(inv.merchant),
    invoice_id: str(normId(inv.invoiceId)),
    state: str(inv.state),
    amount_usdt: dec(inv.amountUsdt),
    due_at: u64(BigInt(inv.dueAt)),
    memo: checkStr("memo", inv.memo),
    ...(inv.swarmRef ? { swarm_ref: checkStr("swarmRef", inv.swarmRef) } : {}),
    ...(inv.payTx ? { pay_tx: str(normId(inv.payTx)) } : {}),
  };
}
export type InvoiceRow = Pick<FullRow<typeof Invoices>, "merchant" | "invoice_id" | "state" | "amount_usdt" | "due_at" | "memo" | "swarm_ref" | "pay_tx">;
export function invoiceFromRow(r: InvoiceRow): Invoice {
  const inv: Invoice = {
    invoiceId: r.invoice_id.value as Hex,
    merchant: getAddress(r.merchant.value),
    amountUsdt: r.amount_usdt.value,
    dueAt: num(r.due_at),
    memo: r.memo.value,
    state: r.state.value as InvoiceState,
  };
  if (r.swarm_ref) inv.swarmRef = r.swarm_ref.value;
  if (r.pay_tx) inv.payTx = r.pay_tx.value as Hex;
  return inv;
}

// ---------- payments ----------

export type PaymentValues = CreateEntityValues<typeof Payments>;
export function paymentToValues(p: Payment): PaymentValues {
  return {
    invoice_id: str(normId(p.invoiceId)),
    merchant: addr(p.merchant),
    payer: addr(p.payer),
    amount_usdt: dec(p.amountUsdt),
    tx_hash: str(normId(p.txHash)),
    gasless: bit(p.gasless),
    paid_at: u64(BigInt(p.paidAt)),
    ...(p.refundTx ? { refund_tx: str(normId(p.refundTx)) } : {}),
  };
}
export type PaymentRow = Pick<FullRow<typeof Payments>, "invoice_id" | "merchant" | "payer" | "amount_usdt" | "tx_hash" | "gasless" | "paid_at" | "refund_tx">;
export function paymentFromRow(r: PaymentRow): Payment {
  const p: Payment = {
    invoiceId: r.invoice_id.value as Hex,
    merchant: getAddress(r.merchant.value),
    payer: getAddress(r.payer.value),
    amountUsdt: r.amount_usdt.value,
    txHash: r.tx_hash.value as Hex,
    gasless: r.gasless.value === 1n,
    paidAt: num(r.paid_at),
  };
  if (r.refund_tx) p.refundTx = r.refund_tx.value as Hex;
  return p;
}

// ---------- notes ----------

export type NoteValues = CreateEntityValues<typeof Notes>;
export function noteToValues(n: Note): NoteValues {
  if (!NOTE_STATES.includes(n.state)) throw new RangeError(`unknown note state ${n.state}`);
  return {
    invoice_id: str(normId(n.invoiceId)),
    note_id: u64(BigInt(n.noteId)),
    issuer: addr(n.issuer),
    ...(n.investor ? { investor: addr(n.investor) } : {}),
    face_usdt: dec(n.faceUsdt),
    price_usdt: dec(n.priceUsdt),
    maturity: u64(BigInt(n.maturity)),
    state: str(n.state),
  };
}
export type NoteRow = Pick<FullRow<typeof Notes>, "invoice_id" | "note_id" | "issuer" | "investor" | "face_usdt" | "price_usdt" | "maturity" | "state">;
export function noteFromRow(r: NoteRow): Note {
  const n: Note = {
    noteId: num(r.note_id),
    invoiceId: r.invoice_id.value as Hex,
    issuer: getAddress(r.issuer.value),
    faceUsdt: r.face_usdt.value,
    priceUsdt: r.price_usdt.value,
    maturity: num(r.maturity),
    state: r.state.value as Note["state"],
  };
  if (r.investor) n.investor = getAddress(r.investor.value) as Address;
  return n;
}

// ---------- patch diff ----------

/**
 * The columns of `next` that differ from `prev` (both in attribute-value form), plus optional
 * columns present in `prev` but absent from `next`. Empty result = nothing to write, which saves a
 * transaction (the SDK throws EmptyPatchError on an empty patch).
 */
export function diffValues(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  optional: readonly string[],
): { set: Record<string, unknown>; unset: string[] } {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (canon(prev[k]) !== canon(v)) set[k] = v;
  }
  const unset = optional.filter((k) => prev[k] !== undefined && next[k] === undefined);
  return { set, unset };
}
function canon(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object" && "value" in (v as object)) v = (v as { value: unknown }).value;
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return v.toLowerCase();
  return String(v);
}
