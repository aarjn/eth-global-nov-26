// S1 edge tests: relay error codes, window boundaries, rate-limit windows, budget reset, CSV round trip,
// and chain-id refusal of the testnet-only demo endpoints. Test-only fakes from ./fake-chain are used.
import { describe, expect, test } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Address } from "@paisalink/shared";
import { SlidingWindowLimiter, consumeAll } from "../src/ratelimit";
import { checkAuthorizationFields } from "../src/relayer";
import { notesRoutes } from "../src/routes/notes";
import { setup, testConfig, NOW_MS } from "./helpers";
import { ROUTER } from "./fake-chain";
import { invoicePaymentNonce } from "@paisalink/shared";

const j = async (r: Response) => (await r.json()) as any;
const paid = (s: Awaited<ReturnType<typeof setup>>) => s.chain.sent.filter((c) => c.fn === "payWithAuthorization");

describe("relay: every error code over HTTP", () => {
  test("MERCHANT_NOT_VERIFIED 403", async () => {
    const s = await setup({ verified: false });
    const inv = await s.createInvoice();
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId));
    expect(r.status).toBe(403);
    expect((await j(r)).code).toBe("MERCHANT_NOT_VERIFIED");
    expect(paid(s)).toHaveLength(0);
  });
  test("BUDGET_EXCEEDED 402 on /relay, nothing sent", async () => {
    const s = await setup({ env: { MERCHANT_DAILY_GAS_WBT: "0.001" } });
    const inv = await s.createInvoice(); // uses 0.0005
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId)); // needs 0.0006 > 0.0005 left
    expect(r.status).toBe(402);
    expect((await j(r)).code).toBe("BUDGET_EXCEEDED");
    expect(paid(s)).toHaveLength(0);
  });
  test("RATE_LIMITED 429 with Retry-After", async () => {
    const s = await setup({ env: { RL_PAYER_PER_HOUR: "1" } });
    const inv = await s.createInvoice();
    const body = await s.signAuth(inv.invoiceId, "48");
    expect((await s.post("/relay", body)).status).toBe(400);
    const r = await s.post("/relay", body);
    expect(r.status).toBe(429);
    expect((await j(r)).code).toBe("RATE_LIMITED");
    expect(r.headers.get("retry-after")).toBe("3600");
  });
  test("BAD_AUTHORIZATION 400", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId, "50"));
    expect(r.status).toBe(400);
    expect((await j(r)).code).toBe("BAD_AUTHORIZATION");
  });
  test("SIMULATION_FAILED 422", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    s.chain.revertNext = "boom";
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId));
    expect(r.status).toBe(422);
    expect((await j(r)).code).toBe("SIMULATION_FAILED");
  });
  test("BAD_REQUEST 400 for each malformed field", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const good = await s.signAuth(inv.invoiceId);
    const bads: unknown[] = [
      null, [], "x", {},
      { ...good, signature: "0x1234" },
      { ...good, signature: undefined },
      { ...good, invoiceId: "0x1234" },
      { ...good, authorization: { ...good.authorization, from: "0xnotanaddress" } },
      { ...good, authorization: { ...good.authorization, to: undefined } },
      { ...good, authorization: { ...good.authorization, value: "-1" } },
      { ...good, authorization: { ...good.authorization, value: "1.5" } },
      { ...good, authorization: { ...good.authorization, validBefore: "abc" } },
      { ...good, authorization: { ...good.authorization, nonce: "0x12" } },
      { ...good, authorization: undefined },
    ];
    for (const b of bads) {
      const r = await s.post("/relay", b);
      expect(r.status).toBe(400);
      expect((await j(r)).code).toBe("BAD_REQUEST");
    }
    expect(paid(s)).toHaveLength(0);
  });
  test("invalid JSON body -> BAD_REQUEST", async () => {
    const s = await setup();
    const r = await s.app.request("/relay", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(r.status).toBe(400);
    expect((await j(r)).code).toBe("BAD_REQUEST");
  });
});

describe("authorization window boundaries", () => {
  const id = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const o = { router: ROUTER, invoiceId: id, expectedValue: 49_000_000n, now: 1000, maxWindowSec: 600, minRemainingSec: 20 };
  const base = { from: ROUTER, to: ROUTER, value: "49000000", validAfter: 0, validBefore: 1300, nonce: invoicePaymentNonce(ROUTER, id) };
  test("validBefore exactly now+600 ok, now+601 refused", () => {
    expect(checkAuthorizationFields({ ...base, validBefore: 1600 }, o)).toBeNull();
    expect(checkAuthorizationFields({ ...base, validBefore: 1601 }, o)).not.toBeNull();
  });
  test("validBefore exactly now+20 ok, now+19 refused", () => {
    expect(checkAuthorizationFields({ ...base, validBefore: 1020 }, o)).toBeNull();
    expect(checkAuthorizationFields({ ...base, validBefore: 1019 }, o)).not.toBeNull();
  });
  test("validAfter == now ok, now+1 refused", () => {
    expect(checkAuthorizationFields({ ...base, validAfter: 1000 }, o)).toBeNull();
    expect(checkAuthorizationFields({ ...base, validAfter: 1001 }, o)).not.toBeNull();
  });
  test("value off by one base unit refused (both directions)", () => {
    expect(checkAuthorizationFields({ ...base, value: "49000001" }, o)).not.toBeNull();
    expect(checkAuthorizationFields({ ...base, value: "48999999" }, o)).not.toBeNull();
  });
  test("router address comparison is case-insensitive (checksummed vs lower)", () => {
    expect(checkAuthorizationFields({ ...base, to: ROUTER.toUpperCase().replace("0X", "0x") as Address }, o)).toBeNull();
  });
  test("over HTTP: window edges relay, outside is refused", async () => {
    const s = await setup();
    const a = await s.createInvoice();
    expect((await s.post("/relay", await s.signAuth(a.invoiceId, "49", { validBefore: s.nowSec() + 601 }))).status).toBe(400);
    expect((await s.post("/relay", await s.signAuth(a.invoiceId, "49", { validBefore: s.nowSec() + 19 }))).status).toBe(400);
    expect((await s.post("/relay", await s.signAuth(a.invoiceId, "49", { validBefore: s.nowSec() + 600 }))).status).toBe(200);
  });
});

describe("rate-limit windows", () => {
  test("sliding window: a hit frees exactly at windowMs, not before", () => {
    let t = 1_000;
    const l = new SlidingWindowLimiter(2, 10_000, () => t);
    l.hit("k"); t += 4_000; l.hit("k");
    expect(l.remaining("k")).toBe(0);
    expect(l.retryAfterSec("k")).toBe(6);
    t = 1_000 + 9_999; expect(l.remaining("k")).toBe(0);
    t = 1_000 + 10_000; expect(l.remaining("k")).toBe(1);
    t = 1_000 + 14_000; expect(l.remaining("k")).toBe(2);
    expect(l.retryAfterSec("k")).toBe(0);
  });
  test("keys are independent and empty keys are dropped", () => {
    let t = 0;
    const l = new SlidingWindowLimiter(1, 1_000, () => t);
    l.hit("a"); expect(l.remaining("b")).toBe(1);
    t = 2_000; expect(l.remaining("a")).toBe(1); expect(l.size()).toBe(0);
  });
  test("consumeAll does not consume the other limiters when one blocks", () => {
    const t = 0;
    const ip = new SlidingWindowLimiter(1, 1000, () => t), payer = new SlidingWindowLimiter(5, 1000, () => t);
    ip.hit("x");
    const blocked = consumeAll([{ limiter: payer, key: "p", name: "payer" }, { limiter: ip, key: "x", name: "ip" }]);
    expect(blocked?.name).toBe("ip");
    expect(payer.remaining("p")).toBe(5);
  });
  test("per-IP relay limit frees after the hour; limit is per address", async () => {
    const s = await setup({ env: { TRUST_PROXY: "1", RL_IP_PER_HOUR: "2" } });
    const inv = await s.createInvoice(); // invoice creation uses a different IP (9.9.9.9)
    const mk = async () => s.signAuth(inv.invoiceId, "48", {}, privateKeyToAccount(generatePrivateKey()));
    expect((await s.post("/relay", await mk(), "6.6.6.6")).status).toBe(400);
    expect((await s.post("/relay", await mk(), "6.6.6.6")).status).toBe(400);
    expect((await s.post("/relay", await mk(), "6.6.6.6")).status).toBe(429);
    s.advance(3_599_000);
    expect((await s.post("/relay", await mk(), "6.6.6.6")).status).toBe(429);
    s.advance(1_001);
    expect((await s.post("/relay", await mk(), "6.6.6.6")).status).toBe(400);
  });
  test("invoice creation: per-merchant hourly limit then reset", async () => {
    const s = await setup({ env: { RL_INVOICE_MERCHANT_PER_HOUR: "2" } });
    await s.createInvoice(); await s.createInvoice();
    const mk = () => s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "1", dueAt: s.nowSec() + 999, memo: "" });
    const r = await mk();
    expect(r.status).toBe(429);
    expect((await j(r)).code).toBe("RATE_LIMITED");
    s.advance(3_600_001);
    expect((await mk()).status).toBe(201);
  });
});

describe("gas budget reset", () => {
  test("resets at UTC midnight, not 24h after the first spend", async () => {
    // NOW_MS is 08:00:00Z; midnight is 16h later.
    expect(new Date(NOW_MS).toISOString()).toContain("T08:00:00");
    const s = await setup({ env: { MERCHANT_DAILY_GAS_WBT: "0.001" } });
    const inv = await s.createInvoice();
    s.advance(16 * 3_600_000 - 1);
    expect((await s.post("/relay", await s.signAuth(inv.invoiceId, "49", { validBefore: s.nowSec() + 300 }))).status).toBe(402);
    s.advance(1);
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId, "49", { validBefore: s.nowSec() + 300 }));
    expect(r.status).toBe(200);
  });
  test("budget is per merchant", async () => {
    const s = await setup({ env: { MERCHANT_DAILY_GAS_WBT: "0.001" } });
    const m2 = privateKeyToAccount(generatePrivateKey());
    await s.store.upsertMerchant({ wallet: m2.address, handle: "other", verified: true, gasUsedWei: "0", createdAt: 1 });
    const inv1 = await s.createInvoice();
    await s.createInvoice("5", m2.address);
    expect((await s.post("/relay", await s.signAuth(inv1.invoiceId))).status).toBe(402); // merchant 1 is out
    expect(s.relayer.budget.remainingToday(m2.address) > 0n).toBe(true);
  });
});

// Minimal RFC 4180 parser for the round trip.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

describe("CSV export end to end", () => {
  const memos = ['Logo, "v2" design', "₹4,000 नमस्ते 😀 café", 'quote " only', "=SUM(A1)", "plain"];
  test("commas, quotes and unicode survive; every row has 10 columns", async () => {
    const s = await setup();
    const ids: string[] = [];
    for (const memo of memos) {
      const r = await s.relayer.createInvoice({ merchant: s.merchantAcct.address, amountUsdt: "7", dueAt: s.nowSec() + 86400, memo }, "9.9.9.9");
      ids.push(r.invoiceId);
    }
    const res = await s.app.request(`/merchants/${s.merchantAcct.address}/export.csv`);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (res.text() strips it)
    const rows = parseCsv(await res.text());
    expect(rows[0]).toHaveLength(10);
    const body = rows.slice(1);
    expect(body).toHaveLength(memos.length);
    for (const r of body) expect(r).toHaveLength(10);
    const byId = new Map(body.map((r) => [r[1]!, r[2]!]));
    expect(byId.get(ids[0]!)).toBe(memos[0]!);
    expect(byId.get(ids[1]!)).toBe(memos[1]!);
    expect(byId.get(ids[2]!)).toBe(memos[2]!);
    expect(byId.get(ids[3]!)).toBe("'=SUM(A1)"); // formula neutralised
    expect(byId.get(ids[4]!)).toBe("plain");
  });
  test("memo byte limit counts UTF-8 bytes: 32 emoji (128 B) ok, 33 refused; control chars become spaces", async () => {
    const s = await setup();
    const mk = (memo: string) => s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "1", dueAt: s.nowSec() + 999, memo });
    expect((await mk("😀".repeat(32))).status).toBe(201);
    const r = await mk("😀".repeat(33));
    expect(r.status).toBe(400);
    const ok = await mk("a\nb\tc");
    expect((await j(ok)).memo).toBe("a b c");
  });
});

describe("testnet-only demo endpoints refuse other chains", () => {
  const other = () => privateKeyToAccount(generatePrivateKey()).address;
  for (const chainId of ["1", "11155111", "137", "7794095", "0"]) {
    test(`/demo/fund on WC_CHAIN_ID=${chainId} -> 503 NOT_CONFIGURED, no transfer`, async () => {
      const s = await setup({ env: { WC_CHAIN_ID: chainId } });
      const a = other();
      const r = await s.post("/demo/fund", { address: a });
      expect(r.status).toBe(503);
      const b = await j(r);
      expect(b.code).toBe("NOT_CONFIGURED");
      expect(b.demo).toBe(true);
      expect(await s.faucet.usdtBalance(a)).toBe(0n);
      expect((await j(await s.app.request("/config"))).demoFaucet ?? null).toBeNull();
    });
  }
  test("DEMO_FAUCET=1 cannot force-enable it off-testnet", async () => {
    const s = await setup({ env: { WC_CHAIN_ID: "1", DEMO_FAUCET: "1" } });
    const a = other();
    expect((await s.post("/demo/fund", { address: a })).status).toBe(503);
    expect(await s.faucet.usdtBalance(a)).toBe(0n);
  });
  test("config.demo.enabled only on 1874", () => {
    expect(testConfig({ WC_CHAIN_ID: "1874" }).demo.enabled).toBe(true);
    for (const c of ["1", "56", "1875", "18740"]) expect(testConfig({ WC_CHAIN_ID: c }).demo.enabled).toBe(false);
    expect(testConfig({ WC_CHAIN_ID: "1874", DEMO_FAUCET: "0" }).demo.enabled).toBe(false);
  });
  test("/notes/demo-investor on another chain -> 503 NOT_CONFIGURED before any chain call", async () => {
    const s = await setup({ env: { WC_CHAIN_ID: "1" } });
    const touched: string[] = [];
    const trap = new Proxy({}, { get: (_t, p) => { touched.push(String(p)); return () => { throw new Error("chain touched"); }; } });
    const ctx = { store: s.store, config: testConfig({ WC_CHAIN_ID: "1" }), relayer: s.relayer, notify: () => {} };
    s.app.route("/", notesRoutes(ctx as any, { chain: trap as any, now: () => NOW_MS }));
    const r = await s.post("/notes/demo-investor", { address: other() });
    expect(r.status).toBe(503);
    expect((await j(r)).code).toBe("NOT_CONFIGURED");
    expect(touched).toEqual([]);
  });
});

describe("security: unverified merchants and World nullifiers", () => {
  test("invoice for an unverified merchant is created but never relayed; self-pay path is not blocked by the API", async () => {
    const s = await setup({ verified: false });
    const inv = await s.createInvoice();
    expect(inv.state).toBe("open");
    for (let i = 0; i < 3; i++) {
      const r = await s.post("/relay", await s.signAuth(inv.invoiceId, "49", {}, privateKeyToAccount(generatePrivateKey())));
      expect(r.status).toBe(403);
    }
    expect(paid(s)).toHaveLength(0);
    expect((await s.store.getInvoice(inv.invoiceId))!.state).toBe("open");
  });
  test("verify flag is not settable through public routes (POST /invoices cannot pre-verify)", async () => {
    const s = await setup({ verified: false });
    const r = await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "1", dueAt: s.nowSec() + 999, memo: "", verified: true });
    expect(r.status).toBe(201);
    const inv = await j(r);
    expect((await s.post("/relay", await s.signAuth(inv.invoiceId, "1"))).status).toBe(403);
  });
});
