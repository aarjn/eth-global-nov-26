// TESTNET-ONLY DEMO FAUCET. Sends a small amount of test USDT from the deployer wallet to a fresh browser
// "testnet demo wallet" so a judge can try checkout. Never enabled outside Whitechain testnet (chain id 1874).
// Limits: one grant per address (in memory + on-chain balance check) and 5 grants per IP per hour.
// Amount: the caller may ask for what it needs (`amountUsdt`, e.g. the invoice amount or the note price); the grant
// tops the wallet up to min(requested, DEMO_FUND_USDT). DEMO_FUND_USDT (default 60) is the cap and the default.
import { formatUnits, parseUnits } from "viem";
import { USDT_DECIMALS, type Address } from "@paisalink/shared";
import { ApiError } from "./errors";
import type { ApiConfig } from "./config";
import type { FaucetChain } from "./chain";
import { SlidingWindowLimiter } from "./ratelimit";
import { parseAddress, parseAmountUsdt } from "./relayer";

export const DEMO_LABEL = "Testnet demo faucet: test USDT on Whitechain testnet only, no real value";

export class DemoFaucet {
  private granted = new Set<string>();
  private ipLimiter: SlidingWindowLimiter;
  readonly amount: bigint;
  grants = 0;

  constructor(private chain: FaucetChain | undefined, private cfg: ApiConfig, now: () => number = Date.now) {
    this.ipLimiter = new SlidingWindowLimiter(cfg.demo.ipPerHour, 3_600_000, now);
    this.amount = parseUnits(cfg.demo.amountUsdt, USDT_DECIMALS);
  }

  get enabled() { return this.cfg.demo.enabled && !!this.chain; }

  async fund(body: unknown, ip: string) {
    if (!this.cfg.demo.enabled) throw new ApiError("NOT_CONFIGURED", "demo faucet is disabled", { demo: true });
    if (!this.chain) throw new ApiError("NOT_CONFIGURED", "demo faucet wallet not configured", { demo: true });
    const b = (body ?? {}) as Record<string, unknown>;
    const to: Address = parseAddress(b.address, "address");
    const requested = b.amountUsdt === undefined || b.amountUsdt === null || b.amountUsdt === "" ? this.amount : parseAmountUsdt(b.amountUsdt).units;
    const want = requested < this.amount ? requested : this.amount;
    const key = to.toLowerCase();
    if (this.granted.has(key)) throw new ApiError("DEMO_FAUCET_LIMIT", "this demo wallet was already funded", { demo: true });
    if (this.ipLimiter.remaining(ip) <= 0) {
      throw new ApiError("DEMO_FAUCET_LIMIT", "demo faucet limit reached for this network; try again later", { demo: true, retryAfterSec: this.ipLimiter.retryAfterSec(ip) });
    }
    const has = await this.chain.usdtBalance(to);
    if (has >= want) {
      this.granted.add(key);
      throw new ApiError("DEMO_FAUCET_LIMIT", "this demo wallet already holds enough test USDT", { demo: true });
    }
    const amount = want - has;
    if ((await this.chain.usdtBalance(this.chain.address)) < amount) {
      throw new ApiError("NOT_CONFIGURED", "demo faucet is out of test USDT", { demo: true, faucet: this.chain.address });
    }
    this.granted.add(key);
    this.ipLimiter.hit(ip);
    try {
      const hash = await this.chain.sendUsdt(to, amount);
      const r = await this.chain.wait(hash);
      if (r.status !== "success") throw new Error("transfer reverted");
      this.grants++;
      return {
        demo: true, label: DEMO_LABEL, to, amountUsdt: formatUnits(amount, USDT_DECIMALS),
        txHash: hash, explorerUrl: `${this.cfg.explorerUrl}/tx/${hash}`,
      };
    } catch (e) {
      this.granted.delete(key);
      throw new ApiError("TX_FAILED", `demo faucet transfer failed: ${(e as Error).message}`, { demo: true });
    }
  }
}
