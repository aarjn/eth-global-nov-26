// W7 tests: invoice PDF rendering, Swarm config, POST /invoices/:id/pdf.
// The Swarm client below is a TEST-ONLY fake (never used by the running server). The live upload test at the bottom
// talks to the real public gateway and runs only with SWARM_LIVE=1.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Hex, Invoice } from "@paisalink/shared";
import { ApiError } from "../src/errors";
import { formatDueDate, formatUsdt, pdfRoutes, renderInvoicePdf, toWinAnsi, wrapText } from "../src/pdf";
import * as swarmMod from "../src/swarm";
import { assertPlainReference, createSwarmClient, loadSwarmConfig, PUBLIC_GATEWAY, safeUrl, swarmRoutes, ZERO_BATCH, type SwarmClient, type SwarmConfig } from "../src/swarm";
import type { PluginContext } from "../src/plugins";
import { testConfig } from "./helpers";
import { MemoryStore } from "./memory-store";

const MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946" as const;
const ID = `0x${"ab".repeat(32)}` as Hex;
const inv = (over: Partial<Invoice> = {}): Invoice => ({
  invoiceId: ID, merchant: MERCHANT, amountUsdt: "49.5", dueAt: 1_794_268_799, memo: "2 x masala chai", state: "open", ...over,
});

const CFG: SwarmConfig = { beeUrl: "https://bee.test", batchId: "11".repeat(32), publicGateway: false, readBase: "https://gw.test/bzz", timeoutMs: 1000 };

/** TEST-ONLY fake Swarm client: records uploads, returns a hash-derived 64-hex reference. */
class FakeSwarm implements SwarmClient {
  config = CFG;
  uploads: { bytes: Uint8Array; name: string; type: string }[] = [];
  fail = false;
  encrypted = false;
  async upload(data: Uint8Array, name: string, contentType: string) {
    if (this.fail) throw new swarmMod.SwarmUploadError("Swarm upload via https://bee.test failed: 402 payment required");
    this.uploads.push({ bytes: data, name, type: contentType });
    const h = new Bun.CryptoHasher("sha256").update(data).digest("hex");
    const reference = assertPlainReference(this.encrypted ? h + h : h);
    return { reference, url: `${CFG.readBase}/${reference}/`, bytes: data.byteLength };
  }
  async download(): Promise<never> { throw new Error("not used"); }
  async health() { return true; }
}

async function setup(opts: { swarm?: SwarmClient | null; env?: Record<string, string> } = {}) {
  const store = new MemoryStore();
  await store.upsertMerchant({ wallet: MERCHANT, handle: "chai-studio", verified: true, gasUsedWei: "0", createdAt: 1 });
  await store.upsertInvoice(inv());
  const notes: string[] = [];
  const ctx = { store, config: testConfig(), relayer: {} as never, notify: (_m: string, k: string, id: string) => { notes.push(`${k}:${id}`); } } as unknown as PluginContext;
  const swarm = opts.swarm === undefined ? new FakeSwarm() : opts.swarm;
  const app = new Hono();
  // Same error mapping as apps/api/src/app.ts.
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (typeof err.extra.retryAfterSec === "number") c.header("Retry-After", String(err.extra.retryAfterSec));
      return c.json(err.toJSON(), err.status as 400);
    }
    return c.json({ error: String(err), code: "INTERNAL" }, 500);
  });
  app.route("/", pdfRoutes(ctx, { swarm, env: { PUBLIC_APP_URL: "https://paisalink.test/", ...opts.env } }));
  return { app, store, notes, swarm };
}

describe("formatting", () => {
  test("USDT amounts", () => {
    expect(formatUsdt("49.5")).toBe("49.50");
    expect(formatUsdt("1000")).toBe("1,000.00");
    expect(formatUsdt("1234567.123456")).toBe("1,234,567.123456");
    expect(formatUsdt("0.05")).toBe("0.05");
  });
  test("due date is UTC", () => {
    expect(formatDueDate(1_794_268_799)).toBe("9 Nov 2026");
  });
  test("non-WinAnsi characters are replaced, not thrown", async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    expect(toWinAnsi("Chai ₹40 — thanks अ", f)).toBe("Chai Rs 40 — thanks ?");
    const lines = wrapText("a ".repeat(200) + "x".repeat(300), f, 11, 200);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 11)).toBeLessThanOrEqual(200);
  });
});

describe("renderInvoicePdf", () => {
  test("valid one-page PDF with metadata, deterministic bytes", async () => {
    const input = { invoice: inv({ memo: "Unicode memo ₹ अच्छा\nsecond line" }), merchantHandle: "chai-studio", payUrl: `https://paisalink.test/pay/${ID}` };
    const a = await renderInvoicePdf(input);
    const b = await renderInvoicePdf(input);
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe("%PDF-");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const doc = await PDFDocument.load(a, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe(`PaisaLink invoice ${ID.slice(0, 10)}`);
    expect(doc.getCreationDate()).toBeUndefined(); // no timestamps -> same invoice, same Swarm reference
    // The pay link is a clickable URI annotation.
    expect(Buffer.from(a).toString("latin1")).toContain(`/URI (https://paisalink.test/pay/${ID})`);
  });
  test("different invoice data gives different bytes; no pay link when no app URL", async () => {
    const a = await renderInvoicePdf({ invoice: inv(), merchantHandle: null, payUrl: null });
    const b = await renderInvoicePdf({ invoice: inv({ amountUsdt: "50" }), merchantHandle: null, payUrl: null });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).toString("latin1")).not.toContain("/URI");
  });
});

describe("swarm config", () => {
  test("unset BEE_URL -> public gateway with zero batch", () => {
    const c = loadSwarmConfig({})!;
    expect(c.beeUrl).toBe(PUBLIC_GATEWAY);
    expect(c.publicGateway).toBe(true);
    expect(c.batchId).toBe(ZERO_BATCH);
    expect(c.readBase).toBe(`${PUBLIC_GATEWAY}/bzz`);
  });
  test("own Bee node needs a batch; SWARM_DISABLED turns it off; bad batch throws", () => {
    expect(loadSwarmConfig({ BEE_URL: "http://localhost:1633" })).toBeNull();
    expect(loadSwarmConfig({ SWARM_DISABLED: "1" })).toBeNull();
    const c = loadSwarmConfig({ BEE_URL: "http://localhost:1633/", BEE_BATCH_ID: `0x${"AB".repeat(32)}` })!;
    expect(c).toMatchObject({ beeUrl: "http://localhost:1633", batchId: "ab".repeat(32), publicGateway: false });
    expect(() => loadSwarmConfig({ BEE_URL: "http://x", BEE_BATCH_ID: "123" })).toThrow();
  });
  test("encrypted (128-hex) references are refused", () => {
    expect(assertPlainReference("AA".repeat(32))).toBe("aa".repeat(32));
    expect(() => assertPlainReference("aa".repeat(64))).toThrow(/encrypted/);
    expect(() => assertPlainReference("nope")).toThrow();
  });
  test("safeUrl strips credentials and query", () => {
    expect(safeUrl("https://user:pw@bee.example.com/api/?token=x")).toBe("https://bee.example.com/api");
  });
  test("swarm.ts does not export pdfRoutes (plugins.ts would mount it twice)", () => {
    expect("pdfRoutes" in swarmMod).toBe(false);
    expect(typeof swarmRoutes).toBe("function");
  });
  test("GET /swarm/status shows no secrets", async () => {
    const res = await swarmRoutes(undefined, { SWARM_DISABLED: "1" }).request("/swarm/status");
    expect(await res.json()).toMatchObject({ configured: false });
  });
});

describe("routes", () => {
  test("GET /invoices/:id/pdf returns the PDF without uploading", async () => {
    const { app, swarm } = await setup();
    const res = await app.request(`/invoices/${ID}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect((swarm as FakeSwarm).uploads.length).toBe(0);
  });

  test("POST uploads, stores the plain ref on the invoice, notifies; repeat is cached", async () => {
    const { app, store, notes, swarm } = await setup();
    const res = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json() as { swarmRef: string; url: string; stored: boolean; sha256: string };
    expect(body.swarmRef).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toBe(`https://gw.test/bzz/${body.swarmRef}/`);
    expect(body.stored).toBe(true);
    const fake = swarm as FakeSwarm;
    expect(fake.uploads[0]!.type).toBe("application/pdf");
    expect(fake.uploads[0]!.name).toBe(`paisalink-invoice-${ID.slice(2, 10)}.pdf`);
    const saved = await store.getInvoice(ID);
    expect(saved).toMatchObject({ swarmRef: body.swarmRef, state: "open", amountUsdt: "49.5" });
    expect(notes).toEqual([`invoice:${ID}`]);

    const again = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ swarmRef: body.swarmRef, cached: true });
    expect(fake.uploads.length).toBe(1);

    // force=1 re-uploads; deterministic bytes -> same ref -> no store write, no notify.
    const forced = await app.request(`/invoices/${ID}/pdf?force=1`, { method: "POST" });
    expect(forced.status).toBe(200);
    expect(await forced.json()).toMatchObject({ swarmRef: body.swarmRef, stored: false, cached: false });
    expect(fake.uploads.length).toBe(2);
    expect(notes.length).toBe(1);
  });

  test("keeps a state change that landed during the upload", async () => {
    const { app, store, swarm } = await setup();
    const fake = swarm as FakeSwarm;
    const orig = fake.upload.bind(fake);
    fake.upload = async (...a) => { await store.upsertInvoice(inv({ state: "paid", payTx: `0x${"cd".repeat(32)}` })); return orig(...a); };
    const res = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(res.status).toBe(201);
    expect(await store.getInvoice(ID)).toMatchObject({ state: "paid", payTx: `0x${"cd".repeat(32)}` });
  });

  test("503 SWARM_NOT_CONFIGURED when Swarm is off (never a fake ref)", async () => {
    const { app, store } = await setup({ swarm: null });
    const res = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "SWARM_NOT_CONFIGURED" });
    expect((await store.getInvoice(ID))!.swarmRef).toBeUndefined();
  });

  test("502 SWARM_UPLOAD_FAILED on upload error, nothing stored", async () => {
    const fake = new FakeSwarm();
    fake.fail = true;
    const { app, store, notes } = await setup({ swarm: fake });
    const res = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "SWARM_UPLOAD_FAILED" });
    expect((await store.getInvoice(ID))!.swarmRef).toBeUndefined();
    expect(notes.length).toBe(0);
  });

  test("an encrypted reference is never stored", async () => {
    const fake = new FakeSwarm();
    fake.encrypted = true;
    const { app, store } = await setup({ swarm: fake });
    const res = await app.request(`/invoices/${ID}/pdf`, { method: "POST" });
    expect(res.status).toBe(502);
    expect((await store.getInvoice(ID))!.swarmRef).toBeUndefined();
  });

  test("404 unknown invoice, 400 bad id", async () => {
    const { app } = await setup();
    expect((await app.request(`/invoices/0x${"00".repeat(32)}/pdf`, { method: "POST" })).status).toBe(404);
    expect((await app.request(`/invoices/0x1234/pdf`)).status).toBe(400);
  });

  test("per-invoice upload rate limit", async () => {
    const { app } = await setup();
    for (let i = 0; i < 3; i++) expect((await app.request(`/invoices/${ID}/pdf?force=1`, { method: "POST" })).status).toBeLessThan(300);
    const res = await app.request(`/invoices/${ID}/pdf?force=1`, { method: "POST" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

// Real upload + read through the Swarm Foundation public gateway. Opt-in: SWARM_LIVE=1 bun test test/pdf.test.ts
describe.skipIf(process.env.SWARM_LIVE !== "1")("live Swarm (public gateway)", () => {
  test("upload a rendered invoice PDF and read the same bytes back", async () => {
    const cfg = loadSwarmConfig(process.env)!;
    const client = createSwarmClient(cfg);
    const bytes = await renderInvoicePdf({ invoice: inv({ memo: "PaisaLink live Swarm test (no personal data)" }), merchantHandle: "chai-studio", payUrl: null });
    const up = await client.upload(bytes, "paisalink-live-test.pdf", "application/pdf");
    expect(up.reference).toMatch(/^[0-9a-f]{64}$/);
    const back = await client.download(up.reference);
    expect(Buffer.from(back.data).equals(Buffer.from(bytes))).toBe(true);
    console.log(`[live] ${up.url}`);
  }, 120_000);
});
