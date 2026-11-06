// Opt-in live test against Arkiv Rabdi. Spends a little tGLM from the writer.
//   cd packages/arkiv && bun run test:live      (ARKIV_LIVE=1, env from ../../.env.local)
// Uses a fresh random merchant address, so it never touches the demo merchant's data.
import { describe, expect, test } from "bun:test";
import type { Hex, Invoice } from "@paisalink/shared";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createArkivStore } from "../src";

const live = process.env.ARKIV_LIVE === "1";

describe.skipIf(!live)("Arkiv live (Rabdi)", () => {
  const store = createArkivStore(process.env as never);
  const merchant = privateKeyToAccount(generatePrivateKey()).address;
  const invoiceId = keccak256(toHex(`live-test-${Date.now()}-${Math.random()}`)) as Hex;
  const txHash = keccak256(toHex(`fake-wc-tx-${invoiceId}`)) as Hex; // a Whitechain hash is just a string here
  const seen: string[] = [];
  let unwatch: (() => void) | undefined;

  test("watch, then create merchant + invoice and read them back", async () => {
    unwatch = store.watchMerchant(merchant, (kind, id) => seen.push(`${kind}:${id}`));
    await Bun.sleep(3000); // watcher subscribes on its first poll; events before that are not replayed

    const m = await store.upsertMerchant({ wallet: merchant, handle: `live-${merchant.slice(2, 8).toLowerCase()}`, verified: false, gasUsedWei: "0", createdAt: Math.floor(Date.now() / 1000) });
    expect(store.writes.at(-1)!.op).toBe("create");
    console.log("merchant entity:", store.writes.at(-1)!.explorerUrl);

    const inv: Invoice = { invoiceId, merchant, amountUsdt: "12.34", dueAt: Math.floor(Date.now() / 1000) - 60, memo: "live test", state: "open" };
    await store.upsertInvoice(inv);
    expect(store.writes.at(-1)!.op).toBe("create");
    console.log("invoice entity:", store.writes.at(-1)!.explorerUrl);

    expect((await store.getMerchant(merchant))?.handle).toBe(m.handle);
    const got = await store.getInvoice(invoiceId);
    expect(got).toMatchObject({ invoiceId: invoiceId.toLowerCase(), merchant, amountUsdt: "12.34", state: "open" });
    const list = await store.listInvoicesByMerchant(merchant);
    expect(list.map((i) => i.invoiceId)).toEqual([invoiceId.toLowerCase() as Hex]);
  }, 90_000);

  test("same upsert again is a no-op (no tx)", async () => {
    await store.upsertInvoice({ invoiceId, merchant, amountUsdt: "12.34", dueAt: Math.floor(Date.now() / 1000) - 60, memo: "live test", state: "open" });
    expect(store.writes.at(-1)!.op).toBe("noop");
  }, 30_000);

  test("recordPayment creates the receipt and marks the invoice paid in one batch", async () => {
    await store.recordPayment({ invoiceId, merchant, payer: merchant, amountUsdt: "12.34", txHash, gasless: true, paidAt: Math.floor(Date.now() / 1000) });
    const [a, b] = store.writes.slice(-2);
    expect(a!.op).toBe("batch");
    expect(a!.txHash).toBe(b!.txHash!);
    console.log("payment entity:", a!.explorerUrl, "tx", a!.txHash);
    const inv = await store.getInvoice(invoiceId);
    expect(inv?.state).toBe("paid");
    expect(inv?.payTx).toBe(txHash);
    expect((await store.getPayment(invoiceId))?.gasless).toBe(true);
    expect((await store.listPaymentsByMerchant(merchant)).length).toBe(1);
  }, 90_000);

  test("refund patch: invoice refunded (patch, already extended to 90 days)", async () => {
    const inv = (await store.getInvoice(invoiceId))!;
    await store.upsertInvoice({ ...inv, state: "refunded" });
    expect(["patch", "patch+extend"]).toContain(store.writes.at(-1)!.op);
  }, 60_000);

  test("patch + extend in one batch on the same entity (merchant verified, lease renewal)", async () => {
    await store.setMerchantVerified(merchant, true);
    expect((await store.getMerchant(merchant))?.verified).toBe(true);
  }, 60_000);

  test("watchMerchant saw our invoice/payment events over WebSocket", async () => {
    await Bun.sleep(4000);
    unwatch?.();
    console.log("events seen:", seen);
    expect(seen).toContain(`invoice:${invoiceId.toLowerCase()}`);
    expect(seen).toContain(`payment:${invoiceId.toLowerCase()}`);
  }, 30_000);
});
