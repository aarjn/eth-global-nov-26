// EIP-712 typed data the merchant signs in the browser so the relayer can act for them (no merchant gas).
// The builders live in @paisalink/shared (W1, packages/shared/src/abi/helpers.ts) so web and API share them.
export { buildRefundTypedData, buildWithdrawTypedData, routerDomain, REFUND_TYPES, WITHDRAW_TYPES, invoicePaymentNonce } from "@paisalink/shared";

/** JSON-safe copy (bigint -> decimal string) for API responses; the browser converts back with BigInt(). */
export function jsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
