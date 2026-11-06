// Route tests for apps/api/src/routes/merchants.ts with a TEST-ONLY in-memory store.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Address, Hex, Invoice, Merchant, PaisaStore, Payment } from "@paisalink/shared";
import { merchantsRoutes } from "../../../apps/api/src/routes/merchants.ts";

const M = "0xC038827b4E362B0de1Be859377508613CD028946" as Address;
const OTHER = "0x32c84603C9848FFa470FB07C9bCe820944D04c52" as Address;

function fakeStore() {
  const merchants = new Map<string, Merchant>();
  const invoices: Invoice[] = [];
  const store = {
    async upsertMerchant(m: Merchant) { merchants.set(m.wallet.toLowerCase(), m); return m; },
    async getMerchant(w: Address) { return merchants.get(w.toLowerCase()) ?? null; },
    async getMerchantByHandle(h: string) { return [...merchants.values()].find((m) => m.handle === h) ?? null; },
    async setMerchantVerified(w: Address, v: boolean) { const m = merchants.get(w.toLowerCase()); if (m) m.verified = v; },
    async addMerchantGasUsed() {},
    async upsertInvoice(i: Invoice) { invoices.push(i); return i; },
    async getInvoice(id: Hex) { return invoices.find((i) => i.invoiceId === id) ?? null; },
    async listInvoicesByMerchant(m: Address) { return invoices.filter((i) => i.merchant === m); },
    async recordPayment(p: Payment) { return p; },
    async getPayment() { return null; },
    async listPaymentsByMerchant() { return []; },
    async upsertNote(n: never) { return n; },
    async listNotes() { return []; },
    watchMerchant() { return () => {}; },
  } satisfies PaisaStore & { getMerchantByHandle: unknown };
  return { store, merchants, invoices };
}

let s: ReturnType<typeof fakeStore>;
let app: ReturnType<typeof merchantsRoutes>;
beforeEach(() => {
  s = fakeStore();
  app = merchantsRoutes(s.store);
});
const post = (body: unknown) =>
  app.request("/merchants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /merchants", () => {
  test("creates a merchant (201), lowercases handle, checksums wallet", async () => {
    const r = await post({ wallet: M.toLowerCase(), handle: "Chai-Studio" });
    expect(r.status).toBe(201);
    const m = (await r.json()) as Merchant;
    expect(m).toMatchObject({ wallet: M, handle: "chai-studio", verified: false, gasUsedWei: "0" });
    expect(m.createdAt).toBeGreaterThan(1_700_000_000);
  });

  test("upsert keeps verified, gas used and created_at (200)", async () => {
    s.merchants.set(M.toLowerCase(), { wallet: M, handle: "old", verified: true, gasUsedWei: "42", createdAt: 1 });
    const r = await post({ wallet: M, handle: "new-name" });
    expect((await post({ wallet: OTHER, handle: "priya.designs_2" })).status).toBe(201);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ wallet: M, handle: "new-name", verified: true, gasUsedWei: "42", createdAt: 1 });
  });

  test("rejects a handle owned by another wallet (409)", async () => {
    s.merchants.set(OTHER.toLowerCase(), { wallet: OTHER, handle: "taken", verified: false, gasUsedWei: "0", createdAt: 1 });
    const r = await post({ wallet: M, handle: "taken" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("HANDLE_TAKEN");
  });

  test("validates input (400)", async () => {
    for (const body of [{ wallet: "nope", handle: "abc" }, { wallet: M, handle: "a" }, { wallet: M, handle: "-bad-" }, { wallet: M, handle: "has space" }, { wallet: M, handle: "x".repeat(33) }, {}]) {
      const r = await post(body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe("BAD_REQUEST");
    }
    const r = await app.request("/merchants", { method: "POST", body: "not json" });
    expect(r.status).toBe(400);
  });

  test("Arkiv failures map to 503 / 429", async () => {
    s.store.upsertMerchant = async () => { throw new Error("node stalled"); };
    expect((await post({ wallet: M, handle: "abc" })).status).toBe(503);
    s.store.upsertMerchant = async () => { const e = new Error("429"); e.name = "ArkivRateLimitedError"; throw e; };
    const r = await post({ wallet: M, handle: "abc" });
    expect(r.status).toBe(429);
    expect(((await r.json()) as { code: string }).code).toBe("ARKIV_RATE_LIMITED");
  });
});

describe("GET /merchants/:wallet[/invoices]", () => {
  test("404 for an unknown merchant, 200 for a known one", async () => {
    expect((await app.request(`/merchants/${M}`)).status).toBe(404);
    s.merchants.set(M.toLowerCase(), { wallet: M, handle: "chai", verified: false, gasUsedWei: "0", createdAt: 1 });
    expect(((await (await app.request(`/merchants/${M.toLowerCase()}`)).json()) as Merchant).handle).toBe("chai");
  });

  test("lists invoices with an optional state filter", async () => {
    const base = { merchant: M, amountUsdt: "1", dueAt: 1, memo: "" } as const;
    s.invoices.push({ ...base, invoiceId: "0x01", state: "open" }, { ...base, invoiceId: "0x02", state: "paid" });
    const all = (await (await app.request(`/merchants/${M}/invoices`)).json()) as Invoice[];
    expect(all.map((i) => i.invoiceId)).toEqual(["0x01", "0x02"]);
    const paid = (await (await app.request(`/merchants/${M}/invoices?state=paid`)).json()) as Invoice[];
    expect(paid.map((i) => i.invoiceId)).toEqual(["0x02"]);
    expect((await app.request(`/merchants/${M}/invoices?state=lost`)).status).toBe(400);
    expect((await app.request(`/merchants/0x123/invoices`)).status).toBe(400);
  });
});
