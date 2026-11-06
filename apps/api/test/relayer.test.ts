import { describe, expect, test } from "bun:test";
import { parseUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { checkAuthorizationFields, parseAmountUsdt } from "../src/relayer";
import { invoicePaymentNonce } from "@paisalink/shared";
import { ROUTER } from "./fake-chain";
import { setup } from "./helpers";

const code = async (r: Response) => ((await r.json()) as { code: string }).code;

describe("pure validation", () => {
  test("amount parsing", () => {
    expect(parseAmountUsdt("49").units).toBe(49_000_000n);
    expect(parseAmountUsdt("0.5").text).toBe("0.5");
    for (const bad of ["0", "-1", "1.1234567", "abc", "", "01"]) expect(() => parseAmountUsdt(bad)).toThrow();
  });
  test("authorization field rules", () => {
    const id = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const base = { from: ROUTER, to: ROUTER, value: "49000000", validAfter: 0, validBefore: 1300, nonce: invoicePaymentNonce(ROUTER, id) };
    const o = { router: ROUTER, invoiceId: id, expectedValue: 49_000_000n, now: 1000, maxWindowSec: 600, minRemainingSec: 20 };
    expect(checkAuthorizationFields(base, o)).toBeNull();
    expect(checkAuthorizationFields({ ...base, to: "0x2222222222222222222222222222222222222222" }, o)).toContain("PaymentRouter");
    expect(checkAuthorizationFields({ ...base, value: "48000000" }, o)).toContain("amount");
    expect(checkAuthorizationFields({ ...base, validBefore: 1601 }, o)).toContain("10 minutes");
    expect(checkAuthorizationFields({ ...base, validBefore: 1010 }, o)).toContain("expire");
    expect(checkAuthorizationFields({ ...base, validAfter: 1001 }, o)).toContain("not valid yet");
    expect(checkAuthorizationFields({ ...base, nonce: ("0x" + "00".repeat(32)) as `0x${string}` }, o)).toContain("paymentNonce");
  });
});

describe("POST /relay", () => {
  test("valid authorization is relayed; store updated from receipt events", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    expect(inv.state).toBe("open");
    const body = await s.signAuth(inv.invoiceId);
    const r = await s.post("/relay", body);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { txHash: string; explorerUrl: string };
    expect(j.explorerUrl).toBe(`https://explorer.testnet.whitechain.io/tx/${j.txHash}`);
    expect((await s.store.getInvoice(inv.invoiceId))!.state).toBe("paid");
    const p = (await s.store.getPayment(inv.invoiceId))!;
    expect(p.payer).toBe(s.payerAcct.address);
    expect(p.amountUsdt).toBe("49");
    expect(p.gasless).toBe(true);
    expect(p.paidAt).toBe(1_800_000_000);
    // gas charged (create + pay) both in memory and on the merchant entity
    expect(BigInt((await s.store.getMerchant(s.merchantAcct.address))!.gasUsedWei)).toBe(2n * 100_000n * 5_000_000_000n);
    expect(s.relayer.budget.usedToday(s.merchantAcct.address)).toBe(2n * 100_000n * 5_000_000_000n);
  });

  test("unverified merchant -> MERCHANT_NOT_VERIFIED (invoice creation still allowed)", async () => {
    const s = await setup({ verified: false });
    const inv = await s.createInvoice();
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId));
    expect(r.status).toBe(403);
    expect(await code(r)).toBe("MERCHANT_NOT_VERIFIED");
    expect(s.chain.sent.filter((c) => c.fn === "payWithAuthorization")).toHaveLength(0);
  });

  test("wrong to / value / nonce / window / signer -> BAD_AUTHORIZATION", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const cases = [
      await s.signAuth(inv.invoiceId, "49", { to: "0x2222222222222222222222222222222222222222" }),
      await s.signAuth(inv.invoiceId, "48"),
      await s.signAuth(inv.invoiceId, "49", { nonce: ("0x" + "11".repeat(32)) as `0x${string}` }),
      await s.signAuth(inv.invoiceId, "49", { validBefore: s.nowSec() + 3600 }),
      await s.signAuth(inv.invoiceId, "49", { validBefore: s.nowSec() - 1 }),
    ];
    for (const body of cases) {
      const r = await s.post("/relay", body);
      expect(await code(r)).toBe("BAD_AUTHORIZATION");
    }
    // signature by someone else than `from`
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await s.signAuth(inv.invoiceId, "49", { from: s.payerAcct.address }, other);
    expect(await code(await s.post("/relay", forged))).toBe("BAD_AUTHORIZATION");
    expect(s.chain.sent.filter((c) => c.fn === "payWithAuthorization")).toHaveLength(0);
  });

  test("paid invoice cannot be paid again; used nonce rejected", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const body = await s.signAuth(inv.invoiceId);
    expect((await s.post("/relay", body)).status).toBe(200);
    const again = await s.post("/relay", body);
    expect(await code(again)).toBe("INVOICE_NOT_OPEN");
  });

  test("store says open but chain says paid -> INVOICE_NOT_OPEN; chain auth used -> BAD_AUTHORIZATION", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const body = await s.signAuth(inv.invoiceId);
    s.chain.usedAuth.add(`${s.payerAcct.address.toLowerCase()}:${body.authorization.nonce}`);
    expect(await code(await s.post("/relay", body))).toBe("BAD_AUTHORIZATION");
    s.chain.invoices.get(inv.invoiceId)!.status = "paid";
    expect(await code(await s.post("/relay", body))).toBe("INVOICE_NOT_OPEN");
  });

  test("simulation revert -> SIMULATION_FAILED, no tx sent, nonce can be retried", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const body = await s.signAuth(inv.invoiceId);
    s.chain.revertNext = "FiatTokenV2: transfer amount exceeds balance";
    const r = await s.post("/relay", body);
    expect(r.status).toBe(422);
    const j = (await r.json()) as { error: string; code: string };
    expect(j.code).toBe("SIMULATION_FAILED");
    expect(j.error).toContain("exceeds balance");
    expect(s.chain.sent.filter((c) => c.fn === "payWithAuthorization")).toHaveLength(0);
    expect((await s.post("/relay", body)).status).toBe(200);
  });

  test("reverted on chain -> TX_FAILED with tx hash; gas still charged", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    s.chain.revertOnChain = true;
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId));
    const j = (await r.json()) as { code: string; txHash: string };
    expect(j.code).toBe("TX_FAILED");
    expect(j.txHash).toMatch(/^0x/);
    expect((await s.store.getInvoice(inv.invoiceId))!.state).toBe("open");
    expect(s.relayer.budget.usedToday(s.merchantAcct.address)).toBe(2n * 100_000n * 5_000_000_000n);
  });

  test("unknown invoice -> INVOICE_NOT_FOUND; malformed body -> BAD_REQUEST", async () => {
    const s = await setup();
    const r = await s.post("/relay", await s.signAuth(("0x" + "cd".repeat(32)) as `0x${string}`));
    expect(await code(r)).toBe("INVOICE_NOT_FOUND");
    expect(await code(await s.post("/relay", { invoiceId: "x" }))).toBe("BAD_REQUEST");
  });

  test("store outage after confirmed tx: retried, tx hash still returned", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    s.store.failWrites = 2; // first two attempts of the first write fail, third succeeds
    const r = await s.post("/relay", await s.signAuth(inv.invoiceId));
    expect(r.status).toBe(200);
    expect((await s.store.getInvoice(inv.invoiceId))!.state).toBe("paid");
  });
});

describe("drain protection", () => {
  test("per-merchant daily gas budget -> BUDGET_EXCEEDED, resets next UTC day", async () => {
    // 0.0005 WBT per simulated call * 1.2 buffer = 0.0006; budget 0.002 allows 3 txs
    const s = await setup({ env: { MERCHANT_DAILY_GAS_WBT: "0.002" } });
    await s.createInvoice(); await s.createInvoice(); await s.createInvoice();
    const r = await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "5", dueAt: s.nowSec() + 999, memo: "" });
    expect(r.status).toBe(402);
    expect(await code(r)).toBe("BUDGET_EXCEEDED");
    s.advance(86_400_000);
    await s.createInvoice();
  });

  test("rate limit: 10 relays per payer per hour -> RATE_LIMITED with Retry-After", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const body = await s.signAuth(inv.invoiceId, "48"); // invalid value: rejected, but attempts still count
    for (let i = 0; i < 10; i++) expect(await code(await s.post("/relay", body, `10.0.0.${i}`))).toBe("BAD_AUTHORIZATION");
    const r = await s.post("/relay", body, "10.0.1.1");
    expect(r.status).toBe(429);
    expect(await code(r)).toBe("RATE_LIMITED");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    s.advance(3_600_001);
    expect(await code(await s.post("/relay", body, "10.0.1.1"))).toBe("BAD_AUTHORIZATION");
  });

  test("rate limit: 60 per IP per hour", async () => {
    const s = await setup({ env: { TRUST_PROXY: "1" } });
    const inv = await s.createInvoice();
    for (let i = 0; i < 60; i++) {
      const signer = privateKeyToAccount(generatePrivateKey());
      const b = await s.signAuth(inv.invoiceId, "48", {}, signer);
      expect(await code(await s.post("/relay", b, "7.7.7.7"))).toBe("BAD_AUTHORIZATION");
    }
    const b = await s.signAuth(inv.invoiceId, "48", {}, privateKeyToAccount(generatePrivateKey()));
    expect(await code(await s.post("/relay", b, "7.7.7.7"))).toBe("RATE_LIMITED");
    expect(await code(await s.post("/relay", b, "7.7.7.8"))).toBe("BAD_AUTHORIZATION");
  });

  test("rate limit: global 300 per hour", async () => {
    const s = await setup({ env: { TRUST_PROXY: "1", RL_GLOBAL_PER_HOUR: "5" } });
    const inv = await s.createInvoice(); // creation counts toward global: 1
    for (let i = 0; i < 4; i++) {
      const b = await s.signAuth(inv.invoiceId, "48", {}, privateKeyToAccount(generatePrivateKey()));
      expect(await code(await s.post("/relay", b, `8.8.8.${i}`))).toBe("BAD_AUTHORIZATION");
    }
    const b = await s.signAuth(inv.invoiceId, "48", {}, privateKeyToAccount(generatePrivateKey()));
    expect(await code(await s.post("/relay", b, "8.8.9.9"))).toBe("RATE_LIMITED");
  });

  test("concurrent relays for one invoice: only one tx is sent", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const a = await s.signAuth(inv.invoiceId);
    const b = await s.signAuth(inv.invoiceId, "49", {}, privateKeyToAccount(generatePrivateKey()));
    const [r1, r2] = await Promise.all([s.post("/relay", a, "1.1.1.1"), s.post("/relay", b, "1.1.1.2")]);
    const codes = [r1.status, r2.status].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBe(409);
    expect(s.chain.sent.filter((c) => c.fn === "payWithAuthorization")).toHaveLength(1);
  });
});

describe("invoices, refunds", () => {
  test("POST /invoices validates input and requires a registered merchant", async () => {
    const s = await setup();
    const ok = await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "12.5", dueAt: s.nowSec() + 3600, memo: "Translation, 3 pages" });
    expect(ok.status).toBe(201);
    const inv = (await ok.json()) as { invoiceId: string; amountUsdt: string; state: string; createTx: string };
    expect(inv.amountUsdt).toBe("12.5");
    expect(inv.createTx).toMatch(/^0x/);
    const got = await s.app.request(`/invoices/${inv.invoiceId}`);
    const g = (await got.json()) as { merchantHandle: string; gaslessAvailable: boolean };
    expect(g.merchantHandle).toBe("chai-studio");
    expect(g.gaslessAvailable).toBe(true);
    expect(await code(await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "1", dueAt: s.nowSec() - 1 }))).toBe("BAD_REQUEST");
    expect(await code(await s.post("/invoices", { merchant: s.merchantAcct.address, amountUsdt: "1", dueAt: s.nowSec() + 60, memo: "x".repeat(129) }))).toBe("BAD_REQUEST");
    expect(await code(await s.post("/invoices", { merchant: "0x2222222222222222222222222222222222222222", amountUsdt: "1", dueAt: s.nowSec() + 60 }))).toBe("MERCHANT_NOT_FOUND");
  });

  test("merchant-signed refund: full refund sets refunded and records refund tx", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    await s.post("/relay", await s.signAuth(inv.invoiceId));
    const deadline = BigInt(s.nowSec() + 600);
    // wrong signer is rejected before any tx
    const other = privateKeyToAccount(generatePrivateKey());
    const badSig = await s.signRefund(inv.invoiceId, 49_000_000n, deadline, other);
    expect(await code(await s.post(`/invoices/${inv.invoiceId}/refund`, { amountUsdt: "49", deadline: deadline.toString(), signature: badSig }))).toBe("BAD_SIGNATURE");
    // partial refund
    const sig1 = await s.signRefund(inv.invoiceId, 9_000_000n, deadline);
    const r1 = await s.post(`/invoices/${inv.invoiceId}/refund`, { amountUsdt: "9", deadline: deadline.toString(), signature: sig1 });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { state: string }).state).toBe("paid");
    // refund the rest (amount omitted = remaining balance)
    // Browser flow: fetch typed data, sign exactly that (BigInt-converted), post { deadline, signature }.
    const td = (await (await s.app.request(`/invoices/${inv.invoiceId}/refund-typed-data`)).json()) as any;
    expect(td.typedData.message.amount).toBe("40000000");
    expect(td.typedData.domain.name).toBe("PaisaLink PaymentRouter");
    const m = td.typedData.message;
    const sig2 = await s.merchantAcct.signTypedData({
      ...td.typedData, message: { invoiceId: m.invoiceId, amount: BigInt(m.amount), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) },
    });
    const r2 = await s.post(`/invoices/${inv.invoiceId}/refund`, { deadline: td.deadline, signature: sig2 });
    const j2 = (await r2.json()) as { state: string; refundedUsdt: string; to: string };
    expect(j2.state).toBe("refunded");
    expect(j2.refundedUsdt).toBe("40");
    expect(j2.to).toBe(s.payerAcct.address);
    expect((await s.store.getInvoice(inv.invoiceId))!.state).toBe("refunded");
    expect((await s.store.getPayment(inv.invoiceId))!.refundTx).toMatch(/^0x/);
  });

  test("refund of an open invoice -> INVOICE_NOT_PAID", async () => {
    const s = await setup();
    const inv = await s.createInvoice();
    const deadline = BigInt(s.nowSec() + 600);
    const sig = await s.signRefund(inv.invoiceId, 49_000_000n, deadline);
    expect(await code(await s.post(`/invoices/${inv.invoiceId}/refund`, { amountUsdt: "49", deadline: deadline.toString(), signature: sig }))).toBe("INVOICE_NOT_PAID");
  });
});

test("amount parse helper matches parseUnits", () => {
  expect(parseAmountUsdt("1000.000001").units).toBe(parseUnits("1000.000001", 6));
});
