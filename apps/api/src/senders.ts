// One send queue per key, shared by every module in this process (relayer txs, /demo/fund, notes.ts issue/allowlist/
// WBT drips). Keyed by RPC URL + address, so the same wallet always serialises through the same promise chain.
// Nonce = max(pending count on chain, last nonce we used + 1); a nonce error resyncs from the chain and retries.
import { createWalletClient, type Hex, type PublicClient, type Transport, type Chain, type WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { TxQueue } from "./queue";

const NONCE_ERR = /nonce too low|nonce has already been used|replacement transaction underpriced|already known|invalid nonce/i;

export class SharedSender {
  readonly queue = new TxQueue();
  readonly wallet: WalletClient;
  private nextNonce: number | undefined;
  sent = 0;
  constructor(readonly account: PrivateKeyAccount, private pub: PublicClient, chain: Chain, transport: Transport) {
    this.wallet = createWalletClient({ account, chain, transport });
  }

  /** Queue a send. `build` gets the nonce to use and must return the tx hash. */
  send(build: (nonce: number) => Promise<Hex>): Promise<Hex> {
    return this.queue.run(async () => {
      for (let attempt = 0; ; attempt++) {
        const chainNonce = await this.pub.getTransactionCount({ address: this.account.address, blockTag: "pending" });
        const nonce = Math.max(chainNonce, this.nextNonce ?? 0);
        try {
          const hash = await build(nonce);
          this.nextNonce = nonce + 1;
          this.sent++;
          return hash;
        } catch (e) {
          this.nextNonce = undefined; // resync from the chain next time
          if (attempt < 2 && NONCE_ERR.test((e as Error)?.message ?? "")) { await Bun.sleep(1500); continue; }
          throw e;
        }
      }
    });
  }
  /** Alias kept for notes.ts (W5), which called its sender's method `run`. */
  run(build: (nonce: number) => Promise<Hex>): Promise<Hex> { return this.send(build); }
}

const registry = new Map<string, SharedSender>();

/** The process-wide sender for this key on this RPC. Always use this instead of creating a wallet client yourself. */
export function sharedSender(account: PrivateKeyAccount, pub: PublicClient, chain: Chain, transport: Transport, rpcUrl: string): SharedSender {
  const k = `${rpcUrl}|${account.address.toLowerCase()}`;
  let s = registry.get(k);
  if (!s) { s = new SharedSender(account, pub, chain, transport); registry.set(k, s); }
  return s;
}

/** For /health: queue depth and sends per key. */
export function senderStats() {
  return [...registry.values()].map((s) => ({ address: s.account.address, pending: s.queue.pending, sent: s.sent }));
}
