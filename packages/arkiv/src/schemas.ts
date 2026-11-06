// Arkiv schemas for PaisaLink. Arkiv is the only database (PLAN.md section 2).
// Attribute names are lowercase snake_case (node issue: uppercase names are unsafe, SDK #128).
// Only attributes the app filters or sorts on are indexed; the rest are stored and selectable.
import { addr, dec, defineSchema, str, u256, u64 } from "@arkiv-network/sdk/schema";

/** One merchant profile per wallet. No names, emails or World ID nullifiers. */
export const Merchants = defineSchema("paisalink.merchants", {
  wallet: addr().indexed(), // GET /merchants/:wallet
  handle: str().indexed(), // public handle lookup, uniqueness check
  verified: u64().indexed(), // 0/1; relayer allowlist = eq("verified", 1)
  gas_used_wei: u256(), // sponsored gas spent (relayer budget), stored only
  created_at: u64(), // unix seconds
});

/** One invoice; the payment link /pay/<invoice_id> reads this entity. */
export const Invoices = defineSchema("paisalink.invoices", {
  merchant: addr().indexed(), // dashboard list
  invoice_id: str().indexed(), // bytes32 hex, lowercase; checkout + receipt lookup
  state: str().indexed(), // open | paid | refunded | financed | settled
  amount_usdt: dec(),
  due_at: u64().indexed(), // unix seconds; "overdue" range queries
  memo: str(), // <= 128 bytes (str limit)
  swarm_ref: str().optional(), // Swarm reference of the invoice PDF (plain, never encrypted)
  pay_tx: str().optional(), // Whitechain tx hash of the payment
});

/** One payment per invoice; the receipt page /r/<invoice_id> reads this entity. */
export const Payments = defineSchema("paisalink.payments", {
  invoice_id: str().indexed(),
  merchant: addr().indexed(),
  payer: addr(),
  amount_usdt: dec(),
  tx_hash: str(),
  gasless: u64(), // 0/1
  paid_at: u64().indexed(), // unix seconds; accountant export by period
  refund_tx: str().optional(),
});

/** InvoiceNote mirror; the investor page reads this entity. */
export const Notes = defineSchema("paisalink.notes", {
  invoice_id: str().indexed(),
  note_id: u64().indexed(), // upsert lookup by onchain note id
  issuer: addr().indexed(), // merchant's financed invoices
  investor: addr().optional(),
  face_usdt: dec(),
  price_usdt: dec(),
  maturity: u64().indexed(), // unix seconds; "maturing soon" range queries
  state: str().indexed(), // issued | funded | settled
});

export const SCHEMAS = { merchant: Merchants, invoice: Invoices, payment: Payments, note: Notes } as const;
export type EntityKind = keyof typeof SCHEMAS;

/** Schema tag -> kind, for classifying entities seen by watchEntityEvents. */
export const KIND_BY_TAG: Record<string, EntityKind> = Object.fromEntries(
  Object.entries(SCHEMAS).map(([k, s]) => [s.name as string, k as EntityKind]),
);
