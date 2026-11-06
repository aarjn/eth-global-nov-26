// Relayer with drain protection (PLAN.md section 2). The relayer wallet is the PaymentRouter operator and pays
// all WBT gas: invoice creation, gasless USDT payments (EIP-3009), and merchant-signed refunds/withdrawals.
//
// Drain protection, in order of evaluation for POST /relay:
//   1. rate limits (global 300/h, per IP 60/h, per payer 10/h), consumed before any RPC work
//   2. invoice exists in the store (Arkiv) and is "open"; no other relay in flight for it
//   3. World-ID gate: merchant.verified must be true
//   4. authorization checks: to == PaymentRouter, value == invoice amount (store AND chain), validAfter <= now,
//      now + 20 s <= validBefore <= now + 10 min, signature recovers to `from`, nonce == paymentNonce(invoiceId)
//      (binds the signature to this invoice, docs/specs/contracts.md), on-chain status Open, nonce unused on USDT
//   5. eth_call simulation + gas estimate (a reverting call never spends gas)
//   6. per-merchant daily gas budget (0.02 WBT) reserved with the estimate, settled with the real cost
//   7. single tx queue for the one relayer wallet; store updated from the mined receipt's events
import { formatUnits, getAddress, isAddress, isHex, parseSignature, parseUnits, recoverTypedDataAddress, toHex } from "viem";
import {
  buildReceiveAuthTypedData, USDT_DECIMALS,
  type Address, type Eip3009Authorization, type Hex, type Invoice, type Merchant, type PaisaStore, type Payment, type RelayRequest,
} from "@paisalink/shared";
import { ApiError, bad } from "./errors";
import type { ApiConfig } from "./config";
import { GasBudget } from "./budget";
import { SlidingWindowLimiter, consumeAll, type LimitCheck } from "./ratelimit";
import { SimulationError, type RouterCall, type RouterChain, type TxOutcome } from "./chain";
import { buildRefundTypedData, buildWithdrawTypedData, invoicePaymentNonce } from "./typed";

const HOUR = 3_600_000;
const AMOUNT_RE = /^(0|[1-9]\d{0,8})(\.\d{1,6})?$/;
const MAX_MEMO_BYTES = 128;

export type ChangeKind = "invoice" | "payment";
export type ChangeListener = (merchant: Address, kind: ChangeKind, invoiceId: Hex) => void;

// ---------- pure validation helpers (unit tested) ----------

export function parseAmountUsdt(v: unknown): { text: string; units: bigint } {
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s !== "string" || !AMOUNT_RE.test(s.trim())) throw bad("amountUsdt must be a decimal string with at most 6 decimals");
  const units = parseUnits(s.trim(), USDT_DECIMALS);
  if (units <= 0n) throw bad("amountUsdt must be positive");
  return { text: formatUnits(units, USDT_DECIMALS), units };
}

export function parseAddress(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw bad(`${field} must be an address`);
  return getAddress(v);
}

export function parseBytes32(v: unknown, field: string): Hex {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66) throw bad(`${field} must be 0x-prefixed bytes32`);
  return v.toLowerCase() as Hex;
}

function parseUint(v: unknown, field: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d{1,78}$/.test(v)) return BigInt(v);
  throw bad(`${field} must be a non-negative integer`);
}

export function parseRelayRequest(body: unknown): RelayRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const a = (b.authorization ?? {}) as Record<string, unknown>;
  const sig = b.signature;
  if (typeof sig !== "string" || !isHex(sig) || (sig.length !== 132 && sig.length !== 130)) throw bad("signature must be a 65-byte hex string");
  const validAfter = parseUint(a.validAfter, "authorization.validAfter");
  const validBefore = parseUint(a.validBefore, "authorization.validBefore");
  return {
    invoiceId: parseBytes32(b.invoiceId, "invoiceId"),
    authorization: {
      from: parseAddress(a.from, "authorization.from"),
      to: parseAddress(a.to, "authorization.to"),
      value: parseUint(a.value, "authorization.value").toString(),
      validAfter: Number(validAfter),
      validBefore: Number(validBefore),
      nonce: parseBytes32(a.nonce, "authorization.nonce"),
    },
    signature: sig as Hex,
  };
}

/** Field rules for an EIP-3009 authorization against an invoice. Returns a reason, or null if acceptable. */
export function checkAuthorizationFields(
  a: Eip3009Authorization,
  o: { router: Address; invoiceId: Hex; expectedValue: bigint; now: number; maxWindowSec: number; minRemainingSec: number },
): string | null {
  if (getAddress(a.to) !== getAddress(o.router)) return "authorization.to must be the PaymentRouter";
  if (BigInt(a.value) !== o.expectedValue) return "authorization.value must equal the invoice amount";
  if (a.nonce.toLowerCase() !== invoicePaymentNonce(o.router, o.invoiceId).toLowerCase()) return "authorization.nonce must be paymentNonce(invoiceId)";
  if (a.validAfter > o.now) return "authorization is not valid yet (validAfter is in the future)";
  if (a.validBefore > o.now + o.maxWindowSec) return `authorization.validBefore must be within ${o.maxWindowSec / 60} minutes`;
  if (a.validBefore < o.now + o.minRemainingSec) return "authorization expired or about to expire";
  return null;
}

export async function recoverAuthorizer(a: Eip3009Authorization, signature: Hex): Promise<Address> {
  return getAddress(await recoverTypedDataAddress({ ...buildReceiveAuthTypedData(a), signature }));
}

function memoOf(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw bad("memo must be a string");
  const m = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (new TextEncoder().encode(m).length > MAX_MEMO_BYTES) throw bad(`memo must be at most ${MAX_MEMO_BYTES} bytes`);
  return m;
}

const randomBytes32 = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

// ---------- relayer ----------

export interface RelayerDeps {
  store: PaisaStore;
  chain?: RouterChain;
  config: ApiConfig;
  now?: () => number; // ms clock, injectable for tests
}

export class Relayer {
  readonly budget: GasBudget;
  readonly limits: {
    global: SlidingWindowLimiter; ip: SlidingWindowLimiter; payer: SlidingWindowLimiter;
    invoiceIp: SlidingWindowLimiter; invoiceMerchant: SlidingWindowLimiter;
  };
  readonly stats = { relayed: 0, invoicesCreated: 0, refunds: 0, withdrawals: 0, rejected: {} as Record<string, number> };
  private inflightInvoices = new Set<string>();
  private usedNonces = new Set<string>();
  private listeners = new Set<ChangeListener>();
  private store: PaisaStore;
  private chainImpl?: RouterChain;
  private cfg: ApiConfig;
  private clock: () => number;

  constructor(d: RelayerDeps) {
    this.store = d.store; this.chainImpl = d.chain; this.cfg = d.config; this.clock = d.now ?? Date.now;
    const L = d.config.limits;
    this.budget = new GasBudget(L.merchantDailyGasWei, this.clock);
    this.limits = {
      global: new SlidingWindowLimiter(L.globalPerHour, HOUR, this.clock),
      ip: new SlidingWindowLimiter(L.ipPerHour, HOUR, this.clock),
      payer: new SlidingWindowLimiter(L.payerPerHour, HOUR, this.clock),
      invoiceIp: new SlidingWindowLimiter(L.invoiceIpPerHour, HOUR, this.clock),
      invoiceMerchant: new SlidingWindowLimiter(L.invoiceMerchantPerHour, HOUR, this.clock),
    };
  }

  get chain(): RouterChain {
    if (!this.chainImpl) throw new ApiError("NOT_CONFIGURED", "PaymentRouter or relayer key not configured on the server");
    return this.chainImpl;
  }
  get hasChain() { return !!this.chainImpl; }
  private nowS() { return Math.floor(this.clock() / 1000); }

  onChange(fn: ChangeListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Push a live update to SSE listeners (also used by plugins after their own store writes). */
  notify(m: Address, kind: ChangeKind, id: Hex) { for (const fn of this.listeners) { try { fn(m, kind, id); } catch { /* listener errors never break a relay */ } } }

  private reject(e: ApiError): never {
    this.stats.rejected[e.code] = (this.stats.rejected[e.code] ?? 0) + 1;
    throw e;
  }
  private limit(checks: LimitCheck[]) {
    const r = consumeAll(checks);
    if (r) this.reject(new ApiError("RATE_LIMITED", `rate limit reached (${r.name}); try again later`, { retryAfterSec: r.retryAfterSec }));
  }

  private async loadMerchant(wallet: Address): Promise<Merchant> {
    const m = await this.store.getMerchant(wallet);
    if (!m) this.reject(new ApiError("MERCHANT_NOT_FOUND", "merchant is not registered"));
    return m;
  }
  private requireVerified(m: Merchant) {
    if (!m.verified) this.reject(new ApiError("MERCHANT_NOT_VERIFIED", "gas-sponsored checkout locked: merchant has not completed World ID verification"));
  }
  private async loadInvoice(id: Hex): Promise<Invoice> {
    const inv = await this.store.getInvoice(id);
    if (!inv) this.reject(new ApiError("INVOICE_NOT_FOUND", "invoice not found"));
    return inv;
  }

  /** Simulate, reserve budget, send through the queue, wait for the receipt, charge the real gas cost. */
  private async execute(merchant: Address, call: RouterCall): Promise<TxOutcome> {
    const chain = this.chain;
    let sim;
    try { sim = await chain.simulate(call); }
    catch (e) {
      const reason = e instanceof SimulationError ? e.reason : (e as Error).message;
      this.reject(new ApiError("SIMULATION_FAILED", `simulation reverted: ${reason}`));
    }
    const estimate = (sim.gas * sim.gasPrice * 12n) / 10n;
    const reservation = this.budget.reserve(merchant, estimate);
    if (reservation === null) {
      this.reject(new ApiError("BUDGET_EXCEEDED", "merchant's daily sponsored gas budget is used up", {
        dailyLimitWei: this.budget.dailyLimitWei.toString(), usedTodayWei: this.budget.usedToday(merchant).toString(),
      }));
    }
    let hash: Hex | undefined;
    let outcome: TxOutcome | undefined;
    try {
      hash = await chain.send(call, sim);
      outcome = await chain.wait(hash);
    } catch (e) {
      // Sent but not confirmed: charge the estimate (conservative). Not sent: charge nothing.
      this.budget.settle(reservation, hash ? estimate : 0n);
      throw new ApiError("TX_FAILED", hash ? `transaction not confirmed: ${(e as Error).message}` : `could not send transaction: ${(e as Error).message}`, hash ? { txHash: hash, explorerUrl: this.txUrl(hash) } : {});
    }
    this.budget.settle(reservation, outcome.gasCostWei);
    await this.persist("addMerchantGasUsed", () => this.store.addMerchantGasUsed(merchant, outcome.gasCostWei));
    if (outcome.status !== "success") {
      throw new ApiError("TX_FAILED", "transaction reverted on chain", { txHash: outcome.txHash, explorerUrl: this.txUrl(outcome.txHash) });
    }
    return outcome;
  }

  /** Store writes after a confirmed tx: retried, and reported (not thrown) so the tx hash still reaches the client. */
  private async persist(what: string, fn: () => Promise<unknown>): Promise<string | undefined> {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try { await fn(); return undefined; }
      catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
    }
    const msg = `${what} failed: ${(last as Error)?.message ?? String(last)}`;
    console.error(`[store] ${msg}`);
    return msg;
  }

  txUrl(hash: Hex) { return `${this.cfg.explorerUrl}/tx/${hash}`; }

  // ---- POST /invoices ----
  async createInvoice(body: unknown, ip: string) {
    const b = (body ?? {}) as Record<string, unknown>;
    const merchant = parseAddress(b.merchant, "merchant");
    const amount = parseAmountUsdt(b.amountUsdt);
    const dueAt = Number(parseUint(b.dueAt, "dueAt"));
    const memo = memoOf(b.memo);
    const now = this.nowS();
    if (dueAt <= now) throw bad("dueAt must be in the future (unix seconds)");
    if (dueAt > now + 400 * 86400) throw bad("dueAt must be within 400 days");
    this.limit([
      { limiter: this.limits.global, key: "global", name: "global" },
      { limiter: this.limits.invoiceIp, key: ip, name: "invoices per IP" },
      { limiter: this.limits.invoiceMerchant, key: merchant.toLowerCase(), name: "invoices per merchant" },
    ]);
    const m = await this.loadMerchant(merchant);
    // Invoice creation is allowed for unverified merchants (they can still be paid with the self-paid pay()
    // path); it is charged to the same daily gas budget. Only the gasless payment relay needs World ID.
    const invoiceId = randomBytes32();
    const out = await this.execute(m.wallet, { fn: "createInvoiceFor", invoiceId, merchant: m.wallet, amount: amount.units, dueAt: BigInt(dueAt) });
    const ev = out.events.find((e) => e.name === "InvoiceCreated");
    if (!ev || String(ev.args.invoiceId).toLowerCase() !== invoiceId) {
      throw new ApiError("TX_FAILED", "InvoiceCreated event missing from receipt", { txHash: out.txHash });
    }
    const inv: Invoice = {
      invoiceId, merchant: getAddress(String(ev.args.merchant)), amountUsdt: formatUnits(BigInt(ev.args.amount as bigint), USDT_DECIMALS),
      dueAt: Number(ev.args.dueAt), memo, state: "open",
    };
    const warn = await this.persist("upsertInvoice", () => this.store.upsertInvoice(inv));
    if (warn) throw new ApiError("INTERNAL", "invoice created on chain but not saved to Arkiv; retry later", { txHash: out.txHash, invoiceId });
    this.stats.invoicesCreated++;
    this.notify(inv.merchant, "invoice", invoiceId);
    return { ...inv, createTx: out.txHash, explorerUrl: this.txUrl(out.txHash) };
  }

  // ---- POST /relay ----
  async relay(body: unknown, ip: string) {
    const req = parseRelayRequest(body);
    const a = req.authorization;
    this.limit([
      { limiter: this.limits.global, key: "global", name: "global" },
      { limiter: this.limits.ip, key: ip, name: "per IP" },
      { limiter: this.limits.payer, key: a.from.toLowerCase(), name: "per payer" },
    ]);
    const inv = await this.loadInvoice(req.invoiceId);
    // "financed" invoices are still Open on chain: the router forwards the payment to the note escrow.
    if (inv.state !== "open" && inv.state !== "financed") this.reject(new ApiError("INVOICE_NOT_OPEN", `invoice is ${inv.state}`));
    const merchant = await this.loadMerchant(inv.merchant);
    this.requireVerified(merchant);

    const chain = this.chain;
    const reason = checkAuthorizationFields(a, {
      router: chain.routerAddress, invoiceId: inv.invoiceId, expectedValue: parseUnits(inv.amountUsdt, USDT_DECIMALS), now: this.nowS(),
      maxWindowSec: this.cfg.limits.maxAuthWindowSec, minRemainingSec: this.cfg.limits.minAuthRemainingSec,
    });
    if (reason) this.reject(new ApiError("BAD_AUTHORIZATION", reason));
    let signer: Address;
    try { signer = await recoverAuthorizer(a, req.signature); }
    catch { this.reject(new ApiError("BAD_AUTHORIZATION", "signature could not be parsed")); }
    if (signer !== a.from) this.reject(new ApiError("BAD_AUTHORIZATION", "signature was not made by authorization.from"));

    const nonceKey = `${a.from.toLowerCase()}:${a.nonce}`;
    if (this.usedNonces.has(nonceKey)) this.reject(new ApiError("BAD_AUTHORIZATION", "authorization nonce already used"));
    if (this.inflightInvoices.has(inv.invoiceId)) this.reject(new ApiError("PAYMENT_IN_PROGRESS", "a payment for this invoice is already being processed"));
    this.inflightInvoices.add(inv.invoiceId);
    this.usedNonces.add(nonceKey);
    let ok = false;
    try {
      const onchain = await chain.getInvoice(inv.invoiceId);
      if (!onchain) this.reject(new ApiError("INVOICE_NOT_FOUND", "invoice does not exist on chain"));
      if (onchain.status !== "open") this.reject(new ApiError("INVOICE_NOT_OPEN", `invoice is ${onchain.status} on chain`));
      if (onchain.amount !== BigInt(a.value)) this.reject(new ApiError("BAD_AUTHORIZATION", "authorization.value must equal the on-chain invoice amount"));
      if (await chain.authorizationUsed(a.from, a.nonce)) this.reject(new ApiError("BAD_AUTHORIZATION", "authorization nonce already used on chain"));
      const { v, r, s, yParity } = parseSignature(req.signature);
      const out = await this.execute(merchant.wallet, {
        fn: "payWithAuthorization", invoiceId: inv.invoiceId, from: a.from, value: BigInt(a.value),
        validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce,
        v: v !== undefined ? Number(v) : yParity + 27, r, s,
      });
      ok = true;
      const ev = out.events.find((e) => e.name === "InvoicePaid");
      if (!ev) throw new ApiError("TX_FAILED", "InvoicePaid event missing from receipt", { txHash: out.txHash });
      const payment: Payment = {
        invoiceId: inv.invoiceId, merchant: merchant.wallet, payer: getAddress(String(ev.args.payer)),
        amountUsdt: formatUnits(BigInt(ev.args.amount as bigint), USDT_DECIMALS), txHash: out.txHash,
        gasless: Boolean(ev.args.gasless ?? true), paidAt: out.blockTimestamp,
      };
      const w1 = await this.persist("upsertInvoice", () => this.store.upsertInvoice({ ...inv, state: "paid", payTx: out.txHash }));
      const w2 = await this.persist("recordPayment", () => this.store.recordPayment(payment));
      this.stats.relayed++;
      this.notify(merchant.wallet, "invoice", inv.invoiceId);
      this.notify(merchant.wallet, "payment", inv.invoiceId);
      const storeWarning = [w1, w2].filter(Boolean).join("; ") || undefined;
      return { txHash: out.txHash, explorerUrl: this.txUrl(out.txHash), invoiceId: inv.invoiceId, state: "paid" as const, payment, ...(storeWarning ? { storeWarning } : {}) };
    } finally {
      this.inflightInvoices.delete(inv.invoiceId);
      // A nonce that never landed on chain may be retried; one that landed stays used forever.
      if (!ok) this.usedNonces.delete(nonceKey);
    }
  }

  // ---- merchant-signed actions (refund / withdraw) ----
  private parseDeadline(v: unknown): bigint {
    const d = parseUint(v, "deadline");
    const now = BigInt(this.nowS());
    if (d <= now) throw bad("deadline has passed");
    if (d > now + 86400n) throw bad("deadline must be within 24 hours");
    return d;
  }

  async refundTypedData(invoiceId: Hex, amountRaw: unknown) {
    const inv = await this.loadInvoice(invoiceId);
    const onchain = await this.chain.getInvoice(inv.invoiceId);
    const amount = amountRaw === undefined || amountRaw === "" ? { units: onchain?.balance ?? parseUnits(inv.amountUsdt, USDT_DECIMALS) } : parseAmountUsdt(amountRaw);
    const nonce = await this.chain.merchantNonce(inv.merchant);
    const deadline = BigInt(this.nowS() + 600);
    return buildRefundTypedData(this.chain.routerAddress, { invoiceId: inv.invoiceId, amount: amount.units, nonce, deadline });
  }

  async withdrawTypedData(invoiceId: Hex) {
    const inv = await this.loadInvoice(invoiceId);
    const nonce = await this.chain.merchantNonce(inv.merchant);
    const deadline = BigInt(this.nowS() + 600);
    return buildWithdrawTypedData(this.chain.routerAddress, { invoiceId: inv.invoiceId, nonce, deadline });
  }

  private async checkMerchantSig(merchant: Address, typed: Parameters<typeof recoverTypedDataAddress>[0], ) {
    let signer: Address;
    try { signer = getAddress(await recoverTypedDataAddress(typed)); }
    catch { this.reject(new ApiError("BAD_SIGNATURE", "merchant signature could not be parsed")); }
    if (signer !== merchant) this.reject(new ApiError("BAD_SIGNATURE", "signature was not made by the invoice's merchant"));
  }

  private sig(v: unknown): Hex {
    if (typeof v !== "string" || !isHex(v) || v.length < 132) throw bad("signature must be a hex string");
    return v as Hex;
  }

  async refund(invoiceId: Hex, body: unknown, ip: string) {
    const b = (body ?? {}) as Record<string, unknown>;
    const signature = this.sig(b.signature);
    const deadline = this.parseDeadline(b.deadline);
    this.limit([
      { limiter: this.limits.global, key: "global", name: "global" },
      { limiter: this.limits.ip, key: ip, name: "per IP" },
    ]);
    const inv = await this.loadInvoice(invoiceId);
    if (inv.state !== "paid") this.reject(new ApiError("INVOICE_NOT_PAID", `invoice is ${inv.state}; only paid invoices can be refunded`));
    const merchant = await this.loadMerchant(inv.merchant);
    this.requireVerified(merchant);
    const onchain = await this.chain.getInvoice(inv.invoiceId);
    if (!onchain || onchain.status !== "paid") this.reject(new ApiError("INVOICE_NOT_PAID", `invoice is ${onchain?.status ?? "missing"} on chain`));
    if (onchain.balance === 0n) this.reject(new ApiError("INVOICE_NOT_PAID", onchain.financed ? "financed invoice: the payment went to the note escrow and cannot be refunded" : "nothing left to refund"));
    // Default: refund everything still held for this invoice.
    const amount = b.amountUsdt === undefined || b.amountUsdt === "" ? { units: onchain.balance } : parseAmountUsdt(b.amountUsdt);
    if (amount.units > onchain.balance) throw bad(`refund exceeds the ${formatUnits(onchain.balance, USDT_DECIMALS)} USDT held for this invoice`);
    const nonce = await this.chain.merchantNonce(merchant.wallet);
    await this.checkMerchantSig(merchant.wallet, {
      ...buildRefundTypedData(this.chain.routerAddress, { invoiceId: inv.invoiceId, amount: amount.units, nonce, deadline }),
      signature,
    });
    const out = await this.execute(merchant.wallet, { fn: "refundWithSig", invoiceId: inv.invoiceId, amount: amount.units, deadline, signature });
    const ev = out.events.find((e) => e.name === "InvoiceRefunded");
    if (!ev) throw new ApiError("TX_FAILED", "InvoiceRefunded event missing from receipt", { txHash: out.txHash });
    const refunded = BigInt(ev.args.amount as bigint);
    // State from the chain after the tx, not from assumptions: Refunded only when refunded == amount.
    const after = await this.chain.getInvoice(inv.invoiceId).catch(() => null);
    const full = after ? after.status === "refunded" : refunded >= parseUnits(inv.amountUsdt, USDT_DECIMALS);
    const warns: (string | undefined)[] = [];
    if (full) warns.push(await this.persist("upsertInvoice", () => this.store.upsertInvoice({ ...inv, state: "refunded" })));
    const p = await this.store.getPayment(inv.invoiceId).catch(() => null);
    if (p) warns.push(await this.persist("recordPayment", () => this.store.recordPayment({ ...p, refundTx: out.txHash })));
    this.stats.refunds++;
    this.notify(merchant.wallet, "invoice", inv.invoiceId);
    this.notify(merchant.wallet, "payment", inv.invoiceId);
    const storeWarning = warns.filter(Boolean).join("; ") || undefined;
    return {
      txHash: out.txHash, explorerUrl: this.txUrl(out.txHash), invoiceId: inv.invoiceId,
      refundedUsdt: formatUnits(refunded, USDT_DECIMALS), to: ev.args.to ? getAddress(String(ev.args.to)) : undefined,
      state: full ? ("refunded" as const) : inv.state, ...(storeWarning ? { storeWarning } : {}),
    };
  }

  async withdraw(invoiceId: Hex, body: unknown, ip: string) {
    const b = (body ?? {}) as Record<string, unknown>;
    const signature = this.sig(b.signature);
    const deadline = this.parseDeadline(b.deadline);
    this.limit([
      { limiter: this.limits.global, key: "global", name: "global" },
      { limiter: this.limits.ip, key: ip, name: "per IP" },
    ]);
    const inv = await this.loadInvoice(invoiceId);
    const merchant = await this.loadMerchant(inv.merchant);
    this.requireVerified(merchant);
    const onchain = await this.chain.getInvoice(inv.invoiceId);
    if (!onchain || onchain.balance === 0n) this.reject(new ApiError("INVOICE_NOT_PAID", "nothing to withdraw for this invoice"));
    const nonce = await this.chain.merchantNonce(merchant.wallet);
    await this.checkMerchantSig(merchant.wallet, {
      ...buildWithdrawTypedData(this.chain.routerAddress, { invoiceId: inv.invoiceId, nonce, deadline }),
      signature,
    });
    const out = await this.execute(merchant.wallet, { fn: "withdrawWithSig", invoiceId: inv.invoiceId, deadline, signature });
    const ev = out.events.find((e) => e.name === "Withdrawn");
    this.stats.withdrawals++;
    this.notify(merchant.wallet, "invoice", inv.invoiceId);
    return {
      txHash: out.txHash, explorerUrl: this.txUrl(out.txHash), invoiceId: inv.invoiceId,
      withdrawnUsdt: ev ? formatUnits(BigInt(ev.args.amount as bigint), USDT_DECIMALS) : undefined,
    };
  }

  budgetFor(m: Address) {
    return {
      merchant: m, dailyLimitWei: this.budget.dailyLimitWei.toString(), usedTodayWei: this.budget.usedToday(m).toString(),
      reservedWei: this.budget.reservedToday(m).toString(), remainingTodayWei: this.budget.remainingToday(m).toString(),
    };
  }
}


