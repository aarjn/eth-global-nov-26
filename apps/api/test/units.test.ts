import { describe, expect, test } from "bun:test";
import { SlidingWindowLimiter, consumeAll } from "../src/ratelimit";
import { GasBudget } from "../src/budget";
import { TxQueue } from "../src/queue";
import { buildExportCsv, csvField, CSV_HEADER } from "../src/csv";
import type { Invoice, Payment } from "@paisalink/shared";

describe("SlidingWindowLimiter", () => {
  test("allows limit hits per window, then frees up as hits age out", () => {
    let t = 0;
    const l = new SlidingWindowLimiter(3, 1000, () => t);
    for (let i = 0; i < 3; i++) { expect(l.remaining("a")).toBeGreaterThan(0); l.hit("a"); t += 100; }
    expect(l.remaining("a")).toBe(0);
    expect(l.retryAfterSec("a")).toBe(1);
    expect(l.remaining("b")).toBe(3);
    t = 1001; // first hit (t=0) aged out
    expect(l.remaining("a")).toBe(1);
  });
  test("consumeAll is all-or-nothing", () => {
    const a = new SlidingWindowLimiter(5, 1000, () => 0), b = new SlidingWindowLimiter(1, 1000, () => 0);
    expect(consumeAll([{ limiter: a, key: "k", name: "a" }, { limiter: b, key: "k", name: "b" }])).toBeNull();
    expect(consumeAll([{ limiter: a, key: "k", name: "a" }, { limiter: b, key: "k", name: "b" }])?.name).toBe("b");
    expect(a.remaining("k")).toBe(4); // the blocked attempt did not consume from a
  });
});

describe("GasBudget", () => {
  const M = "0xC038827b4E362B0de1Be859377508613CD028946" as const;
  test("reserve / settle / daily reset", () => {
    let t = Date.UTC(2026, 10, 6, 23, 0);
    const g = new GasBudget(100n, () => t);
    const r1 = g.reserve(M, 60n)!;
    expect(g.reserve(M, 50n)).toBeNull(); // 60 reserved + 50 > 100
    g.settle(r1, 40n);                    // actual cheaper than estimate
    expect(g.usedToday(M)).toBe(40n);
    expect(g.remainingToday(M)).toBe(60n);
    const r2 = g.reserve(M, 60n)!; g.settle(r2, 0n); // never landed: nothing charged
    expect(g.usedToday(M)).toBe(40n);
    expect(g.snapshot()).toEqual([{ merchant: M.toLowerCase(), usedWei: "40", reservedWei: "0" }]);
    t += 2 * 3600_000; // next UTC day
    expect(g.remainingToday(M)).toBe(100n);
  });
});

describe("TxQueue", () => {
  test("runs jobs one at a time in order, survives failures", async () => {
    const q = new TxQueue();
    const log: string[] = [];
    let active = 0, maxActive = 0;
    const job = (name: string, fail = false) => q.run(async () => {
      active++; maxActive = Math.max(maxActive, active); log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`end ${name}`); active--;
      if (fail) throw new Error(name);
      return name;
    });
    const res = await Promise.allSettled([job("a"), job("b", true), job("c")]);
    expect(maxActive).toBe(1);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(res.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(q.pending).toBe(0);
  });
});

describe("CSV export", () => {
  const inv = (id: string, state: Invoice["state"], memo: string, dueAt: number): Invoice =>
    ({ invoiceId: `0x${id.repeat(64)}` as `0x${string}`, merchant: "0xC038827b4E362B0de1Be859377508613CD028946", amountUsdt: "49", dueAt, memo, state });
  test("fields are escaped and formula injection is neutralised", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvField("+91 call")).toBe("'+91 call");
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(undefined)).toBe("");
  });
  test("one row per invoice, joined with payment, newest first", () => {
    const a = inv("a", "paid", "Logo, v2", 1_800_000_000);
    const b = inv("b", "open", "=cmd", 1_800_100_000);
    const p: Payment = { invoiceId: a.invoiceId, merchant: a.merchant, payer: "0x32c84603C9848FFa470FB07C9bCe820944D04c52", amountUsdt: "49", txHash: `0x${"1".repeat(64)}`, gasless: true, paidAt: 1_800_050_000, refundTx: `0x${"2".repeat(64)}` };
    const csv = buildExportCsv([a, b], [p], "https://explorer.testnet.whitechain.io");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toStartWith(",0xbbbb"); // open invoice: no paid date, due later -> first
    expect(lines[1]).toContain("'=cmd");
    expect(lines[2]).toBe([
      "2027-01-15T21:53:20Z", a.invoiceId, '"Logo, v2"', "49", "USDT", p.payer,
      `https://explorer.testnet.whitechain.io/tx/${p.txHash}`, "paid", `https://explorer.testnet.whitechain.io/tx/${p.refundTx}`, "2027-01-15T08:00:00Z",
    ].join(","));
  });
});
