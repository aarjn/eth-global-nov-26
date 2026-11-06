// Hand-written helpers for the PaisaLink contracts (W1). Kept next to the generated ABIs.
import { encodeAbiParameters, keccak256 } from "viem";
import type { Address, Hex } from "../types";
import { WHITECHAIN_TESTNET_ID } from "../chain";

/** EIP-3009 nonce the payer MUST sign for an invoice: keccak256(abi.encode(router, invoiceId)).
 *  Mirrors PaymentRouter.paymentNonce(invoiceId); binds the USDT authorization to one invoice. */
export function invoicePaymentNonce(router: Address, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [router, invoiceId]));
}

/** PaymentRouter on-chain status enum (getInvoice().status). */
export const ROUTER_STATUS = ["none", "open", "paid", "refunded", "withdrawn"] as const;
/** InvoiceNote on-chain state enum (getNote().state). */
export const NOTE_STATE = ["none", "issued", "funded", "settled"] as const;

export const routerDomain = (router: Address) =>
  ({ name: "PaisaLink PaymentRouter", version: "1", chainId: WHITECHAIN_TESTNET_ID, verifyingContract: router }) as const;
export const noteDomain = (note: Address) =>
  ({ name: "PaisaLink InvoiceNote", version: "1", chainId: WHITECHAIN_TESTNET_ID, verifyingContract: note }) as const;

export const REFUND_TYPES = {
  Refund: [
    { name: "invoiceId", type: "bytes32" }, { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ],
} as const;
export const WITHDRAW_TYPES = {
  Withdraw: [{ name: "invoiceId", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
} as const;
export const ISSUE_TYPES = {
  Issue: [
    { name: "invoiceId", type: "bytes32" }, { name: "faceValue", type: "uint256" }, { name: "price", type: "uint256" },
    { name: "maturity", type: "uint64" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ],
} as const;

/** Merchant signs this; relayer submits PaymentRouter.refundWithSig(invoiceId, amount, deadline, sig).
 *  `nonce` = PaymentRouter.nonces(merchant). Amounts are USDT base units (6 dp). */
export function buildRefundTypedData(router: Address, m: { invoiceId: Hex; amount: bigint; nonce: bigint; deadline: bigint }) {
  return { domain: routerDomain(router), types: REFUND_TYPES, primaryType: "Refund" as const, message: m };
}

/** Merchant signs this; relayer submits PaymentRouter.withdrawWithSig(invoiceId, deadline, sig). */
export function buildWithdrawTypedData(router: Address, m: { invoiceId: Hex; nonce: bigint; deadline: bigint }) {
  return { domain: routerDomain(router), types: WITHDRAW_TYPES, primaryType: "Withdraw" as const, message: m };
}

/** Merchant signs this; relayer submits InvoiceNote.issueWithSig(invoiceId, faceValue, price, maturity, deadline, sig).
 *  `nonce` = InvoiceNote.nonces(merchant) (separate counter from the router's). */
export function buildIssueTypedData(
  note: Address,
  m: { invoiceId: Hex; faceValue: bigint; price: bigint; maturity: bigint; nonce: bigint; deadline: bigint },
) {
  return { domain: noteDomain(note), types: ISSUE_TYPES, primaryType: "Issue" as const, message: m };
}
