// Merchant-side EIP-712 signing for actions the relayer submits (refunds), so merchants never need gas.
import type { PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "@paisalink/shared";
import { api } from "./api";

type TypedField = { name: string; type: string };
export interface TypedDataJson {
  domain: Record<string, unknown>;
  types: Record<string, TypedField[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** JSON carries uint256 values as decimal strings; viem wants bigint. Convert by declared type. */
export function reviveTypedData(td: TypedDataJson) {
  const types = Object.fromEntries(Object.entries(td.types).filter(([k]) => k !== "EIP712Domain"));
  const conv = (typeName: string, value: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of types[typeName] ?? []) {
      const v = value[f.name];
      if (/^u?int\d*$/.test(f.type) && (typeof v === "string" || typeof v === "number")) out[f.name] = BigInt(v);
      else if (types[f.type] && v && typeof v === "object") out[f.name] = conv(f.type, v as Record<string, unknown>);
      else out[f.name] = v;
    }
    return out;
  };
  const domain = { ...td.domain } as Record<string, unknown>;
  if (typeof domain.chainId === "string") domain.chainId = Number(domain.chainId);
  return { domain, types, primaryType: td.primaryType, message: conv(td.primaryType, td.message) };
}

export async function signTyped(account: PrivateKeyAccount, td: TypedDataJson): Promise<Hex> {
  const r = reviveTypedData(td);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return account.signTypedData(r as any);
}

export interface RefundResult { txHash: Hex; explorerUrl?: string; refundedUsdt?: string; state?: string }

/** The API returns the Refund typed data (router domain + the merchant's current router nonce); sign it and submit. */
export async function refundInvoice(account: PrivateKeyAccount, invoiceId: Hex, amountUsdt: string): Promise<RefundResult> {
  const typedData = await api.get<TypedDataJson>(`/invoices/${invoiceId}/refund-typed-data?amountUsdt=${encodeURIComponent(amountUsdt)}`);
  if (typedData.primaryType !== "Refund") throw new Error("Unexpected refund request from the server.");
  const deadline = String(typedData.message.deadline);
  const signature = await signTyped(account, typedData);
  return api.post<RefundResult>(`/invoices/${invoiceId}/refund`, { amountUsdt, deadline, signature });
}
