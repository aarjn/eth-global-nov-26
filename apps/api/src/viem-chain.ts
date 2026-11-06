// Production Whitechain access with viem: simulation, the single relayer tx queue, receipts decoded into events.
import {
  BaseError, ContractFunctionRevertedError, TransactionReceiptNotFoundError, type TransactionReceipt, createPublicClient, erc20Abi, http, parseAbi, parseEventLogs,
  type Abi, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainTestnet, type Address, type Hex } from "@paisalink/shared";
import { paymentRouterAbi, ROUTER_STATUS } from "@paisalink/shared";
import type { ApiConfig } from "./config";
import { sharedSender } from "./senders";
import { SimulationError, type FaucetChain, type RouterCall, type RouterChain, type Simulation, type TxOutcome } from "./chain";

const usdtAuthAbi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const RECEIPT_TIMEOUT_MS = 90_000;

function argsOf(call: RouterCall): { functionName: string; args: readonly unknown[] } {
  switch (call.fn) {
    case "createInvoiceFor": return { functionName: call.fn, args: [call.invoiceId, call.merchant, call.amount, call.dueAt] };
    case "payWithAuthorization": return { functionName: call.fn, args: [call.invoiceId, call.from, call.value, call.validAfter, call.validBefore, call.nonce, call.v, call.r, call.s] };
    case "refundWithSig": return { functionName: call.fn, args: [call.invoiceId, call.amount, call.deadline, call.signature] };
    case "withdrawWithSig": return { functionName: call.fn, args: [call.invoiceId, call.deadline, call.signature] };
  }
}

/** Best-effort human revert reason from a viem error. */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) {
      if (r.data?.errorName) return `${r.data.errorName}${r.data.args?.length ? `(${r.data.args.map(String).join(", ")})` : ""}`;
      if (r.reason) return r.reason;
    }
    return e.shortMessage || e.message.split("\n")[0]!;
  }
  return (e as Error)?.message?.split("\n")[0] ?? String(e);
}

export function makeClients(cfg: ApiConfig) {
  const chain = { ...whitechainTestnet, id: cfg.chainId, rpcUrls: { default: { http: [cfg.rpcUrl] } } };
  const transport = http(cfg.rpcUrl, { retryCount: 2, timeout: 20_000 });
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  return { chain, transport, pub };
}

export function createViemRouterChain(cfg: ApiConfig): RouterChain | undefined {
  if (!cfg.paymentRouter || !cfg.relayerKey) return undefined;
  const router = cfg.paymentRouter;
  const { chain, transport, pub } = makeClients(cfg);
  const account = privateKeyToAccount(cfg.relayerKey);
  const sender = sharedSender(account, pub, chain, transport, cfg.rpcUrl);
  const abi = paymentRouterAbi as Abi;

  async function decode(r: TransactionReceipt): Promise<TxOutcome> {
    const block = await pub.getBlock({ blockNumber: r.blockNumber });
    // Only logs emitted by OUR PaymentRouter count; a look-alike event from another contract is ignored.
    const logs = parseEventLogs({ abi, logs: r.logs.filter((l) => l.address.toLowerCase() === router.toLowerCase()) }) as unknown as { eventName: string; args: Record<string, unknown> }[];
    return {
      txHash: r.transactionHash, status: r.status, gasCostWei: r.gasUsed * r.effectiveGasPrice, blockNumber: r.blockNumber,
      blockTimestamp: Number(block.timestamp), events: logs.map((l) => ({ name: l.eventName, args: l.args })),
    };
  }

  return {
    chainId: cfg.chainId,
    routerAddress: router,
    relayerAddress: account.address,

    async simulate(call): Promise<Simulation> {
      const { functionName, args } = argsOf(call);
      try {
        await pub.simulateContract({ address: router, abi, functionName, args, account });
        const [gas, gasPrice] = await Promise.all([
          pub.estimateContractGas({ address: router, abi, functionName, args, account }),
          pub.getGasPrice(),
        ]);
        return { gas, gasPrice };
      } catch (e) {
        throw new SimulationError(revertReason(e));
      }
    },

    send(call, sim) {
      const { functionName, args } = argsOf(call);
      return sender.send((nonce) => sender.wallet.writeContract({
        address: router, abi, functionName, args, account, chain, nonce,
        gas: (sim.gas * 13n) / 10n, gasPrice: sim.gasPrice,
      }));
    },

    async wait(hash): Promise<TxOutcome> {
      return decode(await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS }));
    },

    async receipt(hash) {
      try { return await decode(await pub.getTransactionReceipt({ hash })); }
      catch (e) { if (e instanceof TransactionReceiptNotFoundError) return null; throw e; }
    },

    authorizationUsed: (from, nonce) => pub.readContract({ address: cfg.usdt, abi: usdtAuthAbi, functionName: "authorizationState", args: [from, nonce] }),
    async getInvoice(invoiceId) {
      const r = (await pub.readContract({ address: router, abi: paymentRouterAbi, functionName: "getInvoice", args: [invoiceId] })) as unknown as {
        merchant: Address; dueAt: bigint; payer: Address; paidAt: bigint; status: number; financed: boolean;
        amount: bigint; balance: bigint; refunded: bigint; noteId: bigint;
      };
      const status = ROUTER_STATUS[r.status] ?? "none";
      if (status === "none") return null;
      return { ...r, dueAt: Number(r.dueAt), paidAt: Number(r.paidAt), status };
    },
    merchantNonce: (merchant) => pub.readContract({ address: router, abi, functionName: "nonces", args: [merchant] }) as Promise<bigint>,
    relayerBalance: () => pub.getBalance({ address: account.address }),
    rpcChainId: () => pub.getChainId(),
    queueDepth: () => sender.queue.pending,
  };
}

/** Read-only probe for /health (works before the contracts are deployed). */
export function createProbe(cfg: ApiConfig) {
  const { pub } = makeClients(cfg);
  return {
    relayerAddress: cfg.relayerKey ? privateKeyToAccount(cfg.relayerKey).address : undefined,
    rpcChainId: () => pub.getChainId(),
    balance: (a: Address) => pub.getBalance({ address: a }),
  };
}

/** Testnet demo faucet wallet (the deployer). */
export function createViemFaucetChain(cfg: ApiConfig): FaucetChain | undefined {
  if (!cfg.deployerKey || !cfg.demo.enabled) return undefined;
  const { chain, transport, pub } = makeClients(cfg);
  const account = privateKeyToAccount(cfg.deployerKey);
  const sender = sharedSender(account, pub, chain, transport, cfg.rpcUrl);
  return {
    address: account.address,
    usdtBalance: (a: Address) => pub.readContract({ address: cfg.usdt, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
    async sendUsdt(to, amount) {
      await pub.simulateContract({ address: cfg.usdt, abi: erc20Abi, functionName: "transfer", args: [to, amount], account });
      return sender.send((nonce) => sender.wallet.writeContract({ address: cfg.usdt, abi: erc20Abi, functionName: "transfer", args: [to, amount], account, chain, nonce }));
    },
    async wait(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      return { txHash: hash, status: r.status };
    },
  };
}
