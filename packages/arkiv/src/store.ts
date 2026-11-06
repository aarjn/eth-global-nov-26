// ArkivStore: the production PaisaStore. Arkiv is the ONLY database; nothing here falls back to memory.
import { NoEntityFoundError, type Schema } from "@arkiv-network/sdk";
import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { addr, key, str, u64 } from "@arkiv-network/sdk/schema";
import type { Address, Hex, Invoice, Merchant, Note, PaisaStore, Payment } from "@paisalink/shared";
import { getAddress, isAddressEqual } from "viem";
import {
  type ArkivEnv,
  type ArkivPublicClient,
  type ArkivWalletClient,
  explorerEntity,
  makePublicClient,
  makeWalletClient,
  makeWsClient,
  rateLimitState,
  writerAddress,
} from "./client";
import {
  diffValues,
  invoiceFromRow,
  invoiceLifetime,
  invoiceToValues,
  merchantFromRow,
  merchantLifetime,
  merchantToValues,
  normId,
  noteFromRow,
  noteLifetime,
  noteToValues,
  paymentFromRow,
  paymentLifetime,
  paymentToValues,
  toExpiry,
  DAY,
  BLOCK_SECONDS,
} from "./mapping";
import { type EntityKind, Invoices, KIND_BY_TAG, Merchants, Notes, Payments } from "./schemas";

/** Only extend an entity when it gains at least this much life (saves a tx on every patch). */
const EXTEND_SLACK_BLOCKS = BigInt(DAY / BLOCK_SECONDS);
const PAGE = 100; // node maximum
const CACHE_FRESH_MS = 30_000;

/** What happened on the last write, for logs, the README tx table and the explorer checkpoint. */
export interface WriteReceipt {
  kind: EntityKind;
  id: string;
  op: "create" | "patch" | "extend" | "patch+extend" | "noop" | "batch";
  entityKey: Hex;
  txHash?: Hex;
  explorerUrl: string;
}

interface Classified {
  kind: EntityKind;
  id: string;
  merchant: Address;
}

interface Cached {
  key: Hex;
  values: Record<string, unknown>;
  expiresAt: bigint;
  at: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SCHEMA_OF: Record<EntityKind, Schema> = { merchant: Merchants, invoice: Invoices, payment: Payments, note: Notes };

export class ArkivStore implements PaisaStore {
  readonly writer: Address;
  readonly pub: ArkivPublicClient;
  private readonly wallet: ArkivWalletClient | undefined;
  private readonly env: ArkivEnv;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, Cached>();
  /** Reads must come from a block after this one (read-after-write, arkiv node #241). */
  private floor = 0n;
  /** Every write this process made, newest last. */
  readonly writes: WriteReceipt[] = [];
  onWrite?: (w: WriteReceipt) => void;

  constructor(env: ArkivEnv) {
    this.env = env;
    this.pub = makePublicClient(env);
    this.wallet = makeWalletClient(env);
    this.writer = writerAddress(env);
    if (this.wallet && !isAddressEqual(this.wallet.account.address, this.writer)) {
      throw new Error(`ARKIV_WRITER_ADDRESS ${this.writer} does not match the ARKIV_PRIVATE_KEY account`);
    }
  }

  get canWrite() {
    return this.wallet !== undefined;
  }

  // ---------------- merchants ----------------

  async upsertMerchant(m: Merchant): Promise<Merchant> {
    const wallet = getAddress(m.wallet);
    return this.serial(async () => {
      const cur = await this.findMerchantRow(wallet);
      const next: Merchant = cur
        ? { ...m, wallet, createdAt: cur.domain.createdAt } // created_at never moves
        : { ...m, wallet };
      await this.upsert("merchant", wallet.toLowerCase(), merchantToValues(next), merchantLifetime(), cur?.cached);
      return next;
    });
  }

  async getMerchant(wallet: Address): Promise<Merchant | null> {
    return (await this.findMerchantRow(getAddress(wallet)))?.domain ?? null;
  }

  /** Not in PaisaStore: handle lookup for uniqueness checks (handle is indexed). */
  async getMerchantByHandle(handle: string): Promise<Merchant | null> {
    const page = await this.fresh(() =>
      this.pub.select().from(Merchants).where(eq("handle", handle)).ownedBy(this.writer).limit(1).fetch(),
    );
    const row = page.entities[0];
    return row ? merchantFromRow(row) : null;
  }

  async setMerchantVerified(wallet: Address, verified: boolean): Promise<void> {
    await this.serial(async () => {
      const cur = await this.findMerchantRow(getAddress(wallet));
      if (!cur) throw new Error(`merchant ${wallet} not found on Arkiv; POST /merchants first`);
      const next = { ...cur.domain, verified };
      await this.upsert("merchant", next.wallet.toLowerCase(), merchantToValues(next), merchantLifetime(), cur.cached);
    });
  }

  async addMerchantGasUsed(wallet: Address, weiDelta: bigint): Promise<void> {
    if (weiDelta === 0n) return;
    await this.serial(async () => {
      const cur = await this.findMerchantRow(getAddress(wallet));
      if (!cur) throw new Error(`merchant ${wallet} not found on Arkiv`);
      const next = { ...cur.domain, gasUsedWei: (BigInt(cur.domain.gasUsedWei) + weiDelta).toString() };
      await this.upsert("merchant", next.wallet.toLowerCase(), merchantToValues(next), merchantLifetime(), cur.cached);
    });
  }

  private async findMerchantRow(wallet: Address) {
    const hit = this.cached("merchant", wallet.toLowerCase());
    if (hit) return { domain: merchantFromRow(hit.values as never), cached: hit };
    const page = await this.fresh(() =>
      this.pub.select().from(Merchants).where(eq("wallet", addr(wallet))).ownedBy(this.writer).limit(1).fetch(),
    );
    const row = page.entities[0];
    if (!row) return null;
    const cached = this.remember("merchant", wallet.toLowerCase(), row.$key, row, row.$expiresAt);
    return { domain: merchantFromRow(row), cached };
  }

  // ---------------- invoices ----------------

  async upsertInvoice(inv: Invoice): Promise<Invoice> {
    const id = normId(inv.invoiceId);
    return this.serial(async () => {
      const cur = await this.findRow("invoice", id);
      const values = invoiceToValues(inv);
      await this.upsert("invoice", id, values, invoiceLifetime(inv, nowSec()), cur);
      return invoiceFromRow(values as never);
    });
  }

  async getInvoice(invoiceId: Hex): Promise<Invoice | null> {
    const page = await this.fresh(() =>
      this.pub.select().from(Invoices).where(eq("invoice_id", normId(invoiceId))).ownedBy(this.writer).limit(1).fetch(),
    );
    const row = page.entities[0];
    return row ? invoiceFromRow(row) : null;
  }

  /** Newest first (by Arkiv $createdAt block). */
  async listInvoicesByMerchant(merchant: Address): Promise<Invoice[]> {
    const rows = await this.all(Invoices, eq("merchant", addr(merchant)));
    return rows
      .sort((a, b) => Number((b.$createdAt ?? 0n) - (a.$createdAt ?? 0n)))
      .map((r) => invoiceFromRow(r as never));
  }

  /** The query string listInvoicesByMerchant sends, for the README / scripts/query.ts. */
  invoicesQueryString(merchant: Address): string {
    return this.pub.select().from(Invoices).where(eq("merchant", addr(merchant))).ownedBy(this.writer).toString();
  }

  // ---------------- payments ----------------

  /**
   * Records a payment. If the invoice exists and is still "open", the same transaction also patches
   * it to state "paid" with pay_tx (atomic batch: a receipt never exists for an unpaid invoice).
   */
  async recordPayment(p: Payment): Promise<Payment> {
    const id = normId(p.invoiceId);
    return this.serial(async () => {
      const values = paymentToValues(p);
      const curPay = await this.findRow("payment", id);
      if (curPay) {
        await this.upsert("payment", id, values, paymentLifetime(), curPay);
        return paymentFromRow(values as never);
      }
      const inv = await this.findRow("invoice", id);
      const w = this.requireWallet();
      if (inv && (inv.values.state as { value: string }).value === "open") {
        const invNext = { ...inv.values, state: str("paid"), pay_tx: str(normId(p.txHash)) } as Record<string, unknown>;
        const { set } = diffValues(inv.values, invNext, []);
        const dueAt = Number((inv.values.due_at as { value: bigint }).value);
        const invLife = invoiceLifetime({ dueAt, state: "paid" }, nowSec());
        const head = await this.pub.getBlockNumber();
        const extend = head + invLife > inv.expiresAt + EXTEND_SLACK_BLOCKS;
        // One transaction: create the receipt, mark the invoice paid, and (if needed) extend the
        // invoice to the paid lifetime. All apply or none do.
        const res = await w.executeBatch({
          creates: [{ schema: Payments, values, expiration: toExpiry(paymentLifetime()) }],
          patches: [{ schema: Invoices, entityKey: inv.key, set: set as never }],
          ...(extend ? { extensions: [{ entityKey: inv.key, expiration: toExpiry(invLife) }] } : {}),
        });
        const payKey = res.createdEntities[0]!;
        const block = await this.afterWrite(res.txHash);
        this.remember("payment", id, payKey, values, block + paymentLifetime());
        this.remember("invoice", id, inv.key, invNext, extend ? block + invLife : inv.expiresAt);
        this.log({ kind: "payment", id, op: "batch", entityKey: payKey, txHash: res.txHash, explorerUrl: explorerEntity(payKey) });
        this.log({ kind: "invoice", id, op: "batch", entityKey: inv.key, txHash: res.txHash, explorerUrl: explorerEntity(inv.key) });
      } else {
        await this.upsert("payment", id, values, paymentLifetime(), null);
      }
      return paymentFromRow(values as never);
    });
  }

  async getPayment(invoiceId: Hex): Promise<Payment | null> {
    const page = await this.fresh(() =>
      this.pub.select().from(Payments).where(eq("invoice_id", normId(invoiceId))).ownedBy(this.writer).limit(1).fetch(),
    );
    const row = page.entities[0];
    return row ? paymentFromRow(row) : null;
  }

  /** Newest first (by paid_at). */
  async listPaymentsByMerchant(merchant: Address): Promise<Payment[]> {
    const rows = await this.all(Payments, eq("merchant", addr(merchant)));
    return rows.map((r) => paymentFromRow(r as never)).sort((a, b) => b.paidAt - a.paidAt);
  }

  // ---------------- notes ----------------

  async upsertNote(n: Note): Promise<Note> {
    const id = String(n.noteId);
    return this.serial(async () => {
      const cur = await this.findRow("note", id);
      const values = noteToValues(n);
      await this.upsert("note", id, values, noteLifetime(n, nowSec()), cur);
      return noteFromRow(values as never);
    });
  }

  /** Every note the writer mirrored, by note id. */
  async listNotes(): Promise<Note[]> {
    const rows = await this.all(Notes);
    return rows.map((r) => noteFromRow(r as never)).sort((a, b) => a.noteId - b.noteId);
  }

  // ---------------- live updates ----------------

  /**
   * Live updates over WebSocket (watchEntityEvents pushes; it never replays history). One watcher
   * per store is shared by every subscriber. Events carry only the entity key and owner, so each
   * writer-owned key is classified once by fetching the entity (schema tag + merchant) and remembered.
   */
  watchMerchant(merchant: Address, onChange: (kind: "invoice" | "payment" | "note", id: string) => void): () => void {
    const want = getAddress(merchant);
    const listener = (c: Classified) => {
      if (c.kind !== "merchant" && isAddressEqual(c.merchant, want)) onChange(c.kind, c.id);
    };
    this.listeners.add(listener);
    this.startWatcher();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopWatcher?.();
    };
  }

  private listeners = new Set<(c: Classified) => void>();
  private known = new Map<Hex, Classified | null>();
  private stopWatcher: (() => void) | undefined;
  private ws: ReturnType<typeof makeWsClient> | undefined;

  private startWatcher() {
    if (this.stopWatcher) return;
    this.ws ??= makeWsClient(this.env);
    const unwatch = this.ws.watchEntityEvents({
      onEvent: (ev) => {
        const owner = "owner" in ev ? ev.owner : ev.newOwner;
        if (!isAddressEqual(owner, this.writer)) return;
        void this.classify(ev.entityKey)
          .then((c) => {
            if (c) for (const l of this.listeners) l(c);
          })
          .catch((err) => console.error("[arkiv] watch classify failed:", (err as Error).message));
      },
      onError: (err) => console.error("[arkiv] watchEntityEvents error:", err.message),
    });
    this.stopWatcher = () => {
      unwatch();
      this.stopWatcher = undefined;
    };
  }

  private async classify(entityKey: Hex): Promise<Classified | null> {
    const k = this.known.get(entityKey);
    if (k !== undefined) return k;
    let e;
    try {
      e = await this.pub.getEntity(entityKey);
    } catch (err) {
      if (err instanceof NoEntityFoundError) return null; // deleted/expired and never seen
      throw err;
    }
    const attrs = e.$attributes ?? {};
    const tag = attrs["arkiv.schema"]?.value;
    const kind = typeof tag === "string" ? KIND_BY_TAG[tag] : undefined;
    const m = (attrs.merchant ?? attrs.issuer ?? attrs.wallet)?.value;
    if (!kind || typeof m !== "string") {
      this.known.set(entityKey, null);
      return null;
    }
    const id = kind === "note" ? String(attrs.note_id?.value) : kind === "merchant" ? m.toLowerCase() : String(attrs.invoice_id?.value);
    const c: Classified = { kind, id, merchant: getAddress(m) };
    this.known.set(entityKey, c);
    return c;
  }

  // ---------------- internals ----------------

  /** Runs write paths one at a time: one writer wallet, one nonce sequence, no check-then-create races. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private requireWallet(): ArkivWalletClient {
    if (!this.wallet) throw new Error("Arkiv store is read-only: ARKIV_PRIVATE_KEY is not set");
    if (!this.env.ARKIV_ACCESS_KEY && this.env.ARKIV_ALLOW_ANON_WRITES !== "1") {
      throw new Error(
        "Refusing to write to Arkiv without ARKIV_ACCESS_KEY (anonymous writes risk the ~27 min 429 " +
          "ANON_COST_LIMITED lockout). Set ARKIV_ALLOW_ANON_WRITES=1 to override.",
      );
    }
    return this.wallet;
  }

  /** Create, patch, extend, or nothing — whatever brings the entity for (kind, id) to `values`. */
  private async upsert(kind: EntityKind, id: string, values: Record<string, unknown>, lifetime: bigint, cur: Cached | null | undefined) {
    const schema = SCHEMA_OF[kind];
    const w = this.requireWallet();
    if (!cur) {
      const res = await w.createEntity(schema, values as never, { expiration: toExpiry(lifetime) });
      await this.afterWrite(res.txHash);
      this.remember(kind, id, res.entityKey, values, res.expiresAt);
      return this.log({ kind, id, op: "create", entityKey: res.entityKey, txHash: res.txHash, explorerUrl: explorerEntity(res.entityKey) });
    }
    // Optional columns a caller leaves out are kept, not unset: an Invoice built without swarmRef
    // must not wipe the PDF reference another workstream wrote.
    const { set, unset } = diffValues(cur.values, values, []);
    const head = await this.pub.getBlockNumber();
    const extend = head + lifetime > cur.expiresAt + EXTEND_SLACK_BLOCKS;
    const patch = Object.keys(set).length > 0 || unset.length > 0;
    if (!patch && !extend) {
      return this.log({ kind, id, op: "noop", entityKey: cur.key, explorerUrl: explorerEntity(cur.key) });
    }
    const changes = { set: set as never, ...(unset.length ? { unset: unset as never } : {}) };
    let txHash: Hex;
    let expiresAt = cur.expiresAt;
    if (patch && extend) {
      const res = await w.executeBatch({
        patches: [{ schema, entityKey: cur.key, ...changes }],
        extensions: [{ entityKey: cur.key, expiration: toExpiry(lifetime) }],
      });
      txHash = res.txHash;
      expiresAt = head + lifetime;
    } else if (patch) {
      txHash = (await w.patchEntity(schema, cur.key, changes)).txHash;
    } else {
      const res = await w.extendEntity({ entityKey: cur.key, expiration: toExpiry(lifetime) });
      txHash = res.txHash;
      expiresAt = res.expiresAt;
    }
    await this.afterWrite(txHash);
    const merged: Record<string, unknown> = { ...cur.values, ...set };
    for (const k of unset) delete merged[k];
    this.remember(kind, id, cur.key, merged, expiresAt);
    const op = patch && extend ? "patch+extend" : patch ? "patch" : "extend";
    return this.log({ kind, id, op, entityKey: cur.key, txHash, explorerUrl: explorerEntity(cur.key) });
  }

  private async findRow(kind: Exclude<EntityKind, "merchant">, id: string): Promise<Cached | null> {
    const hit = this.cached(kind, id);
    if (hit) return hit;
    const schema = SCHEMA_OF[kind];
    const where = kind === "note" ? eq("note_id", u64(BigInt(id))) : eq("invoice_id", id);
    const page = await this.fresh(() => this.pub.select().from(schema).where(where).ownedBy(this.writer).limit(1).fetch());
    const row = page.entities[0] as (Record<string, unknown> & { $key: Hex; $expiresAt: bigint }) | undefined;
    if (!row) return null;
    return this.remember(kind, id, row.$key, row, row.$expiresAt);
  }

  /** All rows matching `where` (owned by the writer), paging by $key as the SDK docs recommend. */
  private async all<S extends Schema>(schema: S, where?: ReturnType<typeof eq>) {
    const out: Array<Record<string, unknown> & { $key: Hex; $createdAt?: bigint }> = [];
    let last: Hex | undefined;
    for (let i = 0; i < 50; i++) {
      const filters = [where, last ? gt("$key", key(last)) : undefined].filter((f) => f !== undefined);
      const page = await this.fresh(() => {
        const b = this.pub.select().from(schema).ownedBy(this.writer).orderBy(asc("$key") as never).limit(PAGE);
        // Generic over S, so the per-schema where() typing cannot apply here; filters are built above.
        return (filters.length ? (b as unknown as { where(e: unknown): typeof b }).where(and(filters)) : b).fetch();
      });
      const rows = page.entities as unknown as Array<Record<string, unknown> & { $key: Hex; $createdAt?: bigint }>;
      out.push(...rows);
      if (rows.length + page.skipped < PAGE || rows.length === 0) break;
      last = rows[rows.length - 1]!.$key;
    }
    return out;
  }

  /** Re-runs a query until the node answers from a block after our last write (arkiv node #241). */
  private async fresh<T extends { blockNumber: bigint }>(q: () => Promise<T>): Promise<T> {
    let res = await q();
    for (let i = 0; i < 6 && res.blockNumber <= this.floor; i++) {
      await sleep(700);
      res = await q();
    }
    return res;
  }

  /** Records the write's block as the read floor and returns it. */
  private async afterWrite(txHash: Hex): Promise<bigint> {
    let block: bigint;
    try {
      block = (await this.pub.getTransactionReceipt({ hash: txHash })).blockNumber;
    } catch {
      block = (await this.pub.getBlockNumber()) + 1n;
    }
    if (block > this.floor) this.floor = block;
    return block;
  }

  private cached(kind: EntityKind, id: string): Cached | undefined {
    const c = this.cache.get(`${kind}:${id}`);
    return c && Date.now() - c.at < CACHE_FRESH_MS ? c : undefined;
  }

  private remember(kind: EntityKind, id: string, entityKey: Hex, row: Record<string, unknown>, expiresAt: bigint | undefined): Cached {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (!k.startsWith("$") && v !== undefined) values[k] = v;
    const c: Cached = { key: entityKey, values, expiresAt: expiresAt ?? 0n, at: Date.now() };
    this.cache.set(`${kind}:${id}`, c);
    return c;
  }

  private log(w: WriteReceipt): WriteReceipt {
    this.writes.push(w);
    if (w.op !== "noop") console.log(`[arkiv] ${w.op} ${w.kind} ${w.id} ${w.explorerUrl}${w.txHash ? ` tx ${w.txHash}` : ""}`);
    this.onWrite?.(w);
    return w;
  }

  /** Explorer link of the entity for (kind, natural id), if this process has seen it. */
  explorerUrlFor(kind: EntityKind, id: string): string | undefined {
    const c = this.cache.get(`${kind}:${kind === "merchant" || kind === "note" ? id.toLowerCase() : normId(id)}`);
    return c ? explorerEntity(c.key) : undefined;
  }

  /** Health info for GET /health. */
  async health() {
    const [block, balance] = await Promise.all([
      this.pub.getBlockNumber(),
      this.pub.getBalance({ address: this.writer }),
    ]);
    return {
      chainId: 7794095,
      block: block.toString(),
      writer: this.writer,
      writerBalanceWei: balance.toString(),
      accessKey: !!this.env.ARKIV_ACCESS_KEY,
      canWrite: this.canWrite,
      rateLimit: rateLimitState(),
    };
  }
}

/** The production PaisaStore, backed by Arkiv Rabdi. Pass process.env (or a subset). */
export function createArkivStore(env: ArkivEnv = process.env as ArkivEnv): ArkivStore {
  return new ArkivStore(env);
}
