import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { InvoiceState } from "@paisalink/shared";
import { explorerTxUrl } from "../lib/config";
import { short } from "../lib/format";

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-3xl bg-white shadow-card ring-1 ring-ink-900/5", className)}>{children}</div>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "primary", loading, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const v: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-brand active:bg-brand-800",
    secondary: "bg-white text-ink-900 ring-1 ring-ink-900/10 hover:bg-ink-50",
    ghost: "text-ink-700 hover:bg-ink-900/5",
    danger: "bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50",
  };
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx("inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500", v[variant], className)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <svg className={cx("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

const stateStyle: Record<InvoiceState, { label: string; cls: string; dot: string }> = {
  open: { label: "Awaiting payment", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  paid: { label: "Paid", cls: "bg-brand-50 text-brand-800 ring-brand-200", dot: "bg-brand-500" },
  refunded: { label: "Refunded", cls: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500" },
  financed: { label: "Sold for cash", cls: "bg-violet-50 text-violet-800 ring-violet-200", dot: "bg-violet-500" },
  settled: { label: "Settled", cls: "bg-ink-100 text-ink-800 ring-ink-200", dot: "bg-ink-500" },
};

export function StateBadge({ state }: { state: InvoiceState }) {
  const s = stateStyle[state] ?? stateStyle.open;
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", s.cls)}>
    <span className={cx("size-1.5 rounded-full", s.dot, state === "open" && "animate-pulse")} />{s.label}
  </span>;
}

export function Badge({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "brand" | "amber" | "rose" }) {
  const t = { ink: "bg-ink-100 text-ink-700", brand: "bg-brand-50 text-brand-800", amber: "bg-amber-50 text-amber-800", rose: "bg-rose-50 text-rose-700" }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", t)}>{children}</span>;
}

/** Honest label for the browser-local key. Required wherever a demo wallet is used. */
export function DemoWalletTag({ address, role }: { address: string; role: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200"
    title={`A browser-local testnet demo ${role} wallet: ${address}. The key is stored only in this browser. Not for real funds.`}>
    <svg className="size-3" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    Testnet demo {role} wallet · {short(address)}
  </span>;
}

export function TxLink({ hash, label = "View transaction" }: { hash?: string; label?: string }) {
  if (!hash) return null;
  return <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer"
    className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline">
    {label}<svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </a>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="block">
    <span className="mb-1.5 block text-sm font-semibold text-ink-800">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
  </label>;
}

export const inputCls = "w-full rounded-2xl border-0 bg-ink-50 px-4 py-3 text-base text-ink-900 ring-1 ring-ink-900/10 placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500";

export function Alert({ tone = "rose", children }: { tone?: "rose" | "amber" | "brand"; children: ReactNode }) {
  const t = { rose: "bg-rose-50 text-rose-800 ring-rose-200", amber: "bg-amber-50 text-amber-900 ring-amber-200", brand: "bg-brand-50 text-brand-900 ring-brand-200" }[tone];
  return <div role={tone === "rose" ? "alert" : "status"} className={cx("rounded-2xl px-4 py-3 text-sm ring-1", t)}>{children}</div>;
}

export function Logo({ className }: { className?: string }) {
  return <span className={cx("inline-flex items-center gap-2 font-extrabold tracking-tight text-ink-900", className)}>
    <svg className="size-7" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0b7a5c" /><path d="M10 9h7.5a5 5 0 010 10H14v4h-4V9zm4 3.5v3h3.3a1.5 1.5 0 000-3H14z" fill="#fff" /></svg>
    <span>Paisa<span className="text-brand-600">Link</span></span>
  </span>;
}
