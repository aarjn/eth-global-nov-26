// TEST-ONLY fake of the Whitechain RouterChain/FaucetChain. Mimics PaymentRouter rules closely enough to test the
// relayer's own logic (validation, budget, queue, store updates). Not used by the running server.
import { keccak256, toHex, getAddress } from "viem";
import type { Address, Hex } from "@paisalink/shared";
import { invoicePaymentNonce } from "@paisalink/shared";
import { SimulationError, type FaucetChain, type OnchainInvoice, type RouterCall, type RouterChain, type Simulation, type TxOutcome } from "../src/chain";

export const ROUTER: Address = "0x1111111111111111111111111111111111111111";
export const RELAYER: Address = "0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F";

export class FakeChain implements RouterChain {
  chainId = 1874;
  routerAddress = ROUTER;
  relayerAddress = RELAYER;
  invoices = new Map<string, OnchainInvoice>();
  usedAuth = new Set<string>();
  merchantNonces = new Map<string, bigint>();
  sent: RouterCall[] = [];
  gas = 100_000n;
  gasPrice = 5_000_000_000n; // 5 gwei floor -> 0.0005 WBT per simulated call
  revertNext: string | null = null;
  revertOnChain = false;
  private pending = new Map<Hex, RouterCall>();
  /** Mined receipts by hash: our own sends, plus txs injected by tests (e.g. a payer's self-paid pay()). */
  mined = new Map<string, TxOutcome>();
  private n = 0;

  async simulate(call: RouterCall): Promise<Simulation> {
    if (this.revertNext) { const r = this.revertNext; this.revertNext = null; throw new SimulationError(r); }
    const inv = "invoiceId" in call ? this.invoices.get(call.invoiceId.toLowerCase()) : undefined;
    if (call.fn === "createInvoiceFor" && inv) throw new SimulationError("InvoiceExists");
    if (call.fn === "payWithAuthorization") {
      if (!inv || inv.status !== "open") throw new SimulationError("InvoiceNotOpen");
      if (call.value !== inv.amount) throw new SimulationError("WrongValue");
      if (call.nonce !== invoicePaymentNonce(ROUTER, call.invoiceId)) throw new SimulationError("WrongNonce");
    }
    return { gas: this.gas, gasPrice: this.gasPrice };
  }
  async send(call: RouterCall): Promise<Hex> {
    this.sent.push(call);
    const h = keccak256(toHex(`tx${++this.n}`));
    this.pending.set(h, call);
    return h;
  }
  async receipt(hash: Hex) { return this.mined.get(hash.toLowerCase()) ?? null; }
  async wait(hash: Hex): Promise<TxOutcome> {
    const o = await this.waitInner(hash);
    this.mined.set(hash.toLowerCase(), o);
    return o;
  }
  /** Simulate the payer calling PaymentRouter.pay() themselves; returns the tx hash. */
  selfPay(invoiceId: Hex, payer: Address, opts: { status?: "success" | "reverted"; eventInvoiceId?: Hex } = {}): Hex {
    const inv = this.invoices.get(invoiceId.toLowerCase())!;
    const hash = keccak256(toHex(`selfpay${++this.n}`));
    if ((opts.status ?? "success") === "success") Object.assign(inv, { status: "paid", payer, balance: inv.amount, paidAt: 1_800_000_100 });
    this.mined.set(hash.toLowerCase(), {
      txHash: hash, status: opts.status ?? "success", gasCostWei: 0n, blockNumber: BigInt(this.n), blockTimestamp: 1_800_000_100,
      events: opts.status === "reverted" ? [] : [{ name: "InvoicePaid", args: { invoiceId: opts.eventInvoiceId ?? invoiceId, payer, amount: inv.amount, gasless: false } }],
    });
    return hash;
  }
  private async waitInner(hash: Hex): Promise<TxOutcome> {
    const call = this.pending.get(hash)!;
    const base = { txHash: hash, gasCostWei: this.gas * this.gasPrice, blockNumber: BigInt(this.n), blockTimestamp: 1_800_000_000 };
    if (this.revertOnChain) return { ...base, status: "reverted", events: [] };
    const id = "invoiceId" in call ? call.invoiceId.toLowerCase() : "";
    const inv = this.invoices.get(id);
    switch (call.fn) {
      case "createInvoiceFor":
        this.invoices.set(id, { merchant: call.merchant, dueAt: Number(call.dueAt), payer: "0x0000000000000000000000000000000000000000", paidAt: 0, status: "open", financed: false, amount: call.amount, balance: 0n, refunded: 0n, noteId: 0n });
        return { ...base, status: "success", events: [{ name: "InvoiceCreated", args: { invoiceId: call.invoiceId, merchant: call.merchant, amount: call.amount, dueAt: call.dueAt } }] };
      case "payWithAuthorization":
        Object.assign(inv!, { status: "paid", payer: call.from, balance: call.value, paidAt: base.blockTimestamp });
        this.usedAuth.add(`${call.from.toLowerCase()}:${call.nonce}`);
        return { ...base, status: "success", events: [{ name: "InvoicePaid", args: { invoiceId: call.invoiceId, payer: call.from, amount: call.value, gasless: true } }] };
      case "refundWithSig": {
        inv!.balance -= call.amount; inv!.refunded += call.amount;
        if (inv!.refunded === inv!.amount) inv!.status = "refunded";
        this.bumpNonce(inv!.merchant);
        return { ...base, status: "success", events: [{ name: "InvoiceRefunded", args: { invoiceId: call.invoiceId, to: inv!.payer, amount: call.amount } }] };
      }
      case "withdrawWithSig": {
        const amt = inv!.balance; inv!.balance = 0n; inv!.status = "withdrawn"; this.bumpNonce(inv!.merchant);
        return { ...base, status: "success", events: [{ name: "Withdrawn", args: { invoiceId: call.invoiceId, merchant: inv!.merchant, amount: amt } }] };
      }
    }
  }
  private bumpNonce(m: Address) { const k = m.toLowerCase(); this.merchantNonces.set(k, (this.merchantNonces.get(k) ?? 0n) + 1n); }
  async getInvoice(id: Hex) { const i = this.invoices.get(id.toLowerCase()); return i ? { ...i } : null; }
  async authorizationUsed(from: Address, nonce: Hex) { return this.usedAuth.has(`${from.toLowerCase()}:${nonce}`); }
  async merchantNonce(m: Address) { return this.merchantNonces.get(m.toLowerCase()) ?? 0n; }
  async relayerBalance() { return 500_000_000_000_000_000n; }
  async rpcChainId() { return 1874; }
  queueDepth() { return 0; }
}

export class FakeFaucet implements FaucetChain {
  address: Address = getAddress("0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb");
  balances = new Map<string, bigint>([[this.address.toLowerCase(), 1_000_000_000n]]);
  async usdtBalance(a: Address) { return this.balances.get(a.toLowerCase()) ?? 0n; }
  async sendUsdt(to: Address, amount: bigint): Promise<Hex> {
    this.balances.set(this.address.toLowerCase(), (await this.usdtBalance(this.address)) - amount);
    this.balances.set(to.toLowerCase(), (await this.usdtBalance(to)) + amount);
    return keccak256(toHex(`fund${to}`));
  }
  async wait(hash: Hex) { return { txHash: hash, status: "success" as const }; }
}
