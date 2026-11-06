// Write-decision tests for ArkivStore against a TEST-ONLY fake of the two SDK clients.
// The fake evaluates the store's real query expressions (eq / gt / and) over an in-memory table, so
// these tests check which Arkiv operations the store sends, not a mock of its answers.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Address, Hex, Invoice, Payment } from "@paisalink/shared";
import { ArkivStore } from "../src/store";

const W = "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb" as Address;
const M = "0xC038827b4E362B0de1Be859377508613CD028946" as Address;
const ID = ("0x" + "ab".repeat(32)) as Hex;
const TX = ("0x" + "cd".repeat(32)) as Hex;

type Row = { tag: string; owner: string; values: Record<string, { type: string; value: unknown }>; expiresAt: bigint; createdAt: bigint };
type Node = { kind: string; name?: string; operator?: string; value?: { value: unknown }; expressions?: Node[] };

const norm = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
function matches(n: Node, key: string, r: Row): boolean {
  if (n.kind === "and") return n.expressions!.every((e) => matches(e, key, r));
  const left = n.name === "$key" ? key : r.values[n.name!]?.value;
  const right = n.value!.value;
  if (n.operator === "=") return norm(left) === norm(right);
  if (n.operator === ">") return String(left) > String(right);
  throw new Error(`fake: unsupported ${n.operator}`);
}
const typed = (v: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "object" && x && "type" in x ? x : { type: "str", value: x }])) as Row["values"];

function fakeArkiv() {
  const table = new Map<string, Row>();
  const ops: string[] = [];
  let head = 1000n;
  let n = 0;
  const newKey = () => ("0x" + (++n).toString(16).padStart(64, "0")) as Hex;
  const tx = () => ("0x" + (head++).toString(16).padStart(64, "0")) as Hex;
  const builder = () => {
    const st: { tag?: string; where?: Node; owner?: string; limit?: number } = {};
    const b = {
      from(s: { name: string }) { st.tag = s.name; return b; },
      where(e: Node) { st.where = e; return b; },
      ownedBy(o: string) { st.owner = o.toLowerCase(); return b; },
      orderBy() { return b; },
      limit(l: number) { st.limit = l; return b; },
      async fetch() {
        const rows = [...table.entries()]
          .filter(([k, r]) => r.tag === st.tag && (!st.owner || r.owner === st.owner) && (!st.where || matches(st.where, k, r)))
          .sort(([a], [b2]) => (a < b2 ? -1 : 1))
          .slice(0, st.limit ?? 100)
          .map(([k, r]) => ({ $key: k, $expiresAt: r.expiresAt, $createdAt: r.createdAt, ...r.values }));
        return { entities: rows, blockNumber: head + 10n, skipped: 0 };
      },
    };
    return b;
  };
  const create = (s: { name: string }, values: Record<string, unknown>, blocks: bigint) => {
    const k = newKey();
    table.set(k, { tag: s.name, owner: W.toLowerCase(), values: typed(values), expiresAt: head + blocks, createdAt: head });
    return k;
  };
  const patch = (k: Hex, set: Record<string, unknown>) => {
    const r = table.get(k)!;
    r.values = { ...r.values, ...typed(set) };
  };
  const life = (e: { minLifetime: bigint }) => e.minLifetime;
  const pub = {
    select: () => builder(),
    getBlockNumber: async () => head,
    getTransactionReceipt: async () => ({ blockNumber: head }),
    getEntity: async () => { throw new Error("unused"); },
  };
  const wallet = {
    account: { address: W },
    async createEntity(s: { name: string }, v: Record<string, unknown>, o: { expiration: { minLifetime: bigint } }) {
      ops.push(`create ${s.name}`);
      const k = create(s, v, life(o.expiration));
      return { entityKey: k, txHash: tx(), expiresAt: table.get(k)!.expiresAt };
    },
    async patchEntity(_s: unknown, k: Hex, c: { set: Record<string, unknown> }) {
      ops.push(`patch ${Object.keys(c.set).sort().join(",")}`);
      patch(k, c.set);
      return { entityKey: k, txHash: tx() };
    },
    async extendEntity(d: { entityKey: Hex; expiration: { minLifetime: bigint } }) {
      ops.push("extend");
      table.get(d.entityKey)!.expiresAt = head + life(d.expiration);
      return { entityKey: d.entityKey, txHash: tx(), expiresAt: table.get(d.entityKey)!.expiresAt };
    },
    async executeBatch(b: {
      creates?: { schema: { name: string }; values: Record<string, unknown>; expiration: { minLifetime: bigint } }[];
      patches?: { entityKey: Hex; set: Record<string, unknown> }[];
      extensions?: { entityKey: Hex; expiration: { minLifetime: bigint } }[];
    }) {
      ops.push(`batch c${b.creates?.length ?? 0} p${b.patches?.length ?? 0} e${b.extensions?.length ?? 0}`);
      const created = (b.creates ?? []).map((c) => create(c.schema, c.values, life(c.expiration)));
      for (const p of b.patches ?? []) patch(p.entityKey, p.set);
      for (const e of b.extensions ?? []) table.get(e.entityKey)!.expiresAt = head + life(e.expiration);
      return { txHash: tx(), createdEntities: created };
    },
  };
  return { table, ops, pub, wallet, advance: (blocks: bigint) => (head += blocks) };
}

let f: ReturnType<typeof fakeArkiv>;
let store: ArkivStore;
beforeEach(() => {
  f = fakeArkiv();
  store = new ArkivStore({ ARKIV_ACCESS_KEY: "test", ARKIV_WRITER_ADDRESS: W });
  Object.assign(store, { pub: f.pub, wallet: f.wallet });
  store.onWrite = () => {};
});
const now = () => Math.floor(Date.now() / 1000);
const inv = (over: Partial<Invoice> = {}): Invoice => ({ invoiceId: ID, merchant: M, amountUsdt: "49", dueAt: now() + 86400, memo: "logo", state: "open", ...over });

describe("ArkivStore write decisions", () => {
  test("first upsert creates, identical upsert sends nothing, a change patches only that column", async () => {
    await store.upsertInvoice(inv());
    await store.upsertInvoice(inv());
    await store.upsertInvoice(inv({ memo: "logo v2" }));
    expect(f.ops).toEqual(["create paisalink.invoices", "patch memo"]);
    expect(store.writes.map((w) => w.op)).toEqual(["create", "noop", "patch"]);
    expect(f.table.size).toBe(1);
  });

  test("a second store instance (cold cache) finds the entity by invoice_id instead of duplicating", async () => {
    await store.upsertInvoice(inv());
    const other = new ArkivStore({ ARKIV_ACCESS_KEY: "test", ARKIV_WRITER_ADDRESS: W });
    Object.assign(other, { pub: f.pub, wallet: f.wallet });
    await other.upsertInvoice(inv({ invoiceId: ID.toUpperCase().replace("0X", "0x") as Hex }));
    expect(f.table.size).toBe(1);
    expect(other.writes.at(-1)!.op).toBe("noop");
  });

  test("leaving swarmRef out of a later upsert keeps it (no implicit unset)", async () => {
    await store.upsertInvoice(inv({ swarmRef: "a".repeat(64) }));
    await store.upsertInvoice(inv({ state: "refunded" }));
    expect((await store.getInvoice(ID))?.swarmRef).toBe("a".repeat(64));
  });

  test("recordPayment: one batch creates the receipt, marks the invoice paid and extends it", async () => {
    await store.upsertInvoice(inv());
    const p: Payment = { invoiceId: ID, merchant: M, payer: M, amountUsdt: "49", txHash: TX, gasless: true, paidAt: now() };
    await store.recordPayment(p);
    expect(f.ops).toEqual(["create paisalink.invoices", "batch c1 p1 e1"]);
    const got = await store.getInvoice(ID);
    expect(got?.state).toBe("paid");
    expect(got?.payTx).toBe(TX);
    expect((await store.getPayment(ID))?.txHash).toBe(TX);
    // A later upsert of the paid invoice by the API is a no-op (state and pay_tx already match).
    await store.upsertInvoice({ ...got! });
    expect(store.writes.at(-1)!.op).toBe("noop");
  });

  test("a refund on an existing payment patches refund_tx", async () => {
    const p: Payment = { invoiceId: ID, merchant: M, payer: M, amountUsdt: "49", txHash: TX, gasless: false, paidAt: now() };
    await store.recordPayment(p);
    await store.recordPayment({ ...p, refundTx: TX });
    expect(f.ops).toEqual(["create paisalink.payments", "patch refund_tx"]);
  });

  test("merchant lease: a patch after the lease has run down also extends, in one batch", async () => {
    await store.upsertMerchant({ wallet: M, handle: "priya.designs", verified: false, gasUsedWei: "0", createdAt: 1 });
    await store.setMerchantVerified(M, true);
    f.advance(BigInt((10 * 86400) / 2)); // 10 days later
    await store.addMerchantGasUsed(M, 21000n * 5_000_000_000n);
    expect(f.ops).toEqual(["create paisalink.merchants", "patch verified", "batch c0 p1 e1"]);
    expect((await store.getMerchant(M))?.gasUsedWei).toBe("105000000000000");
    expect((await store.getMerchant(M))?.verified).toBe(true);
  });

  test("created_at never moves on a merchant upsert", async () => {
    await store.upsertMerchant({ wallet: M, handle: "priya.designs", verified: false, gasUsedWei: "0", createdAt: 111 });
    const m = await store.upsertMerchant({ wallet: M, handle: "priya.designs", verified: false, gasUsedWei: "0", createdAt: 999 });
    expect(m.createdAt).toBe(111);
    expect(store.writes.at(-1)!.op).toBe("noop");
  });

  test("concurrent writes are serialized (no duplicate create from a check-then-create race)", async () => {
    await Promise.all([store.upsertInvoice(inv()), store.upsertInvoice(inv()), store.upsertInvoice(inv({ memo: "x" }))]);
    expect(f.table.size).toBe(1);
    expect(f.ops).toEqual(["create paisalink.invoices", "patch memo"]);
  });

  test("lists are scoped to the merchant and to the writer", async () => {
    await store.upsertInvoice(inv());
    await store.upsertInvoice(inv({ invoiceId: ("0x" + "01".repeat(32)) as Hex, merchant: W }));
    // A forged invoice from someone else, tagged with our schema name:
    f.table.set("0x" + "ff".repeat(32), { tag: "paisalink.invoices", owner: "0x000000000000000000000000000000000000dead", values: { merchant: { type: "addr", value: M } }, expiresAt: 0n, createdAt: 0n });
    expect((await store.listInvoicesByMerchant(M)).map((i) => i.invoiceId)).toEqual([ID]);
  });

  test("writes are refused without an access key unless explicitly allowed", async () => {
    const anon = new ArkivStore({ ARKIV_WRITER_ADDRESS: W });
    Object.assign(anon, { pub: f.pub, wallet: f.wallet });
    await expect(anon.upsertInvoice(inv())).rejects.toThrow(/ARKIV_ACCESS_KEY/);
    const ro = new ArkivStore({ ARKIV_ACCESS_KEY: "test" });
    Object.assign(ro, { pub: f.pub });
    await expect(ro.upsertInvoice(inv())).rejects.toThrow(/read-only/);
  });
});
