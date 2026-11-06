// S1: typed-data vectors that must agree with the Solidity contracts (PaymentRouter.paymentNonce, the USDT
// ReceiveWithAuthorization typehash) and with the payer-side signing used by the checkout page.
import { test, expect, describe } from "bun:test";
import { concat, hashTypedData, keccak256, pad, recoverTypedDataAddress, toHex, hashDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildReceiveAuthTypedData, invoicePaymentNonce, USDT_ADDRESS, USDT_DOMAIN, USDT_DOMAIN_SEPARATOR,
  buildRefundTypedData, buildWithdrawTypedData, type Eip3009Authorization, type Hex,
} from "../src";

const ROUTER = "0x1111111111111111111111111111111111111111" as const;
const ID = `0x${"ab".repeat(32)}` as Hex;
// Generated independently with Foundry: cast keccak $(cast abi-encode "f(address,bytes32)" ROUTER ID)
const NONCE_VECTOR = "0xb7ff36d697a6fde72de475d4417893b0f76c6eac829e7ab1c9495780e0158e43";
// Same string as RWA_TYPEHASH in contracts/test/Base.t.sol and the real USDT contract.
const RWA_TYPE_STRING = "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // public anvil test key #1

describe("paymentNonce vector (== PaymentRouter.paymentNonce)", () => {
  test("matches the Foundry-computed value", () => {
    expect(invoicePaymentNonce(ROUTER, ID)).toBe(NONCE_VECTOR);
  });
  test("is keccak(abi.encode(address,bytes32)): 32-byte left-padded address then the id", () => {
    expect(keccak256(concat([pad(ROUTER, { size: 32 }), ID]))).toBe(NONCE_VECTOR);
  });
  test("differs per router and per invoice (binds the signature to one invoice)", () => {
    expect(invoicePaymentNonce(ROUTER, `0x${"cd".repeat(32)}`)).not.toBe(NONCE_VECTOR);
    expect(invoicePaymentNonce("0x2222222222222222222222222222222222222222", ID)).not.toBe(NONCE_VECTOR);
  });
});

describe("EIP-3009 ReceiveWithAuthorization typed data", () => {
  const acct = privateKeyToAccount(KEY);
  const auth: Eip3009Authorization = {
    from: acct.address, to: ROUTER, value: "49000000", validAfter: 0, validBefore: 1_800_000_300, nonce: invoicePaymentNonce(ROUTER, ID),
  };
  test("struct type string equals the Solidity typehash string", () => {
    const t = buildReceiveAuthTypedData(auth).types.ReceiveWithAuthorization;
    expect(`ReceiveWithAuthorization(${t.map((f) => `${f.type} ${f.name}`).join(",")})`).toBe(RWA_TYPE_STRING);
  });
  test("domain is the pinned on-chain USDT domain (Tether USD / 1 / 1874)", () => {
    const td = buildReceiveAuthTypedData(auth);
    expect(td.domain).toEqual({ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT_ADDRESS });
    expect(USDT_DOMAIN.chainId).toBe(1874);
  });
  test("digest equals the manual EIP-712 computation the contract performs", () => {
    const structHash = keccak256(concat([
      keccak256(toHex(RWA_TYPE_STRING)), pad(auth.from, { size: 32 }), pad(auth.to, { size: 32 }),
      pad(toHex(BigInt(auth.value)), { size: 32 }), pad(toHex(auth.validAfter), { size: 32 }),
      pad(toHex(auth.validBefore), { size: 32 }), auth.nonce,
    ]));
    const manual = keccak256(concat(["0x1901", USDT_DOMAIN_SEPARATOR, structHash]));
    expect(hashTypedData(buildReceiveAuthTypedData(auth))).toBe(manual);
  });
  test("signature recovers to the payer; any changed field recovers someone else", async () => {
    const signature = await acct.signTypedData(buildReceiveAuthTypedData(auth));
    expect(await recoverTypedDataAddress({ ...buildReceiveAuthTypedData(auth), signature })).toBe(acct.address);
    for (const over of [{ value: "49000001" }, { validBefore: auth.validBefore + 1 }, { to: "0x2222222222222222222222222222222222222222" as const },
      { nonce: invoicePaymentNonce(ROUTER, `0x${"cd".repeat(32)}`) }]) {
      const other = await recoverTypedDataAddress({ ...buildReceiveAuthTypedData({ ...auth, ...over }), signature });
      expect(other).not.toBe(acct.address);
    }
  });
  test("USDT domain separator is pinned", () => {
    expect(hashDomain({ domain: USDT_DOMAIN, types: { EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } }).toLowerCase())
      .toBe(USDT_DOMAIN_SEPARATOR);
  });
});

describe("router Refund / Withdraw typed data", () => {
  test("type strings match PaymentRouter REFUND_TYPEHASH / WITHDRAW_TYPEHASH", () => {
    const r = buildRefundTypedData(ROUTER, { invoiceId: ID, amount: 1n, nonce: 0n, deadline: 2n });
    const w = buildWithdrawTypedData(ROUTER, { invoiceId: ID, nonce: 0n, deadline: 2n });
    const str = (n: string, t: readonly { name: string; type: string }[]) => `${n}(${t.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(str("Refund", r.types.Refund)).toBe("Refund(bytes32 invoiceId,uint256 amount,uint256 nonce,uint256 deadline)");
    expect(str("Withdraw", w.types.Withdraw)).toBe("Withdraw(bytes32 invoiceId,uint256 nonce,uint256 deadline)");
    expect(r.domain).toMatchObject({ name: "PaisaLink PaymentRouter", version: "1", chainId: 1874, verifyingContract: ROUTER });
  });
});
