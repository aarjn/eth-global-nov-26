import { describe, expect, test } from "bun:test";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildReceiveAuthTypedData, type Hex } from "@paisalink/shared";
import { buildRefundTypedData, invoicePaymentNonce } from "@paisalink/shared";
import { match } from "../src/lib/router";
import { reviveTypedData, signTyped, type TypedDataJson } from "../src/lib/sign";
import { inr, money, short } from "../src/lib/format";

const ROUTER = "0x1111111111111111111111111111111111111111" as const;
const INVOICE = "0x" + "ab".repeat(32) as Hex;

describe("router.match", () => {
  test("extracts params", () => {
    expect(match("/pay/:id", "/pay/0xabc")).toEqual({ id: "0xabc" });
    expect(match("/pay/:id", "/pay/0xabc/")).toEqual({ id: "0xabc" });
    expect(match("/pay/:id", "/r/0xabc")).toBeNull();
    expect(match("/merchant", "/merchant")).toEqual({});
  });
});

describe("refund signing", () => {
  test("signs the API's JSON typed data so it recovers to the merchant", async () => {
    const merchant = privateKeyToAccount(generatePrivateKey());
    const td = buildRefundTypedData(ROUTER, { invoiceId: INVOICE, amount: 9_000_000n, nonce: 3n, deadline: 1_900_000_000n });
    // What the API sends: bigints as decimal strings.
    const json = JSON.parse(JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as TypedDataJson;
    const revived = reviveTypedData(json);
    expect(revived.message.amount).toBe(9_000_000n);
    const sig = await signTyped(merchant, json);
    const signer = await recoverTypedDataAddress({ ...td, signature: sig });
    expect(signer).toBe(merchant.address);
  });
});

describe("payment authorization", () => {
  test("payer signature over the invoice-bound nonce recovers to the payer", async () => {
    const payer = privateKeyToAccount(generatePrivateKey());
    const auth = { from: payer.address, to: ROUTER, value: "49000000", validAfter: 0, validBefore: 1_900_000_000, nonce: invoicePaymentNonce(ROUTER, INVOICE) };
    const typed = buildReceiveAuthTypedData(auth);
    const sig = await payer.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature: sig })).toBe(payer.address);
    expect(auth.nonce).not.toBe(invoicePaymentNonce(ROUTER, ("0x" + "cd".repeat(32)) as Hex));
  });
});

describe("format", () => {
  test("money, inr, short", () => {
    expect(money("49")).toBe("49");
    expect(money("2000")).toBe("2,000");
    expect(inr("1")).toMatch(/^≈ ₹\d+/);
    expect(short("0x32c84603C9848FFa470FB07C9bCe820944D04c52")).toBe("0x32c8…4c52");
  });
});
