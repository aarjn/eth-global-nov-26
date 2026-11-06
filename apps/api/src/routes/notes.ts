// W5: InvoiceNote (Tokenize) routes and the Arkiv `notes` mirror.
//
//   GET  /invoices/:id/note-typed-data?faceUsdt&priceUsdt&maturitySec   Issue typed data for the merchant to sign
//   POST /notes/issue      { invoiceId, faceUsdt, priceUsdt, maturity, deadline, signature }  relayer sends issueWithSig
//   GET  /notes[?invoice=0x..&issuer=0x..&holder=0x..]                   notes read from Arkiv (+ live chain view)
//   GET  /notes/:id                                                       Arkiv note + chain state + lifecycle events
//   POST /notes/:id/sync                                                  re-read the note from chain, mirror into Arkiv
//   POST /notes/demo-investor { address }                                 TESTNET DEMO compliance desk (see below)
//
// Rules: the contract is the source of truth. Every store write here is derived from a mined receipt's events or a
// fresh getNote()/getInvoice() read, never from what the client says happened. The investor's own actions
// (approve, fund, transfer, settle) are sent from the investor's wallet in the browser; the API only mirrors them.
import { Hono, type Context } from "hono";
import {
  createWalletClient, formatEther, formatUnits, getAddress, isHex, parseEther, parseEventLogs,
  recoverTypedDataAddress, type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildIssueTypedData, DEPLOYMENT, invoiceNoteAbi, NOTE_STATE, paymentRouterAbi, ROUTER_STATUS, USDT_DECIMALS,
  type Address, type Hex, type Invoice, type InvoiceState, type Note,
} from "@paisalink/shared";
import type { PluginContext } from "../plugins";
import type { ApiConfig } from "../config";
import { ApiError, bad } from "../errors";
import { parseAddress, parseAmountUsdt, parseBytes32 } from "../relayer";
import { SlidingWindowLimiter, consumeAll } from "../ratelimit";
import { sharedSender } from "../senders";
import { jsonSafe } from "../typed";
import { makeClients, revertReason } from "../viem-chain";
import { clientIp } from "../app";

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const HOUR = 3_600_000;
export const DEMO_INVESTOR_LABEL =
  "Testnet demo compliance desk: allowlists a browser demo investor wallet and sends a little test WBT for gas. Whitechain testnet only, no real value. In production the compliance officer allowlists investors after KYC.";

// ---------------------------------------------------------------- types

export type NoteStateName = (typeof NOTE_STATE)[number];

/** InvoiceNote.getNote() decoded. */
export interface OnchainNote {
  noteId: number; invoiceId: Hex; issuer: Address; holder: Address;
  faceValue: bigint; price: bigint; escrow: bigint; maturity: number; state: NoteStateName;
}

export interface RouterInvoiceView {
  merchant: Address; status: (typeof ROUTER_STATUS)[number]; financed: boolean; amount: bigint; noteId: bigint;
}

export interface NoteEvent { name: string; txHash: Hex; blockNumber: string; args: Record<string, unknown>; }

export interface IssueCall { invoiceId: Hex; faceValue: bigint; price: bigint; maturity: bigint; deadline: bigint; signature: Hex; }

export interface NoteTxOutcome { txHash: Hex; status: "success" | "reverted"; gasCostWei: bigint; events: { name: string; args: Record<string, unknown> }[]; }

/** Everything notes.ts needs from Whitechain. Production: createViemNoteChain. Unit tests: a fake in apps/api/test. */
export interface NoteChain {
  readonly noteAddress: Address;
  readonly relayerAddress?: Address;
  /** Owner key (deployer) for the testnet demo compliance desk; undefined when not configured. */
  readonly ownerAddress?: Address;
  nowSec(): Promise<number>;
  getNote(noteId: number): Promise<OnchainNote | null>;
  noteOfInvoice(invoiceId: Hex): Promise<number>;
  issueNonce(merchant: Address): Promise<bigint>;
  isAllowed(a: Address): Promise<boolean>;
  routerInvoice(invoiceId: Hex): Promise<RouterInvoiceView | null>;
  /** eth_call + gas estimate of issueWithSig from the relayer. Throws Error(reason) on revert. */
  simulateIssue(c: IssueCall): Promise<{ gas: bigint; gasPrice: bigint }>;
  sendIssue(c: IssueCall, sim: { gas: bigint; gasPrice: bigint }): Promise<Hex>;
  wait(hash: Hex): Promise<NoteTxOutcome>;
  /** Lifecycle events of one note (eth_getLogs on the note contract). */
  noteEvents(noteId: number): Promise<NoteEvent[]>;
  // testnet demo compliance desk (owner = deployer)
  contractOwner(): Promise<Address>;
  setAllowed(a: Address): Promise<Hex>;
  wbtBalance(a: Address): Promise<bigint>;
  sendWbt(to: Address, wei: bigint): Promise<Hex>;
  waitPlain(hash: Hex): Promise<{ status: "success" | "reverted" }>;
}

// ---------------------------------------------------------------- errors

type NoteErrorCode = "NOTE_NOT_FOUND" | "INVOICE_ALREADY_NOTED";
const NOTE_STATUS: Record<NoteErrorCode, number> = { NOTE_NOT_FOUND: 404, INVOICE_ALREADY_NOTED: 409 };

/** ApiError with codes that only this plugin uses (app.onError renders any ApiError as {error, code}). */
export class NoteApiError extends ApiError {
  constructor(code: NoteErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super("BAD_REQUEST", message, extra);
    Object.defineProperty(this, "code", { value: code });
    Object.defineProperty(this, "status", { value: NOTE_STATUS[code] });
  }
}

// ---------------------------------------------------------------- pure helpers (unit tested)

export const usdt = (v: bigint) => formatUnits(v, USDT_DECIMALS);

/** Arkiv mirror row from the on-chain note. `investor` is the current holder once funded. */
export function noteFromChain(n: OnchainNote): Note {
  if (n.state === "none") throw new Error(`note ${n.noteId} does not exist on chain`);
  const note: Note = {
    noteId: n.noteId, invoiceId: n.invoiceId.toLowerCase() as Hex, issuer: getAddress(n.issuer),
    faceUsdt: usdt(n.faceValue), priceUsdt: usdt(n.price), maturity: n.maturity, state: n.state,
  };
  if (n.holder && n.holder !== ZERO) note.investor = getAddress(n.holder);
  return note;
}

/** Invoice state implied by the chain. issued -> unchanged; funded -> financed (or paid once the customer paid into
 *  the note escrow); settled -> settled. */
export function invoiceStateFor(current: InvoiceState, note: OnchainNote, router: RouterInvoiceView | null): InvoiceState {
  if (note.state === "settled") return "settled";
  if (note.state === "funded") return router?.status === "paid" ? "paid" : "financed";
  return current;
}

export const discountPct = (face: bigint, price: bigint) => (face > 0n ? Number(((face - price) * 10_000n) / face) / 100 : 0);

/** Default sale terms: face = the invoice amount, price = 97.5% of face (2,000 -> 1,950), rounded down to a cent. */
export function defaultTerms(amount: bigint): { face: bigint; price: bigint } {
  const cent = 10_000n;
  const price = (((amount * 975n) / 1000n) / cent) * cent;
  return { face: amount, price: price > 0n ? price : amount };
}

export function chainView(n: OnchainNote, nowSec: number) {
  return {
    noteId: n.noteId, invoiceId: n.invoiceId, issuer: n.issuer, holder: n.holder === ZERO ? null : n.holder,
    faceUsdt: usdt(n.faceValue), priceUsdt: usdt(n.price), escrowUsdt: usdt(n.escrow), maturity: n.maturity, state: n.state,
    discountPct: discountPct(n.faceValue, n.price), matured: nowSec >= n.maturity, escrowFull: n.escrow >= n.faceValue,
  };
}

function parseUint(v: unknown, field: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d{1,78}$/.test(v)) return BigInt(v);
  throw bad(`${field} must be a non-negative integer`);
}

function parseNoteId(v: unknown): number {
  const n = Number(parseUint(v, "note id"));
  if (!Number.isSafeInteger(n) || n < 1) throw bad("note id must be a positive integer");
  return n;
}

async function json(c: Context): Promise<Record<string, unknown>> {
  try { return ((await c.req.json()) ?? {}) as Record<string, unknown>; } catch { throw bad("body must be JSON"); }
}

// ---------------------------------------------------------------- production chain (viem)

const NOTE_EVENTS = ["NoteIssued", "NoteFunded", "NoteTransferred", "NoteEscrowFunded", "NoteSettled"] as const;
export function createViemNoteChain(cfg: ApiConfig): NoteChain | undefined {
  if (!cfg.invoiceNote) return undefined;
  const note = cfg.invoiceNote;
  const { chain, transport, pub } = makeClients(cfg);
  const abi = invoiceNoteAbi as Abi;
  const relayer = cfg.relayerKey ? privateKeyToAccount(cfg.relayerKey) : undefined;
  const owner = cfg.deployerKey ? privateKeyToAccount(cfg.deployerKey) : undefined;
  const relayerWallet = relayer ? createWalletClient({ account: relayer, chain, transport }) : undefined;
  const ownerWallet = owner ? createWalletClient({ account: owner, chain, transport }) : undefined;
  // Shared per-key queues (src/senders.ts): same queue as the relayer's router txs and /demo/fund (W2).
  const relayerSender = relayer ? sharedSender(relayer, pub, chain, transport, cfg.rpcUrl) : undefined;
  const ownerSender = owner ? sharedSender(owner, pub, chain, transport, cfg.rpcUrl) : undefined;
  let routerAddr: Address | undefined;
  const router = async () => (routerAddr ??= (await pub.readContract({ address: note, abi, functionName: "router" })) as Address);
  const fromBlock = BigInt(DEPLOYMENT.deployed && DEPLOYMENT.invoiceNote?.toLowerCase() === note.toLowerCase() && DEPLOYMENT.deployBlock ? DEPLOYMENT.deployBlock : 0);
  const issueArgs = (c: IssueCall) => [c.invoiceId, c.faceValue, c.price, c.maturity, c.deadline, c.signature] as const;

  const need = <T>(v: T | undefined, what: string): T => {
    if (!v) throw new ApiError("NOT_CONFIGURED", `${what} not configured on the server`);
    return v;
  };

  return {
    noteAddress: note,
    relayerAddress: relayer?.address,
    ownerAddress: owner?.address,
    async nowSec() { return Number((await pub.getBlock({ blockTag: "latest" })).timestamp); },
    async getNote(noteId) {
      const r = (await pub.readContract({ address: note, abi, functionName: "getNote", args: [BigInt(noteId)] })) as {
        invoiceId: Hex; issuer: Address; holder: Address; faceValue: bigint; price: bigint; escrow: bigint; maturity: bigint; state: number;
      };
      const state = NOTE_STATE[r.state] ?? "none";
      if (state === "none") return null;
      return { noteId, invoiceId: r.invoiceId, issuer: r.issuer, holder: r.holder, faceValue: r.faceValue, price: r.price, escrow: r.escrow, maturity: Number(r.maturity), state };
    },
    async noteOfInvoice(invoiceId) { return Number(await pub.readContract({ address: note, abi, functionName: "noteOfInvoice", args: [invoiceId] })); },
    issueNonce: (m) => pub.readContract({ address: note, abi, functionName: "nonces", args: [m] }) as Promise<bigint>,
    isAllowed: (a) => pub.readContract({ address: note, abi, functionName: "allowed", args: [a] }) as Promise<boolean>,
    async routerInvoice(invoiceId) {
      const r = (await pub.readContract({ address: await router(), abi: paymentRouterAbi, functionName: "getInvoice", args: [invoiceId] })) as unknown as {
        merchant: Address; status: number; financed: boolean; amount: bigint; noteId: bigint;
      };
      const status = ROUTER_STATUS[r.status] ?? "none";
      if (status === "none") return null;
      return { merchant: r.merchant, status, financed: r.financed, amount: r.amount, noteId: r.noteId };
    },
    async simulateIssue(c) {
      const account = need(relayer, "relayer key");
      try {
        await pub.simulateContract({ address: note, abi, functionName: "issueWithSig", args: issueArgs(c), account });
        const [gas, gasPrice] = await Promise.all([
          pub.estimateContractGas({ address: note, abi, functionName: "issueWithSig", args: issueArgs(c), account }),
          pub.getGasPrice(),
        ]);
        return { gas, gasPrice };
      } catch (e) { throw new Error(revertReason(e)); }
    },
    sendIssue(c, sim) {
      const account = need(relayer, "relayer key");
      const wallet = need(relayerWallet, "relayer key");
      return need(relayerSender, "relayer key").run((nonce) => wallet.writeContract({
        address: note, abi, functionName: "issueWithSig", args: issueArgs(c), account, chain, nonce,
        gas: (sim.gas * 13n) / 10n, gasPrice: sim.gasPrice,
      }));
    },
    async wait(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      const logs = parseEventLogs({ abi, logs: r.logs.filter((l) => l.address.toLowerCase() === note.toLowerCase()) }) as unknown as { eventName: string; args: Record<string, unknown> }[];
      return { txHash: hash, status: r.status, gasCostWei: r.gasUsed * r.effectiveGasPrice, events: logs.map((l) => ({ name: l.eventName, args: l.args })) };
    },
    async noteEvents(noteId) {
      const logs = (await pub.getContractEvents({ address: note, abi: invoiceNoteAbi, fromBlock, toBlock: "latest" })) as unknown as {
        eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint; logIndex: number;
      }[];
      return logs
        .filter((l) => (NOTE_EVENTS as readonly string[]).includes(l.eventName) && BigInt(l.args.noteId as bigint) === BigInt(noteId))
        .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
        .map((l) => ({ name: l.eventName, txHash: l.transactionHash, blockNumber: l.blockNumber.toString(), args: jsonSafe(l.args) as Record<string, unknown> }));
    },
    contractOwner: async () => (await pub.readContract({ address: note, abi, functionName: "owner" })) as Address,
    async setAllowed(a) {
      const account = need(owner, "deployer (compliance officer) key");
      const wallet = need(ownerWallet, "deployer key");
      await pub.simulateContract({ address: note, abi, functionName: "setAllowed", args: [a, true], account });
      return need(ownerSender, "deployer key").run((nonce) => wallet.writeContract({ address: note, abi, functionName: "setAllowed", args: [a, true], account, chain, nonce }));
    },
    wbtBalance: (a) => pub.getBalance({ address: a }),
    sendWbt(to, wei) {
      const account = need(owner, "deployer key");
      const wallet = need(ownerWallet, "deployer key");
      return need(ownerSender, "deployer key").run((nonce) => wallet.sendTransaction({ account, chain, to, value: wei, nonce }));
    },
    async waitPlain(hash) { const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 }); return { status: r.status }; },
  };
}

// ---------------------------------------------------------------- routes

export interface NotesDeps { chain?: NoteChain | null; now?: () => number; }

export function notesRoutes(ctx: PluginContext, deps: NotesDeps = {}): Hono {
  const { store, config, relayer } = ctx;
  const chainImpl = deps.chain === undefined ? createViemNoteChain(config) : deps.chain ?? undefined;
  const clock = deps.now ?? Date.now;
  const app = new Hono();
  const ip = (c: Context) => clientIp(c, config.trustProxy);
  const syncLimiter = new SlidingWindowLimiter(120, HOUR, clock);
  const deskIpLimiter = new SlidingWindowLimiter(5, HOUR, clock);
  const deskGlobal = new SlidingWindowLimiter(40, HOUR, clock);
  const deskGranted = new Set<string>();
  const DEMO_WBT = parseEther(process.env.DEMO_INVESTOR_WBT || "0.005");
  const txUrl = (h: Hex) => `${config.explorerUrl}/tx/${h}`;

  const chain = (): NoteChain => {
    if (!chainImpl) throw new ApiError("NOT_CONFIGURED", "InvoiceNote is not deployed/configured yet (INVOICE_NOTE_ADDRESS or contracts/deployments/1874.json)");
    return chainImpl;
  };
  const limit = (checks: Parameters<typeof consumeAll>[0]) => {
    const r = consumeAll(checks);
    if (r) throw new ApiError("RATE_LIMITED", `rate limit reached (${r.name}); try again later`, { retryAfterSec: r.retryAfterSec });
  };
  async function persist(what: string, fn: () => Promise<unknown>): Promise<string | undefined> {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try { await fn(); return undefined; } catch (e) { last = e; await Bun.sleep(400 * (i + 1)); }
    }
    const msg = `${what} failed: ${(last as Error)?.message?.split("\n")[0] ?? String(last)}`;
    console.error(`[notes] ${msg}`);
    return msg;
  }
  async function loadInvoice(id: Hex): Promise<Invoice> {
    const inv = await store.getInvoice(id);
    if (!inv) throw new ApiError("INVOICE_NOT_FOUND", "invoice not found");
    return inv;
  }

  /** Validates the sale terms against the invoice on chain. Returns the parsed amounts. */
  async function checkTerms(inv: Invoice, faceRaw: unknown, priceRaw: unknown) {
    const ch = chain();
    const onchain = await ch.routerInvoice(inv.invoiceId);
    if (!onchain) throw new ApiError("INVOICE_NOT_FOUND", "invoice does not exist on chain");
    if (onchain.status !== "open" || onchain.financed) throw new ApiError("INVOICE_NOT_OPEN", `invoice is ${onchain.financed ? "already financed" : onchain.status} on chain; only open invoices can be sold`);
    const existing = await ch.noteOfInvoice(inv.invoiceId);
    if (existing) throw new NoteApiError("INVOICE_ALREADY_NOTED", `invoice already has note #${existing}`, { noteId: existing });
    const d = defaultTerms(onchain.amount);
    const face = faceRaw === undefined || faceRaw === "" ? d.face : parseAmountUsdt(faceRaw).units;
    const price = priceRaw === undefined || priceRaw === "" ? (face === d.face ? d.price : defaultTerms(face).price) : parseAmountUsdt(priceRaw).units;
    if (face > onchain.amount) throw bad(`face value cannot exceed the invoice amount (${usdt(onchain.amount)} USDT)`);
    if (price > face) throw bad("price cannot exceed the face value");
    return { face, price, merchant: getAddress(onchain.merchant), amount: onchain.amount };
  }

  async function enrich(n: Note, ch: NoteChain | undefined, nowSec: number) {
    if (!ch) return { ...n, onchain: null };
    try { const o = await ch.getNote(n.noteId); return { ...n, onchain: o ? chainView(o, nowSec) : null }; }
    catch { return { ...n, onchain: null }; }
  }

  /** Re-reads a note from chain and mirrors it (note entity + invoice state) into the store. */
  async function sync(noteId: number) {
    const ch = chain();
    const o = await ch.getNote(noteId);
    if (!o) throw new NoteApiError("NOTE_NOT_FOUND", `note #${noteId} does not exist on chain`);
    const note = noteFromChain(o);
    const warnings: (string | undefined)[] = [];
    const prev = (await store.listNotes()).find((x) => x.noteId === noteId) ?? null;
    warnings.push(await persist("upsertNote", () => store.upsertNote(note)));
    let invoice = await store.getInvoice(note.invoiceId);
    let invoiceChanged = false;
    if (invoice) {
      const routerView = await ch.routerInvoice(note.invoiceId).catch(() => null);
      const next = invoiceStateFor(invoice.state, o, routerView);
      if (next !== invoice.state) {
        const updated: Invoice = { ...invoice, state: next };
        const w = await persist("upsertInvoice", () => store.upsertInvoice(updated));
        warnings.push(w);
        if (!w) { invoice = updated; invoiceChanged = true; }
      }
      ctx.notify(invoice.merchant, "invoice", invoice.invoiceId);
    }
    const storeWarning = warnings.filter(Boolean).join("; ") || undefined;
    return {
      note, onchain: chainView(o, await ch.nowSec().catch(() => Math.floor(clock() / 1000))), invoice,
      changed: { note: JSON.stringify(prev) !== JSON.stringify(note), invoice: invoiceChanged },
      ...(storeWarning ? { storeWarning } : {}),
    };
  }

  // ---- issue: typed data the merchant signs ----
  app.get("/invoices/:id/note-typed-data", async (c) => {
    const ch = chain();
    if (!ch.relayerAddress) throw new ApiError("NOT_CONFIGURED", "relayer key not configured on the server");
    const inv = await loadInvoice(parseBytes32(c.req.param("id"), "invoice id"));
    const t = await checkTerms(inv, c.req.query("faceUsdt"), c.req.query("priceUsdt"));
    const now = await ch.nowSec();
    const rel = c.req.query("maturitySec");
    const secs = rel === undefined || rel === "" ? 120n : parseUint(rel, "maturitySec");
    if (secs < 30n || secs > 400n * 86400n) throw bad("maturitySec must be between 30 seconds and 400 days");
    const maturity = BigInt(now) + secs;
    const nonce = await ch.issueNonce(t.merchant);
    const deadline = BigInt(now + 600);
    const typedData = buildIssueTypedData(ch.noteAddress, { invoiceId: inv.invoiceId, faceValue: t.face, price: t.price, maturity, nonce, deadline });
    return c.json(jsonSafe({
      ...typedData, typedData, deadline, maturity, merchant: t.merchant, noteContract: ch.noteAddress,
      faceUsdt: usdt(t.face), priceUsdt: usdt(t.price), discountPct: discountPct(t.face, t.price), invoiceAmountUsdt: usdt(t.amount),
    }));
  });

  // ---- issue: relayer submits issueWithSig (the merchant pays no gas; charged to its daily sponsored budget) ----
  app.post("/notes/issue", async (c) => {
    const b = await json(c);
    const invoiceId = parseBytes32(b.invoiceId, "invoiceId");
    const maturity = parseUint(b.maturity, "maturity");
    const deadline = parseUint(b.deadline, "deadline");
    const signature = b.signature;
    if (typeof signature !== "string" || !isHex(signature) || signature.length < 132) throw bad("signature must be a hex string");
    const ch = chain();
    if (!ch.relayerAddress) throw new ApiError("NOT_CONFIGURED", "relayer key not configured on the server");
    const now = await ch.nowSec();
    if (deadline <= BigInt(now)) throw bad("deadline has passed; ask for new typed data");
    if (deadline > BigInt(now + 86400)) throw bad("deadline must be within 24 hours");
    limit([
      { limiter: relayer.limits.global, key: "global", name: "global" },
      { limiter: relayer.limits.invoiceIp, key: ip(c), name: "notes per IP" },
    ]);
    const inv = await loadInvoice(invoiceId);
    const merchant = await store.getMerchant(inv.merchant);
    if (!merchant) throw new ApiError("MERCHANT_NOT_FOUND", "merchant is not registered");
    const t = await checkTerms(inv, b.faceUsdt, b.priceUsdt);
    if (getAddress(merchant.wallet) !== t.merchant) throw new ApiError("BAD_REQUEST", "invoice merchant differs between Arkiv and chain");
    // Signature must recover to the invoice's merchant over exactly these terms with the current nonce.
    const nonce = await ch.issueNonce(t.merchant);
    const call: IssueCall = { invoiceId: inv.invoiceId, faceValue: t.face, price: t.price, maturity, deadline, signature: signature as Hex };
    let signer: Address;
    try {
      signer = getAddress(await recoverTypedDataAddress({ ...buildIssueTypedData(ch.noteAddress, { invoiceId: inv.invoiceId, faceValue: t.face, price: t.price, maturity, nonce, deadline }), signature: signature as Hex }));
    } catch { throw new ApiError("BAD_SIGNATURE", "merchant signature could not be parsed"); }
    if (signer !== t.merchant) throw new ApiError("BAD_SIGNATURE", "signature was not made by the invoice's merchant");
    if (maturity <= BigInt(now)) throw bad("maturity has passed; ask for new typed data");

    let sim;
    try { sim = await ch.simulateIssue(call); }
    catch (e) { throw new ApiError("SIMULATION_FAILED", `simulation reverted: ${(e as Error).message}`); }
    const estimate = (sim.gas * sim.gasPrice * 12n) / 10n;
    const reservation = relayer.budget.reserve(t.merchant, estimate);
    if (reservation === null) {
      throw new ApiError("BUDGET_EXCEEDED", "merchant's daily sponsored gas budget is used up", {
        dailyLimitWei: relayer.budget.dailyLimitWei.toString(), usedTodayWei: relayer.budget.usedToday(t.merchant).toString(),
      });
    }
    let hash: Hex | undefined;
    let out: NoteTxOutcome;
    try {
      hash = await ch.sendIssue(call, sim);
      out = await ch.wait(hash);
    } catch (e) {
      relayer.budget.settle(reservation, hash ? estimate : 0n);
      throw new ApiError("TX_FAILED", hash ? `transaction not confirmed: ${(e as Error).message}` : `could not send transaction: ${(e as Error).message}`, hash ? { txHash: hash, explorerUrl: txUrl(hash) } : {});
    }
    relayer.budget.settle(reservation, out.gasCostWei);
    const warnings: (string | undefined)[] = [await persist("addMerchantGasUsed", () => store.addMerchantGasUsed(t.merchant, out.gasCostWei))];
    if (out.status !== "success") throw new ApiError("TX_FAILED", "transaction reverted on chain", { txHash: out.txHash, explorerUrl: txUrl(out.txHash) });
    const ev = out.events.find((e) => e.name === "NoteIssued");
    if (!ev || String(ev.args.invoiceId).toLowerCase() !== inv.invoiceId.toLowerCase()) {
      throw new ApiError("TX_FAILED", "NoteIssued event missing from receipt", { txHash: out.txHash, explorerUrl: txUrl(out.txHash) });
    }
    const noteId = Number(ev.args.noteId as bigint);
    const o = await ch.getNote(noteId);
    if (!o) throw new ApiError("TX_FAILED", "note not readable after issue", { txHash: out.txHash });
    const note = noteFromChain(o);
    warnings.push(await persist("upsertNote", () => store.upsertNote(note)));
    ctx.notify(inv.merchant, "invoice", inv.invoiceId);
    const storeWarning = warnings.filter(Boolean).join("; ") || undefined;
    return c.json({ note, onchain: jsonSafe(chainView(o, now)), txHash: out.txHash, explorerUrl: txUrl(out.txHash), gasPaidBy: ch.relayerAddress, ...(storeWarning ? { storeWarning } : {}) }, 201);
  });

  // ---- reads: Arkiv mirror, enriched with the live chain view ----
  app.get("/notes", async (c) => {
    const ch = chainImpl;
    const inv = c.req.query("invoice");
    const issuer = c.req.query("issuer");
    const holder = c.req.query("holder");
    let notes = await store.listNotes();
    if (inv) { const id = parseBytes32(inv, "invoice"); notes = notes.filter((n) => n.invoiceId.toLowerCase() === id); }
    if (issuer) { const a = parseAddress(issuer, "issuer"); notes = notes.filter((n) => getAddress(n.issuer) === a); }
    if (holder) { const a = parseAddress(holder, "holder"); notes = notes.filter((n) => n.investor && getAddress(n.investor) === a); }
    notes.sort((a, b) => b.noteId - a.noteId);
    const now = ch ? await ch.nowSec().catch(() => Math.floor(clock() / 1000)) : Math.floor(clock() / 1000);
    const list = await Promise.all(notes.slice(0, 50).map((n) => enrich(n, ch, now)));
    return c.json({ notes: jsonSafe(list), noteContract: ch?.noteAddress ?? null, source: "arkiv", chainTime: now });
  });

  app.get("/notes/:id", async (c) => {
    const noteId = parseNoteId(c.req.param("id"));
    const ch = chainImpl;
    const [mirror, o, events, now] = await Promise.all([
      store.listNotes().then((l) => l.find((n) => n.noteId === noteId) ?? null),
      ch ? ch.getNote(noteId).catch(() => null) : null,
      ch ? ch.noteEvents(noteId).catch(() => null) : null,
      ch ? ch.nowSec().catch(() => Math.floor(clock() / 1000)) : Math.floor(clock() / 1000),
    ]);
    if (!mirror && !o) throw new NoteApiError("NOTE_NOT_FOUND", `note #${noteId} not found`);
    const invoiceId = (mirror?.invoiceId ?? o!.invoiceId) as Hex;
    const [invoice, holderAllowed] = await Promise.all([
      store.getInvoice(invoiceId).catch(() => null),
      ch && o && o.holder !== ZERO ? ch.isAllowed(o.holder).catch(() => null) : null,
    ]);
    return c.json(jsonSafe({
      note: mirror, onchain: o ? chainView(o, now) : null, inSync: !!mirror && !!o && JSON.stringify(noteFromChain(o)) === JSON.stringify(mirror),
      invoice, holderAllowed, events: events?.map((e) => ({ ...e, explorerUrl: txUrl(e.txHash) })) ?? null,
      noteContract: ch?.noteAddress ?? null, chainTime: now,
    }));
  });

  app.post("/notes/:id/sync", async (c) => {
    const noteId = parseNoteId(c.req.param("id"));
    limit([{ limiter: syncLimiter, key: ip(c), name: "note syncs per IP" }]);
    return c.json(jsonSafe(await sync(noteId)));
  });

  // ---- TESTNET DEMO compliance desk ----
  // A judge's browser gets a fresh "testnet demo investor wallet". It must be on the InvoiceNote allowlist to fund,
  // and it needs a little WBT to pay its own gas. On Whitechain testnet only, the owner key (deployer = compliance
  // officer) allowlists it once and sends DEMO_INVESTOR_WBT (default 0.005). Limits: once per address, 5 per IP/h,
  // 40 per hour overall. USDT comes from POST /demo/fund. A fresh wallet that skips this desk is NOT allowlisted,
  // which is how the UI shows the NotAllowlisted revert.
  app.get("/notes/allowlist/:address", async (c) => {
    const a = parseAddress(c.req.param("address"), "address");
    const ch = chain();
    const [allowed, wei] = await Promise.all([ch.isAllowed(a), ch.wbtBalance(a).catch(() => null)]);
    return c.json({ address: a, allowed, wbt: wei === null ? null : formatEther(wei) });
  });

  app.post("/notes/demo-investor", async (c) => {
    if (!config.demo.enabled) throw new ApiError("NOT_CONFIGURED", "demo compliance desk runs on Whitechain testnet only", { demo: true });
    const ch = chain();
    const to = parseAddress((await json(c)).address, "address");
    if (!ch.ownerAddress) throw new ApiError("NOT_CONFIGURED", "compliance officer (deployer) key not configured", { demo: true });
    const owner = await ch.contractOwner();
    if (getAddress(owner) !== getAddress(ch.ownerAddress)) throw new ApiError("NOT_CONFIGURED", "the configured deployer key is not the InvoiceNote owner", { demo: true });
    const key = to.toLowerCase();
    const [allowedBefore, wei] = await Promise.all([ch.isAllowed(to), ch.wbtBalance(to)]);
    const needsAllow = !allowedBefore;
    const needsGas = wei < DEMO_WBT / 2n;
    if (!needsAllow && !needsGas) return c.json({ demo: true, label: DEMO_INVESTOR_LABEL, address: to, allowed: true, wbt: formatEther(wei), allowlistTx: null, gasTx: null });
    if (deskGranted.has(key)) throw new ApiError("DEMO_FAUCET_LIMIT", "this demo investor wallet was already set up", { demo: true });
    limit([
      { limiter: deskGlobal, key: "global", name: "demo desk overall" },
      { limiter: deskIpLimiter, key: ip(c), name: "demo desk per IP" },
    ]);
    deskGranted.add(key);
    const out: { allowlistTx: Hex | null; gasTx: Hex | null } = { allowlistTx: null, gasTx: null };
    try {
      if (needsAllow) {
        out.allowlistTx = await ch.setAllowed(to);
        if ((await ch.waitPlain(out.allowlistTx)).status !== "success") throw new Error("setAllowed reverted");
      }
      if (needsGas) {
        if ((await ch.wbtBalance(ch.ownerAddress)) < DEMO_WBT * 4n) throw new ApiError("NOT_CONFIGURED", "demo desk is low on test WBT; ask the team to top it up", { demo: true, desk: ch.ownerAddress });
        out.gasTx = await ch.sendWbt(to, DEMO_WBT);
        if ((await ch.waitPlain(out.gasTx)).status !== "success") throw new Error("WBT transfer reverted");
      }
    } catch (e) {
      deskGranted.delete(key);
      if (e instanceof ApiError) throw e;
      throw new ApiError("TX_FAILED", `demo desk failed: ${(e as Error).message.split("\n")[0]}`, { demo: true, ...out });
    }
    return c.json({
      demo: true, label: DEMO_INVESTOR_LABEL, address: to, allowed: await ch.isAllowed(to), wbt: formatEther(await ch.wbtBalance(to)),
      allowlistTx: out.allowlistTx, gasTx: out.gasTx,
      links: { allowlistTx: out.allowlistTx ? txUrl(out.allowlistTx) : null, gasTx: out.gasTx ? txUrl(out.gasTx) : null },
    });
  });

  return app;
}

export default notesRoutes;
