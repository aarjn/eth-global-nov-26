import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { setup } from "./helpers";

describe("HTTP routes", () => {
  test("GET /health reports chain, contracts, relayer balance, budget", async () => {
    const s = await setup();
    const j = (await (await s.app.request("/health")).json()) as any;
    expect(j.ok).toBe(true);
    expect(j.chains.whitechain).toEqual({ expected: 1874, rpc: 1874 });
    expect(j.chains.arkiv.chainId).toBe(7794095);
    expect(j.contracts.usdt).toBe("0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
    expect(j.relayer.balanceWbt).toBe("0.5");
    expect(j.budget.perMerchantDailyWbt).toBe("0.02");
    expect(j.demoFaucet.label).toContain("Testnet demo");
  });

  test("CORS preflight is answered", async () => {
    const s = await setup();
    const r = await s.app.request("/relay", { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("GET /merchants/:wallet/export.csv returns a downloadable CSV", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    await s.post("/relay", await s.signAuth(inv.invoiceId));
    const r = await s.app.request(`/merchants/${s.merchantAcct.address}/export.csv`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const text = await r.text();
    expect(text).toContain(inv.invoiceId);
    expect(text).toContain(",paid,");
  });

  test("POST /demo/fund: labelled demo, 1 per address, 5 per IP per hour", async () => {
    const s = await setup({ env: { TRUST_PROXY: "1" } });
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const r = await s.post("/demo/fund", { address: a }, "5.5.5.5");
    const j = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(j.demo).toBe(true);
    expect(j.amountUsdt).toBe("60");
    expect(await s.faucet.usdtBalance(a)).toBe(60_000_000n);
    expect(((await (await s.post("/demo/fund", { address: a }, "5.5.5.6")).json()) as any).code).toBe("DEMO_FAUCET_LIMIT");
    for (let i = 0; i < 4; i++) expect((await s.post("/demo/fund", { address: privateKeyToAccount(generatePrivateKey()).address }, "5.5.5.5")).status).toBe(200);
    const sixth = await s.post("/demo/fund", { address: privateKeyToAccount(generatePrivateKey()).address }, "5.5.5.5");
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as any).demo).toBe(true);
  });

  test("GET /invoices/:id/receipt returns invoice, payment, merchant", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    await s.post("/relay", await s.signAuth(inv.invoiceId));
    const j = (await (await s.app.request(`/invoices/${inv.invoiceId}/receipt`)).json()) as any;
    expect(j.invoice.state).toBe("paid");
    expect(j.payment.payer).toBe(s.payerAcct.address);
    expect(j.merchant.handle).toBe("chai-studio");
    expect(j.links.payTx).toContain("/tx/0x");
  });

  test("SSE /merchants/:wallet/events pushes unnamed {kind,id} messages", async () => {
    const s = await setup();
    const ac = new AbortController();
    const r = await s.app.request(`/merchants/${s.merchantAcct.address}/events`, { signal: ac.signal });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const until = async (pred: (b: string) => boolean) => { while (!pred(buf)) { const { value } = await reader.read(); buf += dec.decode(value); } };
    await until((b) => b.includes("event: ready"));
    const inv = await s.createInvoice();
    await until((b) => b.includes(inv.invoiceId));
    const line = buf.split("\n").find((l) => l.startsWith("data: ") && l.includes(inv.invoiceId))!;
    expect(JSON.parse(line.slice(6))).toEqual({ kind: "invoice", id: inv.invoiceId, source: "api" });
    ac.abort();
    await reader.cancel().catch(() => {});
  });

  test("arkivUrl is added when the store knows the entity key; note kind reaches SSE", async () => {
    const s = await setup();
    (s.store as any).explorerUrlFor = (kind: string, id: string) => `https://rabdi.explorer.arkiv.network/entity/0x${kind}-${id.slice(2, 6)}`;
    const inv = await s.createInvoice();
    const r = await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "3", dueAt: s.nowSec() + 999 });
    expect(((await r.json()) as any).arkivUrl).toContain("rabdi.explorer.arkiv.network/entity/0xinvoice-");
    const g = (await (await s.app.request(`/invoices/${inv.invoiceId}`)).json()) as any;
    expect(g.arkivUrl).toContain("/entity/0xinvoice-");
    const rec = (await (await s.app.request(`/invoices/${inv.invoiceId}/receipt`)).json()) as any;
    expect(rec.merchant.arkivUrl).toContain("/entity/0xmerchant-");

    const ac = new AbortController();
    const res = await s.app.request(`/merchants/${s.merchantAcct.address}/events`, { signal: ac.signal });
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
    const until = async (p: (b: string) => boolean) => { while (!p(buf)) buf += dec.decode((await reader.read()).value); };
    await until((b) => b.includes("event: ready"));
    s.relayer.notify(s.merchantAcct.address, "note", inv.invoiceId);
    await until((b) => b.includes('"kind":"note"'));
    ac.abort(); await reader.cancel().catch(() => {});
  });

  test("unknown route and bad JSON return error codes", async () => {
    const s = await setup();
    expect(((await (await s.app.request("/nope")).json()) as any).code).toBe("NOT_FOUND");
    const r = await s.app.request("/relay", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    expect(((await r.json()) as any).code).toBe("BAD_REQUEST");
  });
});
