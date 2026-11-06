import { INR_PER_USDT } from "./config";

export function money(amount: string | number, opts: { min?: number } = {}): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toLocaleString("en-IN", { minimumFractionDigits: opts.min ?? (Number.isInteger(n) ? 0 : 2), maximumFractionDigits: 6 });
}

export function inr(amountUsdt: string | number): string {
  const n = Number(amountUsdt) * INR_PER_USDT;
  if (!Number.isFinite(n)) return "";
  return `≈ ₹${Math.round(n).toLocaleString("en-IN")}`;
}

export const short = (a?: string, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "");

export function dateStr(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTimeStr(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
