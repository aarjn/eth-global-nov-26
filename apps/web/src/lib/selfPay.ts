// Self-paid fallback: the payer's own injected wallet approves USDT and calls PaymentRouter.pay(invoiceId),
// paying the network fee itself. Used only when the gas-sponsored path is unavailable (merchant not verified).
import { createWalletClient, custom, erc20Abi, parseEventLogs, type EIP1193Provider } from "viem";
import { paymentRouterAbi, USDT_ADDRESS, whitechainTestnet, type Address, type Hex } from "@paisalink/shared";
import { publicClient } from "./chain";

export const injectedProvider = () => (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;

export type SelfPayStep = "connecting" | "approving" | "paying" | "confirming";

export interface SelfPayResult { txHash: Hex; approveTx?: Hex; payer: Address }

export async function selfPay(opts: { router: Address; invoiceId: Hex; amount: bigint; onStep?: (s: SelfPayStep) => void }): Promise<SelfPayResult> {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found. Install a wallet such as MetaMask to pay this way.");
  opts.onStep?.("connecting");
  const wc = createWalletClient({ chain: whitechainTestnet, transport: custom(provider) });
  const [account] = await wc.requestAddresses();
  if (!account) throw new Error("No wallet account was shared.");
  try { await wc.switchChain({ id: whitechainTestnet.id }); } catch { await wc.addChain({ chain: whitechainTestnet }); }

  const [usdt, gas] = await Promise.all([
    publicClient.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    publicClient.getBalance({ address: account }),
  ]);
  if (usdt < opts.amount) throw new Error("This wallet doesn't hold enough USDT for this invoice.");
  if (gas === 0n) throw new Error("This wallet has no WBT to pay the network fee.");

  let approveTx: Hex | undefined;
  const allowance = await publicClient.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [account, opts.router] });
  if (allowance < opts.amount) {
    opts.onStep?.("approving");
    // Some USDT deployments refuse changing a non-zero allowance directly: reset to 0 first.
    if (allowance > 0n) {
      const h0 = await wc.writeContract({ account, chain: whitechainTestnet, address: USDT_ADDRESS, abi: erc20Abi, functionName: "approve", args: [opts.router, 0n] });
      await publicClient.waitForTransactionReceipt({ hash: h0 });
    }
    approveTx = await wc.writeContract({ account, chain: whitechainTestnet, address: USDT_ADDRESS, abi: erc20Abi, functionName: "approve", args: [opts.router, opts.amount] });
    const r = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (r.status !== "success") throw new Error("The USDT approval failed on the network.");
  }

  opts.onStep?.("paying");
  // Simulate first so a revert (e.g. the invoice was paid meanwhile) shows a reason and costs nothing.
  const { request } = await publicClient.simulateContract({ account, address: opts.router, abi: paymentRouterAbi, functionName: "pay", args: [opts.invoiceId] });
  const txHash = await wc.writeContract(request);
  opts.onStep?.("confirming");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("The payment transaction failed on the network.");
  const paid = parseEventLogs({ abi: paymentRouterAbi, eventName: "InvoicePaid", logs: receipt.logs });
  if (!paid.length) throw new Error("The transaction confirmed but no payment event was found.");
  return { txHash, approveTx, payer: account };
}
