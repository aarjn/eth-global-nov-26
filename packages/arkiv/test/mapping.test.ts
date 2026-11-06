import { describe, expect, test } from "bun:test";
import { MAX_LIFETIME } from "@arkiv-network/sdk";
import type { Invoice, Merchant, Note, Payment } from "@paisalink/shared";
import {
  DAY,
  diffValues,
  invoiceFromRow,
  invoiceLifetime,
  invoiceToValues,
  merchantFromRow,
  merchantLifetime,
  merchantToValues,
  noteFromRow,
  noteLifetime,
  noteToValues,
  paymentFromRow,
  paymentToValues,
  blocksUntil,
} from "../src/mapping";
import { Invoices, KIND_BY_TAG, Merchants, Notes, Payments } from "../src/schemas";

const M = "0xC038827b4E362B0de1Be859377508613CD028946" as const;
const P = "0x32c84603C9848FFa470FB07C9bCe820944D04c52" as const;
const I = "0xe7CfE30ED69450427FFf6bbBe143E5da71E4AF87" as const;
const ID = ("0x" + "AB".repeat(32)) as `0x${string}`;
const TX = ("0x" + "cd".repeat(32)) as `0x${string}`;

describe("schemas", () => {
  test("tags are project-unique and map back to kinds", () => {
    expect(Merchants.name).toBe("paisalink.merchants");
    expect(KIND_BY_TAG["paisalink.invoices"]).toBe("invoice");
    expect(KIND_BY_TAG["paisalink.payments"]).toBe("payment");
    expect(KIND_BY_TAG["paisalink.notes"]).toBe("note");
  });
  test("attribute names are lowercase (arkiv-sdk-js #128)", () => {
    for (const s of [Merchants, Invoices, Payments, Notes]) {
      for (const k of Object.keys(s.columns)) expect(k).toBe(k.toLowerCase());
    }
  });
  test("indexed columns are exactly the ones the app filters on", () => {
    const idx = (s: typeof Invoices | typeof Merchants | typeof Payments | typeof Notes) =>
      Object.entries(s.columns).filter(([, c]) => c.isIndexed).map(([k]) => k).sort();
    expect(idx(Merchants)).toEqual(["handle", "verified", "wallet"]);
    expect(idx(Invoices)).toEqual(["due_at", "invoice_id", "merchant", "state"]);
    expect(idx(Payments)).toEqual(["invoice_id", "merchant", "paid_at"]);
    expect(idx(Notes)).toEqual(["invoice_id", "issuer", "maturity", "note_id", "state"]);
  });
});

describe("round trips (domain -> attributes -> domain)", () => {
  test("merchant", () => {
    const m: Merchant = { wallet: M, handle: "chai-studio", verified: true, gasUsedWei: "123456789012345678901", createdAt: 1762400000 };
    const v = merchantToValues(m);
    expect(v.verified).toMatchObject({ type: "u64", value: 1n });
    expect(v.gas_used_wei).toMatchObject({ type: "u256", value: 123456789012345678901n });
    expect(merchantFromRow(v as never)).toEqual(m);
    expect(merchantFromRow(merchantToValues({ ...m, verified: false }) as never).verified).toBe(false);
  });

  test("invoice: ids lowercased, amount canonical, optionals omitted when absent", () => {
    const inv: Invoice = { invoiceId: ID, merchant: M, amountUsdt: "49.50", dueAt: 1765000000, memo: "Logo design", state: "open" };
    const v = invoiceToValues(inv);
    expect(v.invoice_id).toMatchObject({ type: "str", value: ID.toLowerCase() });
    expect("swarm_ref" in v).toBe(false);
    expect("pay_tx" in v).toBe(false);
    const back = invoiceFromRow(v as never);
    expect(back).toEqual({ ...inv, invoiceId: ID.toLowerCase() as `0x${string}`, amountUsdt: "49.5" });
  });

  test("invoice with swarm ref and pay tx", () => {
    const inv: Invoice = { invoiceId: ID, merchant: M, amountUsdt: "1", dueAt: 1, memo: "", state: "paid", swarmRef: "a".repeat(64), payTx: TX };
    const back = invoiceFromRow(invoiceToValues(inv) as never);
    expect(back.swarmRef).toBe("a".repeat(64));
    expect(back.payTx).toBe(TX);
    expect(back.state).toBe("paid");
  });

  test("invoice rejects a memo over 128 bytes and unknown states", () => {
    const base: Invoice = { invoiceId: ID, merchant: M, amountUsdt: "1", dueAt: 1, memo: "x", state: "open" };
    expect(() => invoiceToValues({ ...base, memo: "₹".repeat(43) })).toThrow(/128/); // 129 bytes
    expect(() => invoiceToValues({ ...base, state: "lost" as never })).toThrow(/state/);
  });

  test("payment", () => {
    const p: Payment = { invoiceId: ID.toLowerCase() as `0x${string}`, merchant: M, payer: P, amountUsdt: "49", txHash: TX, gasless: true, paidAt: 1762400100 };
    expect(paymentFromRow(paymentToValues(p) as never)).toEqual(p);
    const r = paymentFromRow(paymentToValues({ ...p, gasless: false, refundTx: TX }) as never);
    expect(r.gasless).toBe(false);
    expect(r.refundTx).toBe(TX);
  });

  test("note", () => {
    const n: Note = { noteId: 7, invoiceId: ID.toLowerCase() as `0x${string}`, issuer: M, faceUsdt: "1000", priceUsdt: "970.25", maturity: 1765000000, state: "issued" };
    expect(noteFromRow(noteToValues(n) as never)).toEqual(n);
    expect(noteFromRow(noteToValues({ ...n, investor: I, state: "funded" }) as never).investor).toBe(I);
  });

  test("addresses come back checksummed whatever case went in", () => {
    const m: Merchant = { wallet: M.toLowerCase() as `0x${string}`, handle: "x", verified: false, gasUsedWei: "0", createdAt: 0 };
    expect(merchantFromRow(merchantToValues(m) as never).wallet).toBe(M);
  });
});

describe("expiry policy", () => {
  const now = 1_762_400_000;
  test("merchant lives 180 days", () => {
    expect(merchantLifetime()).toBe(BigInt((180 * DAY) / 2));
  });
  test("open invoice lives until due + 30 days", () => {
    expect(invoiceLifetime({ dueAt: now + 10 * DAY, state: "open" }, now)).toBe(BigInt((40 * DAY) / 2));
  });
  test("overdue open invoice still gets the 7-day floor", () => {
    expect(invoiceLifetime({ dueAt: now - 100 * DAY, state: "open" }, now)).toBe(BigInt((7 * DAY) / 2));
  });
  test("paid invoice lives at least 90 days from now", () => {
    expect(invoiceLifetime({ dueAt: now, state: "paid" }, now)).toBe(BigInt((90 * DAY) / 2));
  });
  test("lifetimes are capped at the protocol max (~182.5 days)", () => {
    expect(invoiceLifetime({ dueAt: now + 400 * DAY, state: "open" }, now)).toBe(MAX_LIFETIME);
    expect(blocksUntil(now + 10_000 * DAY, now, 0)).toBe(MAX_LIFETIME);
  });
  test("note lives until maturity + 30 days", () => {
    expect(noteLifetime({ maturity: now + 30 * DAY }, now)).toBe(BigInt((60 * DAY) / 2));
  });
});

describe("diffValues", () => {
  test("only changed columns are set; address case and typed wrappers do not count as changes", () => {
    const prev = { state: { type: "str", value: "open" }, merchant: { type: "addr", value: M }, memo: { type: "str", value: "a" } };
    const next = { state: "paid", merchant: { type: "addr", value: M.toLowerCase() }, memo: { type: "str", value: "a" } };
    expect(diffValues(prev, next, [])).toEqual({ set: { state: "paid" }, unset: [] });
  });
  test("optional columns dropped from next are unset", () => {
    const prev = { swarm_ref: { type: "str", value: "x" }, state: "open" };
    expect(diffValues(prev, { state: "open" }, ["swarm_ref", "pay_tx"])).toEqual({ set: {}, unset: ["swarm_ref"] });
  });
  test("bigint-valued columns compare by value", () => {
    expect(diffValues({ due_at: { type: "u64", value: 5n } }, { due_at: { type: "u64", value: 5n } }, [])).toEqual({ set: {}, unset: [] });
    expect(Object.keys(diffValues({ due_at: { type: "u64", value: 5n } }, { due_at: { type: "u64", value: 6n } }, []).set)).toEqual(["due_at"]);
  });
});
