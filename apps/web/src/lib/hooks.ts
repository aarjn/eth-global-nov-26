import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Invoice, Merchant } from "@paisalink/shared";
import { api, ApiError } from "./api";

/** Merchant profile. `null` = not registered yet; `undefined` = loading or API unavailable. */
export function useMerchant(wallet: Address) {
  const [merchant, setMerchant] = useState<Merchant | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setMerchant(await api.get<Merchant>(`/merchants/${wallet}`));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setMerchant(null); setError(null); }
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [wallet]);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  return { merchant, error, refresh, setMerchant };
}

const cacheKey = (w: string) => `paisalink.cache.invoices.${w.toLowerCase()}`;

/**
 * Live invoice list for a merchant. Reads the API (which reads Arkiv), refetches on every
 * server-sent event when /merchants/:wallet/events exists, and polls every 4 s as a fallback.
 * Keeps the last good read (also in localStorage) so a slow node never blanks the dashboard.
 */
export function useInvoices(wallet: Address, opts: { onEvent?: () => void } = {}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(() => {
    try { const c = localStorage.getItem(cacheKey(wallet)); return c ? (JSON.parse(c).invoices as Invoice[]) : null; } catch { return null; }
  });
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const inflight = useRef(false);
  const onEvent = useRef(opts.onEvent);
  onEvent.current = opts.onEvent;

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const list = await api.get<Invoice[]>(`/merchants/${wallet}/invoices`);
      const sorted = list; // the API returns newest first
      setInvoices(sorted);
      setSyncedAt(Date.now());
      setError(null);
      try { localStorage.setItem(cacheKey(wallet), JSON.stringify({ invoices: sorted })); } catch { /* quota */ }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setInvoices([]); setSyncedAt(Date.now()); setError(null); }
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    let es: EventSource | null = null;
    try {
      es = new EventSource(api.url(`/merchants/${wallet}/events`));
      es.onopen = () => setLive(true);
      // The API names events "change" (invoice/payment/note, incl. World ID verification); refetch on each.
      const on = () => { void refresh(); onEvent.current?.(); };
      es.onmessage = on;
      es.addEventListener("change", on);
      es.onerror = () => { setLive(false); es?.close(); };
    } catch { /* no SSE: polling only */ }
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); es?.close(); window.removeEventListener("focus", onFocus); };
  }, [wallet, refresh]);

  return { invoices, syncedAt, error, live, refresh, setInvoices };
}

/** Re-render every `ms` (for "synced 3s ago" labels). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

/** Whether payments can run: the PaymentRouter is known (deployed) and the API reports gasless relaying. */
export function useServiceStatus() {
  const [status, setStatus] = useState<{ router: string | null; gasless: boolean } | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const load = () => api.get<{ paymentRouter: string | null; gasless?: boolean }>("/config")
      .then((c) => { if (!stop) setStatus({ router: c.paymentRouter, gasless: !!c.gasless }); })
      .catch(() => { /* API down: the sync pill already says so */ });
    void load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return status;
}

/** Invoice ids (lowercase) of this merchant that have an InvoiceNote (sold for cash). Their payment goes to note escrow. */
export function useNotedInvoices(wallet: Address) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ notes: { invoiceId: string }[] }>(`/notes?issuer=${wallet}`);
      setIds(new Set((r.notes ?? []).map((n) => n.invoiceId.toLowerCase())));
    } catch { /* notes API not available: keep the last known set */ }
  }, [wallet]);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  return { noted: ids, refresh };
}
