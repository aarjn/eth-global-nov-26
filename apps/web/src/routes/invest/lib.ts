// Investor-side InvoiceNote calls from the browser-local TESTNET DEMO investor wallet (lib/wallet.ts).
// The investor pays its own gas. Every action is simulated first (eth_call); a revert is decoded with the InvoiceNote
// ABI so the UI can show the contract's own reason (NotAllowlisted, MaturityPassed, ...).
import { BaseError, ContractFunctionRevertedError, createWalletClient, erc20Abi, http, type Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  INVOICE_NOTE_ADDRESS, USDT_ADDRESS, invoiceNoteAbi, whitechainTestnet,
  type Address, type Hex, type Invoice, type Note,
} from "@paisalink/shared";
import { publicClient } from "../../lib/chain";
import { api } from "../../lib/api";

const NOTE_ABI = invoiceNoteAbi as Abi;
/** Allowlisted at deploy (docs/specs/contracts.md "Deployment"), so a transfer before maturity can be shown. */
export const DEMO_PAYER: Address = "0x32c84603C9848FFa470FB07C9bCe820944D04c52";
/** Gas limit for a deliberately reverting tx, so it is mined (and visible on the explorer) instead of refused by estimateGas. */
const FORCED_GAS = 200_000n;

// ---------- API shapes (apps/api/src/routes/notes.ts) ----------

export interface ChainView {
  noteId: number; invoiceId: Hex; issuer: Address; holder: Address | null;
  faceUsdt: string; priceUsdt: string; escrowUsdt: string; maturity: number;
  state: "issued" | "funded" | "settled"; discountPct: number; matured: boolean; escrowFull: boolean;
}
export type NoteRow = Note & { onchain: ChainView | null };
export interface NotesList { notes: NoteRow[]; noteContract: Address | null; source: string; chainTime: number }
export interface NoteEvent { name: string; txHash: Hex; blockNumber: string; args: Record<string, unknown>; explorerUrl: string }
export interface NoteDetail {
  note: Note | null; onchain: ChainView | null; inSync: boolean; invoice: Invoice | null; holderAllowed: boolean | null;
  events: NoteEvent[] | null; noteContract: Address | null; chainTime: number;
}

// ---------- pure helpers ----------

/** "1:05", "4m 10s", "2d 3h" until maturity; "matured" once past. */
export function countdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "matured";
  const s = Math.floor(secondsLeft);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function discount(face: string, price: string): { pct: number; profit: number } {
  const f = Number(face), p = Number(price);
  if (!(f > 0) || !Number.isFinite(p)) return { pct: 0, profit: 0 };
  return { pct: Math.round(((f - p) / f) * 10_000) / 100, profit: Math.round((f - p) * 1e6) / 1e6 };
}

export interface Revert { name: string; args: string[]; text: string }

/** Plain-language meaning of each InvoiceNote custom error. */
export function explainRevert(name: string): string {
  switch (name) {
    case "NotAllowlisted": return "This wallet is not on the investor allowlist. Only approved investors can buy or hold a note.";
    case "MaturityPassed": return "The note has matured. Transfers are locked; the only thing left is settlement in USDT.";
    case "NotMatured": return "Not matured yet. Settlement pays out only on or after the maturity date.";
    case "EscrowShort": return "The customer has not paid the invoice yet, so the escrow does not hold the face value.";
    case "NotHolder": return "Only the current holder can move this note.";
    case "WrongState": return "The note is not in the right state for this action.";
    case "InvoiceNotOpen": return "The invoice is no longer open.";
    case "InvoiceAlreadyNoted": return "This invoice has already been sold.";
    case "InvalidTerms": return "The price, face value or maturity is not allowed.";
    case "NoteNotFound": return "There is no such note.";
    default: return "The contract refused this action.";
  }
}

export function decodeRevert(e: unknown): Revert {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.data?.errorName) {
      const args = (r.data.args ?? []).map((a) => String(a));
      return { name: r.data.errorName, args, text: explainRevert(r.data.errorName) };
    }
    if (r?.reason) return { name: r.reason, args: [], text: r.reason };
    return { name: "Error", args: [], text: e.shortMessage || e.message.split("\n")[0] };
  }
  return { name: "Error", args: [], text: (e as Error)?.message?.split("\n")[0] ?? String(e) };
}

export const revertLabel = (r: Revert) => `${r.name}${r.args.length ? `(${r.args.map((a) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)).join(", ")})` : ""}`;

// ---------- chain ----------

let noteAddr: Address | null = (import.meta.env.VITE_INVOICE_NOTE_ADDRESS as Address | undefined) || INVOICE_NOTE_ADDRESS;

/** InvoiceNote address: VITE_INVOICE_NOTE_ADDRESS, else contracts/deployments/1874.json, else the API's /config. */
export async function getNoteAddress(): Promise<Address | null> {
  if (noteAddr) return noteAddr;
  try {
    const c = await api.get<{ invoiceNote?: string | null }>("/config");
    if (c.invoiceNote && /^0x[0-9a-fA-F]{40}$/.test(c.invoiceNote)) noteAddr = c.invoiceNote as Address;
  } catch { /* API down: caller shows "not configured" */ }
  return noteAddr;
}

export async function isAllowed(note: Address, a: Address): Promise<boolean> {
  return publicClient.readContract({ address: note, abi: NOTE_ABI, functionName: "allowed", args: [a] }) as Promise<boolean>;
}

export const wbtBalance = (a: Address) => publicClient.getBalance({ address: a });

/** A fresh random address that has never been allowlisted (for the "non-allowlisted wallet" proof). */
export const strangerAddress = (): Address => privateKeyToAccount(generatePrivateKey()).address;

export type TryResult = { ok: true } | { ok: false; revert: Revert };

/** eth_call as `from` (no key needed). Shows what the contract would do, without spending gas. */
export async function tryCall(note: Address, from: Address, functionName: "fund" | "transfer" | "settle", args: readonly unknown[]): Promise<TryResult> {
  try {
    await publicClient.simulateContract({ address: note, abi: NOTE_ABI, functionName, args, account: from });
    return { ok: true };
  } catch (e) { return { ok: false, revert: decodeRevert(e) }; }
}

export class TxReverted extends Error {
  constructor(readonly revert: Revert) { super(`${revertLabel(revert)}: ${revert.text}`); }
}

export interface SentTx { hash: Hex; status: "success" | "reverted" }

async function send(account: PrivateKeyAccount, req: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }, opts: { force?: boolean } = {}): Promise<SentTx> {
  if (!opts.force) {
    try { await publicClient.simulateContract({ ...req, account }); }
    catch (e) { throw new TxReverted(decodeRevert(e)); }
  }
  const wallet = createWalletClient({ account, chain: whitechainTestnet, transport: http() });
  const gasPrice = await publicClient.getGasPrice();
  const hash = await wallet.writeContract({ ...req, account, chain: whitechainTestnet, gasPrice, ...(opts.force ? { gas: FORCED_GAS } : {}) } as never);
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return { hash, status: r.status };
}

/** USDT approve (only if the allowance is short) then fund. Returns both tx hashes. */
export async function fundNote(account: PrivateKeyAccount, note: Address, noteId: number, price: bigint, onStep?: (s: string) => void): Promise<{ approve?: SentTx; fund: SentTx }> {
  const allowance = await publicClient.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [account.address, note] });
  let approve: SentTx | undefined;
  if (allowance < price) {
    onStep?.("Approving USDT…");
    approve = await send(account, { address: USDT_ADDRESS, abi: erc20Abi as Abi, functionName: "approve", args: [note, price] });
    if (approve.status !== "success") throw new Error("USDT approval failed on chain");
  }
  onStep?.("Buying the note…");
  const fund = await send(account, { address: note, abi: NOTE_ABI, functionName: "fund", args: [BigInt(noteId)] });
  if (fund.status !== "success") throw new Error("fund() reverted on chain");
  return { approve, fund };
}

export const transferNote = (account: PrivateKeyAccount, note: Address, noteId: number, to: Address) =>
  send(account, { address: note, abi: NOTE_ABI, functionName: "transfer", args: [BigInt(noteId), to] });

export const settleNote = (account: PrivateKeyAccount, note: Address, noteId: number) =>
  send(account, { address: note, abi: NOTE_ABI, functionName: "settle", args: [BigInt(noteId)] });

/** Sends a call the contract will refuse, with a fixed gas limit, so the failed attempt is recorded on chain. */
export const forceCall = (account: PrivateKeyAccount, note: Address, functionName: "fund" | "transfer" | "settle", args: readonly unknown[]) =>
  send(account, { address: note, abi: NOTE_ABI, functionName, args }, { force: true });

/** Ask the API to re-read the note from chain and mirror it into Arkiv. Errors are non-fatal for the UI. */
export async function syncNote(noteId: number): Promise<void> {
  try { await api.post(`/notes/${noteId}/sync`, {}); } catch { /* the 5 s poll will catch up */ }
}
