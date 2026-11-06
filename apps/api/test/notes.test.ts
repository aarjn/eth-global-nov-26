// W5 notes routes: unit tests with the TEST-ONLY MemoryStore and a TEST-ONLY fake NoteChain that mimics the
// InvoiceNote rules closely enough to test the route logic (validation, signature check, budget, Arkiv mirror).
// The real contract runs in notes-anvil.test.ts.
import { describe, expect, test } from "bun:test";
import { getAddress, keccak256, parseUnits, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@paisalink/shared";
import {
  defaultTerms, discountPct, invoiceStateFor, noteFromChain, notesRoutes,
  type IssueCall, type NoteChain, type NoteTxOutcome, type OnchainNote, type RouterInvoiceView,
} from "../src/routes/notes";
import { setup, testConfig } from "./helpers";

const NOTE: Address = "0x2222222222222222222222222222222222222222";
const OWNER: Address = "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb";
const RELAYER: Address = "0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F";
const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** TEST-ONLY fake of InvoiceNote + the router view it reads. */
class FakeNoteChain implements NoteChain {
  noteAddress = NOTE; relayerAddress: Address | undefined = RELAYER; ownerAddress: Address | undefined = OWNER;
  now = 1_800_000_000;
  notes = new Map<number, OnchainNote>();
  router = new Map<string, RouterInvoiceView>();
  nonces = new Map<string, bigint>();
  allowed = new Set<string>();
  wbt = new Map<string, bigint>([[OWNER.toLowerCase(), 10n ** 18n]]);
  sent: string[] = [];
  next = 1;
  private pending = new Map<Hex, () => NoteTxOutcome>();
  private n = 0;

  async nowSec() { return this.now; }
  async getNote(id: number) { const x = this.notes.get(id); return x ? { ...x } : null; }
  async noteOfInvoice(inv: Hex) { return [...this.notes.values()].find((x) => x.invoiceId.toLowerCase() === inv.toLowerCase())?.noteId ?? 0; }
  async issueNonce(m: Address) { return this.nonces.get(m.toLowerCase()) ?? 0n; }
  async isAllowed(a: Address) { return this.allowed.has(a.toLowerCase()); }
  async routerInvoice(id: Hex) { const r = this.router.get(id.toLowerCase()); return r ? { ...r } : null; }
  async simulateIssue(c: IssueCall) {
    const r = this.router.get(c.invoiceId.toLowerCase());
    if (!r || r.status !== "open" || r.financed) throw new Error(`InvoiceNotOpen(${c.invoiceId})`);
    if (await this.noteOfInvoice(c.invoiceId)) throw new Error("InvoiceAlreadyNoted");
    if (c.faceValue > r.amount || c.price > c.faceValue || c.price === 0n) throw new Error("InvalidTerms()");
    if (c.maturity <= BigInt(this.now)) throw new Error("InvalidTerms()");
    return { gas: 150_000n, gasPrice: 5_000_000_000n };
  }
  async sendIssue(c: IssueCall) {
    const h = keccak256(toHex(`note-tx${++this.n}`));
    this.sent.push("issueWithSig");
    this.pending.set(h, () => {
      const r = this.router.get(c.invoiceId.toLowerCase())!;
      const noteId = this.next++;
      this.nonces.set(r.merchant.toLowerCase(), (this.nonces.get(r.merchant.toLowerCase()) ?? 0n) + 1n);
      this.notes.set(noteId, { noteId, invoiceId: c.invoiceId, issuer: r.merchant, holder: ZERO, faceValue: c.faceValue, price: c.price, escrow: 0n, maturity: Number(c.maturity), state: "issued" });
      return { txHash: h, status: "success", gasCostWei: 150_000n * 5_000_000_000n, events: [{ name: "NoteIssued", args: { noteId: BigInt(noteId), invoiceId: c.invoiceId, issuer: r.merchant } }] };
    });
    return h;
  }
  async wait(h: Hex) { return this.pending.get(h)!(); }
  async noteEvents(id: number) { return this.notes.has(id) ? [{ name: "NoteIssued", txHash: ("0x" + "ab".repeat(32)) as Hex, blockNumber: "1", args: { noteId: String(id) } }] : []; }
  async contractOwner() { return OWNER; }
  async setAllowed(a: Address) { this.allowed.add(a.toLowerCase()); this.sent.push("setAllowed"); return keccak256(toHex(`allow${++this.n}`)); }
  async wbtBalance(a: Address) { return this.wbt.get(a.toLowerCase()) ?? 0n; }
  async sendWbt(to: Address, wei: bigint) { this.wbt.set(to.toLowerCase(), (this.wbt.get(to.toLowerCase()) ?? 0n) + wei); this.sent.push("sendWbt"); return keccak256(toHex(`wbt${++this.n}`)); }
  async waitPlain() { return { status: "success" as const }; }

  // what the investor's own wallet / the payer would do on chain
  fund(id: number, investor: Address) { const x = this.notes.get(id)!; x.holder = investor; x.state = "funded"; this.router.get(x.invoiceId.toLowerCase())!.financed = true; }
  pay(id: number) { const x = this.notes.get(id)!; x.escrow += x.faceValue; this.router.get(x.invoiceId.toLowerCase())!.status = "paid"; }
  settle(id: number) { const x = this.notes.get(id)!; x.state = "settled"; x.escrow = 0n; }
}

async function world(opts: { chain?: FakeNoteChain | null } = {}) {
  const s = await setup();
  const fake = opts.chain === undefined ? new FakeNoteChain() : opts.chain;
  const notified: string[] = [];
  const ctx = { store: s.store, config: testConfig(), relayer: s.relayer, notify: (_m: Address, k: string, id: Hex) => { notified.push(`${k}:${id}`); } };
  s.app.route("/", notesRoutes(ctx, { chain: fake, now: () => 1_800_000_000_000 }));
  const inv = await s.createInvoice("2000");
  fake?.router.set(inv.invoiceId.toLowerCase(), { merchant: s.merchantAcct.address, status: "open", financed: false, amount: parseUnits("2000", 6), noteId: 0n });
  const get = async (p: string) => { const r = await s.app.request(p); return { status: r.status, body: (await r.json()) as any }; };
  const post = async (p: string, b: unknown) => { const r = await s.post(p, b); return { status: r.status, body: (await r.json()) as any }; };
  /** The browser flow: fetch typed data, sign with the merchant key, POST /notes/issue. */
  async function sell(q = "", signer = s.merchantAcct) {
    const td = await get(`/invoices/${inv.invoiceId}/note-typed-data${q}`);
    if (td.status !== 200) return td;
    const m = td.body.typedData.message;
    const signature = await signer.signTypedData({
      ...td.body.typedData,
      domain: { ...td.body.typedData.domain, chainId: Number(td.body.typedData.domain.chainId) },
      message: { invoiceId: m.invoiceId, faceValue: BigInt(m.faceValue), price: BigInt(m.price), maturity: BigInt(m.maturity), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) },
    });
    return post("/notes/issue", { invoiceId: inv.invoiceId, faceUsdt: td.body.faceUsdt, priceUsdt: td.body.priceUsdt, maturity: m.maturity, deadline: m.deadline, signature });
  }
  return { ...s, fake: fake!, inv, get, post, sell, notified };
}

describe("notes: pure helpers", () => {
  const base: OnchainNote = { noteId: 3, invoiceId: ("0x" + "AB".repeat(32)) as Hex, issuer: "0xc038827b4e362b0de1be859377508613cd028946", holder: ZERO, faceValue: 2_000_000_000n, price: 1_950_000_000n, escrow: 0n, maturity: 1_800_000_120, state: "issued" };
  test("default terms: 2,000 -> 1,950 (2.5% discount)", () => {
    const t = defaultTerms(2_000_000_000n);
    expect(t.price).toBe(1_950_000_000n);
    expect(discountPct(t.face, t.price)).toBe(2.5);
    expect(defaultTerms(1n).price).toBe(1n); // tiny invoices still get a valid (non-zero) price
  });
  test("noteFromChain: decimal USDT, lowercased invoice id, investor only once funded", () => {
    const n = noteFromChain(base);
    expect(n).toEqual({ noteId: 3, invoiceId: base.invoiceId.toLowerCase() as Hex, issuer: getAddress(base.issuer), faceUsdt: "2000", priceUsdt: "1950", maturity: 1_800_000_120, state: "issued" });
    expect(noteFromChain({ ...base, state: "funded", holder: OWNER }).investor).toBe(OWNER);
    expect(() => noteFromChain({ ...base, state: "none" })).toThrow();
  });
  test("invoice state follows the chain", () => {
    const open: RouterInvoiceView = { merchant: base.issuer, status: "open", financed: true, amount: 1n, noteId: 3n };
    expect(invoiceStateFor("open", base, open)).toBe("open");
    expect(invoiceStateFor("open", { ...base, state: "funded" }, open)).toBe("financed");
    expect(invoiceStateFor("financed", { ...base, state: "funded" }, { ...open, status: "paid" })).toBe("paid");
    expect(invoiceStateFor("paid", { ...base, state: "settled" }, { ...open, status: "paid" })).toBe("settled");
  });
});

describe("notes: routes", () => {
  test("sell an invoice: typed data -> merchant signature -> relayer issue -> Arkiv mirror", async () => {
    const w = await world();
    const r = await w.sell();
    expect(r.status).toBe(201);
    expect(r.body.note).toMatchObject({ noteId: 1, faceUsdt: "2000", priceUsdt: "1950", state: "issued", issuer: w.merchantAcct.address });
    expect(r.body.gasPaidBy).toBe(RELAYER);
    expect(r.body.explorerUrl).toContain("/tx/");
    expect(await w.store.listNotes()).toHaveLength(1);
    expect(w.notified).toContain(`invoice:${w.inv.invoiceId}`);
    // sponsored gas is charged to the merchant (budget + Arkiv gas counter)
    expect(BigInt(w.relayer.budget.usedToday(w.merchantAcct.address))).toBeGreaterThan(0n);
    // one note per invoice
    const again = await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("INVOICE_ALREADY_NOTED");
  });

  test("maturity defaults to 2 minutes of chain time; custom terms are honoured", async () => {
    const w = await world();
    const td = await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data?faceUsdt=1500&priceUsdt=1400&maturitySec=300`);
    expect(td.status).toBe(200);
    expect(td.body.maturity).toBe(String(w.fake.now + 300));
    expect(td.body.typedData.primaryType).toBe("Issue");
    expect(td.body.typedData.domain.verifyingContract).toBe(NOTE);
    expect(td.body.discountPct).toBe(6.66);
    expect((await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data`)).body.maturity).toBe(String(w.fake.now + 120));
  });

  test("terms beyond the invoice are refused before signing", async () => {
    const w = await world();
    expect((await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data?faceUsdt=2001`)).body.code).toBe("BAD_REQUEST");
    expect((await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data?faceUsdt=100&priceUsdt=101`)).body.code).toBe("BAD_REQUEST");
    expect((await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data?maturitySec=5`)).body.code).toBe("BAD_REQUEST");
    w.fake.router.get(w.inv.invoiceId.toLowerCase())!.status = "paid";
    expect((await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data`)).body.code).toBe("INVOICE_NOT_OPEN");
  });

  test("a signature from anyone but the invoice's merchant is rejected (no tx sent)", async () => {
    const w = await world();
    const r = await w.sell("", privateKeyToAccount(generatePrivateKey()));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("BAD_SIGNATURE");
    expect(w.fake.sent).toEqual([]);
  });

  test("sync mirrors fund -> pay -> settle into the note and invoice entities", async () => {
    const w = await world();
    await w.sell();
    const investor = privateKeyToAccount(generatePrivateKey()).address;
    w.fake.fund(1, investor);
    let s = await w.post("/notes/1/sync", {});
    expect(s.status).toBe(200);
    expect(s.body.note).toMatchObject({ state: "funded", investor });
    expect(s.body.invoice.state).toBe("financed");
    expect((await w.store.getInvoice(w.inv.invoiceId))!.state).toBe("financed");
    w.fake.pay(1);
    s = await w.post("/notes/1/sync", {});
    expect(s.body.invoice.state).toBe("paid");
    expect(s.body.onchain.escrowFull).toBe(true);
    w.fake.settle(1);
    s = await w.post("/notes/1/sync", {});
    expect(s.body.note.state).toBe("settled");
    expect((await w.store.getInvoice(w.inv.invoiceId))!.state).toBe("settled");
    const list = await w.get("/notes");
    expect(list.body.source).toBe("arkiv");
    expect(list.body.notes[0]).toMatchObject({ noteId: 1, state: "settled", onchain: { state: "settled" } });
    const one = await w.get("/notes/1");
    expect(one.body.inSync).toBe(true);
    expect(one.body.events[0].explorerUrl).toContain("/tx/");
    expect((await w.post("/notes/99/sync", {})).body.code).toBe("NOTE_NOT_FOUND");
  });

  test("filters: by invoice and by holder", async () => {
    const w = await world();
    await w.sell();
    expect((await w.get(`/notes?invoice=${w.inv.invoiceId}`)).body.notes).toHaveLength(1);
    expect((await w.get(`/notes?holder=${OWNER}`)).body.notes).toHaveLength(0);
  });

  test("not configured: reads still work from the store, writes say NOT_CONFIGURED", async () => {
    const w = await world({ chain: null });
    expect((await w.get("/notes")).body).toMatchObject({ notes: [], noteContract: null });
    const td = await w.get(`/invoices/${w.inv.invoiceId}/note-typed-data`);
    expect(td.status).toBe(503);
    expect(td.body.code).toBe("NOT_CONFIGURED");
    expect((await w.post("/notes/1/sync", {})).status).toBe(503);
  });

  test("testnet demo compliance desk: allowlists + gas once per wallet", async () => {
    const w = await world();
    const a = privateKeyToAccount(generatePrivateKey()).address;
    expect((await w.get(`/notes/allowlist/${a}`)).body.allowed).toBe(false);
    const r = await w.post("/notes/demo-investor", { address: a });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ demo: true, allowed: true });
    expect(r.body.label).toContain("Testnet demo");
    expect(w.fake.sent).toEqual(["setAllowed", "sendWbt"]);
    // second call: nothing to do, no new tx
    const again = await w.post("/notes/demo-investor", { address: a });
    expect(again.body.allowlistTx).toBeNull();
    expect(w.fake.sent).toHaveLength(2);
  });
});
