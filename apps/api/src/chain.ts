import type { Address, Hex } from "@paisalink/shared";

/** Calls the relayer (PaymentRouter operator) submits. Names match PaymentRouter (docs/specs/contracts.md). */
export type RouterCall =
  | { fn: "createInvoiceFor"; invoiceId: Hex; merchant: Address; amount: bigint; dueAt: bigint }
  | { fn: "payWithAuthorization"; invoiceId: Hex; from: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; v: number; r: Hex; s: Hex }
  | { fn: "refundWithSig"; invoiceId: Hex; amount: bigint; deadline: bigint; signature: Hex }
  | { fn: "withdrawWithSig"; invoiceId: Hex; deadline: bigint; signature: Hex };

export interface RouterEvent { name: string; args: Record<string, unknown>; }

/** Decoded result of a mined tx. Store updates are derived from these events, never from assumptions. */
export interface TxOutcome {
  txHash: Hex;
  status: "success" | "reverted";
  gasCostWei: bigint;
  blockNumber: bigint;
  blockTimestamp: number;
  events: RouterEvent[];
}

/** PaymentRouter.getInvoice() decoded. status: ROUTER_STATUS = none, open, paid, refunded, withdrawn. */
export interface OnchainInvoice {
  merchant: Address; dueAt: number; payer: Address; paidAt: number;
  status: "none" | "open" | "paid" | "refunded" | "withdrawn"; financed: boolean;
  amount: bigint; balance: bigint; refunded: bigint; noteId: bigint;
}

export interface Simulation { gas: bigint; gasPrice: bigint; }

export class SimulationError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/** Everything the relayer needs from Whitechain. Production: createViemRouterChain (viem-chain.ts).
 *  Unit tests use a fake implementation in apps/api/test only. */
export interface RouterChain {
  readonly chainId: number;
  readonly routerAddress: Address;
  readonly relayerAddress: Address;
  /** eth_call + eth_estimateGas from the relayer. Throws SimulationError with the revert reason. */
  simulate(call: RouterCall): Promise<Simulation>;
  /** Sends through the single-wallet tx queue. Returns the tx hash. */
  send(call: RouterCall, sim: Simulation): Promise<Hex>;
  wait(hash: Hex): Promise<TxOutcome>;
  /** Mined receipt of any tx (e.g. a payer's self-paid pay()), decoded with PaymentRouter events from OUR router
   *  address only. null if the tx is unknown or not mined yet. Never waits long. */
  receipt(hash: Hex): Promise<TxOutcome | null>;
  /** USDT authorizationState(authorizer, nonce). */
  authorizationUsed(from: Address, nonce: Hex): Promise<boolean>;
  /** PaymentRouter.getInvoice(); null when the invoice does not exist on chain (status none). */
  getInvoice(invoiceId: Hex): Promise<OnchainInvoice | null>;
  /** PaymentRouter per-merchant EIP-712 nonce. */
  merchantNonce(merchant: Address): Promise<bigint>;
  relayerBalance(): Promise<bigint>;
  /** eth_chainId from the RPC, for /health. */
  rpcChainId(): Promise<number>;
  queueDepth(): number;
}

/** Testnet demo faucet: test USDT from the deployer wallet. */
export interface FaucetChain {
  readonly address: Address;
  usdtBalance(a: Address): Promise<bigint>;
  sendUsdt(to: Address, amount: bigint): Promise<Hex>;
  wait(hash: Hex): Promise<{ txHash: Hex; status: "success" | "reverted" }>;
}
