// Framework-free checkout core shared by the React component and embed.js.
// Flow: create an invoice through the PaisaLink API, then open the hosted
// checkout (/pay/:id) in a modal iframe and wait for a "paid" postMessage.

export interface PaidResult {
  invoiceId: string;
  txHash: string;
  explorerUrl: string;
  receiptUrl: string;
}

export interface CheckoutOptions {
  /** Amount in USDT, e.g. "49" or 49.5 */
  amount: string | number;
  /** Merchant wallet address that receives the payment */
  merchant: string;
  memo?: string;
  /** Days until the invoice is due (default 7) */
  dueInDays?: number;
  /** PaisaLink API base URL (default http://localhost:8787) */
  apiUrl?: string;
  /** PaisaLink web app base URL that hosts /pay/:id (default: current origin) */
  appUrl?: string;
  onPaid?: (r: PaidResult) => void;
  onClose?: () => void;
  onError?: (e: Error) => void;
}

export interface CreatedInvoice {
  invoiceId: string;
  amountUsdt: string;
  merchant: string;
  state: string;
}

/** Message the hosted checkout posts to its parent window. */
export type CheckoutMessage =
  | ({ source: "paisalink"; type: "paid" } & PaidResult)
  | { source: "paisalink"; type: "close" };

export const DEFAULT_API_URL = "http://localhost:8787";

const trim = (u: string) => u.replace(/\/+$/, "");

export function normalizeAmount(amount: string | number): string {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s) || Number(s) <= 0) throw new Error(`Invalid amount: ${s}`);
  return s;
}

export async function createInvoice(opts: CheckoutOptions): Promise<CreatedInvoice> {
  const api = trim(opts.apiUrl || DEFAULT_API_URL);
  const dueAt = Math.floor(Date.now() / 1000) + (opts.dueInDays ?? 7) * 86400;
  const res = await fetch(`${api}/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchant: opts.merchant, amountUsdt: normalizeAmount(opts.amount), dueAt, memo: (opts.memo ?? "").slice(0, 128) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Could not create the invoice (HTTP ${res.status})`);
  return body as CreatedInvoice;
}

export function checkoutUrl(invoiceId: string, appUrl?: string): string {
  const base = trim(appUrl || (typeof location !== "undefined" ? location.origin : ""));
  return `${base}/pay/${invoiceId}?embed=1`;
}

export function isCheckoutMessage(data: unknown): data is CheckoutMessage {
  return !!data && typeof data === "object" && (data as { source?: unknown }).source === "paisalink";
}

const STYLE_ID = "paisalink-style";
const CSS = `
.pl-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:pl-fade .15s ease-out}
.pl-frame-wrap{position:relative;width:420px;max-width:100vw;height:min(720px,100dvh);background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35);animation:pl-up .2s ease-out}
.pl-frame-wrap iframe{border:0;width:100%;height:100%;display:block}
.pl-close{position:absolute;top:10px;right:10px;z-index:1;width:34px;height:34px;border-radius:999px;border:0;background:rgba(15,23,42,.06);color:#0f172a;font:600 18px/1 system-ui;cursor:pointer}
.pl-close:hover{background:rgba(15,23,42,.12)}
@media (max-width:480px){.pl-frame-wrap{width:100vw;height:100dvh;border-radius:0}}
@keyframes pl-fade{from{opacity:0}to{opacity:1}}@keyframes pl-up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Opens /pay/:id in a modal iframe. Returns a function that closes it. */
export function openCheckout(invoiceId: string, opts: Pick<CheckoutOptions, "appUrl" | "onPaid" | "onClose">): () => void {
  ensureStyle();
  const url = checkoutUrl(invoiceId, opts.appUrl);
  const origin = new URL(url).origin;
  const backdrop = document.createElement("div");
  backdrop.className = "pl-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "PaisaLink checkout");
  const wrap = document.createElement("div");
  wrap.className = "pl-frame-wrap";
  const close = document.createElement("button");
  close.className = "pl-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close checkout");
  close.textContent = "×";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "PaisaLink checkout";
  frame.allow = "clipboard-write";
  wrap.append(close, frame);
  backdrop.appendChild(wrap);
  document.body.appendChild(backdrop);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let closed = false;
  const shut = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    document.body.style.overflow = prevOverflow;
    opts.onClose?.();
  };
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin || e.source !== frame.contentWindow || !isCheckoutMessage(e.data)) return;
    if (e.data.type === "paid") {
      const { invoiceId: id, txHash, explorerUrl, receiptUrl } = e.data;
      opts.onPaid?.({ invoiceId: id, txHash, explorerUrl, receiptUrl });
    } else if (e.data.type === "close") shut();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") shut(); };
  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKey);
  close.addEventListener("click", shut);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) shut(); });
  return shut;
}

/** Create an invoice and open the checkout in one call. */
export async function checkout(opts: CheckoutOptions): Promise<() => void> {
  try {
    const inv = await createInvoice(opts);
    return openCheckout(inv.invoiceId, opts);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    opts.onError?.(err);
    throw err;
  }
}
