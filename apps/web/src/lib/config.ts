import type { Address } from "@paisalink/shared";
import { PAYMENT_ROUTER_ADDRESS } from "@paisalink/shared";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8787").replace(/\/+$/, "");
export const EXPLORER_URL = (import.meta.env.VITE_EXPLORER_URL || "https://explorer.testnet.whitechain.io").replace(/\/+$/, "");
/** Indicative INR rate for the "≈ ₹" helper only. Never used for amounts that are paid. */
/** Demo-store price in USDT. Small by default because test USDT is scarce; set VITE_DEMO_PRICE=49 for the realistic demo. */
export const DEMO_PRICE = String(import.meta.env.VITE_DEMO_PRICE || "4.90");
export const INR_PER_USDT = Number(import.meta.env.VITE_INR_PER_USDT || 88);

export const explorerTxUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (a: string) => `${EXPLORER_URL}/address/${a}`;

let routerOverride = import.meta.env.VITE_PAYMENT_ROUTER_ADDRESS as Address | undefined;

/**
 * PaymentRouter address: VITE_PAYMENT_ROUTER_ADDRESS, else W1's deployment file
 * (@paisalink/shared addresses.ts), else the API's public /config.
 */
export async function getRouterAddress(): Promise<Address> {
  if (routerOverride) return routerOverride;
  if (PAYMENT_ROUTER_ADDRESS) return (routerOverride = PAYMENT_ROUTER_ADDRESS);
  try {
    const res = await fetch(`${API_URL}/config`);
    const a = pickAddress(await res.json());
    if (a) return (routerOverride = a);
  } catch { /* fall through */ }
  throw new Error("Payments are not switched on yet. Please try again in a few minutes.");
}

function pickAddress(o: unknown): Address | undefined {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  for (const k of ["PAYMENT_ROUTER_ADDRESS", "paymentRouter", "PaymentRouter", "paymentRouterAddress", "router"]) {
    const v = r[k];
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as Address;
    if (v && typeof v === "object" && typeof (v as { address?: unknown }).address === "string") return (v as { address: Address }).address;
  }
  return undefined;
}

/** Base URL put into payment links (set VITE_PUBLIC_APP_URL to a LAN/Tailscale URL for phone tests). */
export const appUrl = () => (import.meta.env.VITE_PUBLIC_APP_URL || location.origin).replace(/\/+$/, "");
export const payLink = (invoiceId: string) => `${appUrl()}/pay/${invoiceId}`;
export const receiptLink = (invoiceId: string) => `${appUrl()}/r/${invoiceId}`;
export const SWARM_GATEWAY = (import.meta.env.VITE_SWARM_GATEWAY || "https://api.gateway.ethswarm.org/bzz").replace(/\/+$/, "");
export const swarmUrl = (ref: string) => (/^https?:\/\//.test(ref) ? ref : `${SWARM_GATEWAY}/${ref}/`);
