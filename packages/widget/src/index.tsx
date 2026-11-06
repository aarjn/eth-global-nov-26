import { useState, type CSSProperties, type ReactNode } from "react";
import { checkout, type CheckoutOptions, type PaidResult } from "./core";

export type { PaidResult, CheckoutOptions } from "./core";
export { checkout, createInvoice, openCheckout, checkoutUrl } from "./core";

export interface PaisaLinkProps extends Omit<CheckoutOptions, "onError"> {
  /** Button label; defaults to "Pay {amount} USDT" */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onError?: (e: Error) => void;
}

const baseStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 22px", borderRadius: 14, border: 0,
  background: "#0b7a5c", color: "#fff", font: "600 16px/1.2 system-ui, -apple-system, Segoe UI, sans-serif",
  cursor: "pointer", boxShadow: "0 8px 20px rgba(11,122,92,.25)",
};

/** Drop-in PaisaLink checkout button. */
export function PaisaLink({ children, className, style, onError, ...opts }: PaisaLinkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkout({
        ...opts,
        onPaid: (r: PaidResult) => opts.onPaid?.(r),
        onError: (e) => { setError(e.message); onError?.(e); },
      });
    } catch {
      /* surfaced via onError */
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className={className} style={className ? style : { ...baseStyle, opacity: busy ? 0.75 : 1, ...style }}
        onClick={onClick} disabled={busy} aria-busy={busy} data-paisalink-button="">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Opening checkout…" : children ?? `Pay ${opts.amount} USDT`}
      </button>
      {error && <span role="alert" style={{ color: "#b42318", font: "500 13px system-ui" }}>{error}</span>}
    </span>
  );
}

export default PaisaLink;
