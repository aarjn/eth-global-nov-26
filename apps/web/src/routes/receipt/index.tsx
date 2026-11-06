import { useCallback, useEffect, useState } from "react";
import type { Hex, Invoice, Merchant, Payment } from "@paisalink/shared";
import { Alert, Button, Logo, Spinner, StateBadge, TxLink } from "../../components/ui";
import { api, ApiError, friendlyError } from "../../lib/api";
import { explorerAddressUrl, swarmUrl } from "../../lib/config";
import { pdfPreviewUrl } from "../../lib/swarm";
import { dateStr, dateTimeStr, inr, money, short } from "../../lib/format";

interface Receipt { invoice: Invoice; payment: Payment | null; merchant: Merchant | null }

/** GET /invoices/:id returns the invoice entity plus `payment` and `merchantHandle` (read from Arkiv by the API). */
type InvoiceWithPayment = Invoice & { payment?: Payment | null; merchantHandle?: string | null };

async function loadReceipt(id: Hex): Promise<Receipt> {
  const inv = await api.get<InvoiceWithPayment>(`/invoices/${id}`);
  const { payment = null, merchantHandle, ...invoice } = inv;
  const merchant = await api.get<Merchant>(`/merchants/${invoice.merchant}`).catch(() => null);
  return { invoice: invoice as Invoice, payment, merchant: merchant ?? (merchantHandle ? { handle: merchantHandle } as Merchant : null) };
}

export default function ReceiptPage({ params }: { params: Record<string, string> }) {
  const id = params.id as Hex;
  const [data, setData] = useState<Receipt | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await loadReceipt(id)); setErr(null); }
    catch (e) { if (e instanceof ApiError && e.status === 404) setData(null); else setErr(friendlyError(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // A just-paid invoice can take a block or two to show in Arkiv: refresh until it does.
  useEffect(() => {
    if (!data || data.invoice.state !== "open") return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [data, load]);

  return <div className="min-h-dvh bg-canvas print:bg-white">
    <div className="mx-auto max-w-lg px-5 py-6 sm:py-10">
      <div className="flex items-center justify-between print:hidden"><a href="/"><Logo className="text-lg" /></a>
        {data && <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>}</div>
      {data === undefined && !err && <div className="flex justify-center py-24 text-ink-400"><Spinner className="size-6" /></div>}
      {err && <div className="mt-8 space-y-3"><Alert tone="amber">{err}</Alert><Button variant="secondary" onClick={() => void load()}>Try again</Button></div>}
      {data === null && <div className="py-24 text-center"><p className="text-2xl font-bold">Receipt not found</p></div>}
      {data && <ReceiptCard r={data} />}
    </div>
  </div>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 py-2.5 text-sm"><dt className="text-ink-500">{k}</dt><dd className="min-w-0 text-right font-semibold text-ink-900">{children}</dd></div>;
}

function ReceiptCard({ r }: { r: Receipt }) {
  const { invoice: inv, payment: p, merchant: m } = r;
  const paid = inv.state !== "open";
  const payTx = p?.txHash ?? inv.payTx;
  return <article className="animate-rise mt-6 overflow-hidden rounded-[2rem] bg-white shadow-card ring-1 ring-ink-900/5 print:shadow-none" data-testid="receipt">
    <div className={`px-6 pb-6 pt-7 ${paid ? "bg-brand-600 text-white" : "bg-amber-50 text-amber-950"}`}>
      <p className="text-sm font-semibold opacity-80">{paid ? "Payment receipt" : "Invoice (awaiting payment)"}</p>
      <p className="tabular mt-2 text-5xl font-extrabold tracking-tight">{money(inv.amountUsdt)} <span className="text-xl opacity-70">USDT</span></p>
      <p className="tabular mt-1 text-sm opacity-80">{inr(inv.amountUsdt)} indicative</p>
    </div>
    <dl className="divide-y divide-ink-900/5 px-6 py-2">
      <Row k="Status"><StateBadge state={inv.state} /></Row>
      <Row k="Paid to">{m?.handle ? `@${m.handle}` : <a className="font-mono" href={explorerAddressUrl(inv.merchant)} target="_blank" rel="noreferrer">{short(inv.merchant)}</a>}</Row>
      {inv.memo && <Row k="For">{inv.memo}</Row>}
      {p && <Row k="Paid on">{dateTimeStr(p.paidAt)}</Row>}
      {p && <Row k="Paid from"><span className="font-mono">{short(p.payer)}</span></Row>}
      {p && <Row k="Network fee for payer">{p.gasless ? "None (sponsored)" : "Paid by payer"}</Row>}
      <Row k="Due date">{dateStr(inv.dueAt)}</Row>
      <Row k="Invoice ID"><span className="font-mono text-xs" title={inv.invoiceId}>{short(inv.invoiceId, 8)}</span></Row>
      {payTx && <Row k="Payment"><TxLink hash={payTx} label="View on explorer" /></Row>}
      {p?.refundTx && <Row k="Refund"><TxLink hash={p.refundTx} label="View refund" /></Row>}
    </dl>
    <div className="space-y-3 border-t border-ink-900/5 px-6 py-5">
      {inv.swarmRef ? <a href={swarmUrl(inv.swarmRef)} target="_blank" rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-2xl bg-ink-900 py-3 text-sm font-semibold text-white hover:bg-ink-800 print:hidden">
        <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        Open PDF on Swarm</a>
        : <p className="text-center text-xs text-ink-400">PDF copy not published to Swarm yet. <a className="underline print:hidden" href={pdfPreviewUrl(inv.invoiceId)} target="_blank" rel="noreferrer">Preview PDF</a></p>}
      <p className="text-center text-xs text-ink-400">Settled in USDT on Whitechain. This receipt is read live from the invoice record stored on Arkiv.</p>
    </div>
  </article>;
}
