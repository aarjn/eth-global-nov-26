// Contract addresses on Whitechain testnet (1874), read from contracts/deployments/1874.json (written by W1's deploy).
// Until the deploy has run, `deployed` is false and the contract addresses are null: callers must check.
import deployment from "../../../contracts/deployments/1874.json";
import type { Address, Hex } from "./types";

export interface Deployment {
  chainId: 1874;
  deployed: boolean;
  usdt: Address;
  owner: Address;
  operator: Address;
  paymentRouter: Address | null;
  invoiceNote: Address | null;
  deployBlock: number | null;
  txs: Partial<Record<"paymentRouter" | "invoiceNote" | "setNoteContract" | string, Hex>>;
  /** First real gasless USDT payment (FirstPayment.s.sol), null until broadcast. */
  firstPayment?: { invoiceId: Hex; payer: Address; amountUsdtBase: string; gasless: true; submittedBy: Address; createInvoiceTx: Hex | null; payTx: Hex; block: number; explorer: string } | null;
}

export const DEPLOYMENT = deployment as unknown as Deployment;

/** Throws a clear error if the contracts are not deployed yet. */
export function requireAddresses(): { paymentRouter: Address; invoiceNote: Address; usdt: Address } {
  const d = DEPLOYMENT;
  if (!d.deployed || !d.paymentRouter || !d.invoiceNote) {
    throw new Error("PaisaLink contracts are not deployed yet (contracts/deployments/1874.json has deployed=false)");
  }
  return { paymentRouter: d.paymentRouter, invoiceNote: d.invoiceNote, usdt: d.usdt };
}

export const PAYMENT_ROUTER_ADDRESS: Address | null = DEPLOYMENT.paymentRouter;
export const INVOICE_NOTE_ADDRESS: Address | null = DEPLOYMENT.invoiceNote;
