import { useState } from "react";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Invoice } from "@paisalink/shared";
import { Alert, Button, Card, Spinner, StateBadge, TxLink, inputCls } from "../../components/ui";
import { friendlyError } from "../../lib/api";
import { payLink } from "../../lib/config";
import { dateStr, money, short } from "../../lib/format";
import { Link } from "../../lib/router";
import { refundInvoice, type RefundResult } from "../../lib/sign";
import { pdfPreviewUrl, publishInvoicePdf } from "../../lib/swarm";
import { swarmUrl } from "../../lib/config";
import { CopyButton } from "./CopyButton";

export function InvoiceList({ invoices, account, noted, onChanged }: { invoices: Invoice[] | null; account: PrivateKeyAccount; noted?: Set<string>; onChanged: () => void }) {
  return <Card className="overflow-hidden">
    <div className="flex items-center justify-between border-b border-ink-900/5 px-5 py-4">
      <h2 className="text-lg font-bold">Invoices</h2>
      {invoices && <span className="text-sm text-ink-500">{invoices.length} total</span>}
    </div>
    {invoices === null && <div className="flex items-center justify-center gap-2 py-16 text-ink-400"><Spinner /> Loading invoices…</div>}
    {invoices?.length === 0 && <div className="px-6 py-16 text-center">
      <p className="text-lg font-bold">No invoices yet</p>
      <p className="mt-1 text-sm text-ink-500">Create your first payment link. It shows up here, and turns green the moment it's paid.</p>
    </div>}
    <ul className="divide-y divide-ink-900/5">
      {invoices?.map((inv) => <InvoiceRow key={inv.invoiceId} inv={inv} account={account} financed={inv.state === "financed" || !!noted?.has(inv.invoiceId.toLowerCase())} onChanged={onChanged} />)}
    </ul>
  </Card>;
}

function InvoiceRow({ inv, account, financed, onChanged }: { inv: Invoice; account: PrivateKeyAccount; financed: boolean; onChanged: () => void }) {
  const [refundOpen, setRefundOpen] = useState(false);
  const overdue = inv.state === "open" && inv.dueAt * 1000 < Date.now();
  return <li className={`px-5 py-4 transition-colors ${inv.state === "paid" ? "bg-brand-50/40" : ""}`} data-testid="invoice-row" data-state={inv.state}>
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular text-xl font-extrabold tracking-tight">{money(inv.amountUsdt)} <span className="text-sm font-bold text-ink-400">USDT</span></span>
          <StateBadge state={inv.state} />
          {overdue && <span className="text-xs font-semibold text-rose-600">Overdue</span>}
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-700">{inv.memo || <span className="text-ink-400">No description</span>}</p>
        <p className="mt-0.5 text-xs text-ink-400">Due {dateStr(inv.dueAt)} · <span className="font-mono">{short(inv.invoiceId, 6)}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {inv.state === "open" && <>
          <CopyButton text={payLink(inv.invoiceId)} label="Copy link" />
          {!financed && <Link href={`/invest?invoice=${inv.invoiceId}`} className="rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100">Sell this invoice</Link>}
        </>}
        {inv.state !== "open" && <Link href={`/r/${inv.invoiceId}`} className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 ring-1 ring-ink-900/10 hover:bg-ink-50">Receipt</Link>}
        {inv.state === "paid" && !financed && !refundOpen && <button type="button" onClick={() => setRefundOpen(true)}
          className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">Refund</button>}
      </div>
    </div>
    {financed && (inv.state === "paid" || inv.state === "financed") && <p className="mt-2 text-xs font-medium text-violet-800">
      Financed: {inv.state === "paid" ? "the payment is in escrow for the investor" : "funds will be held in escrow for the investor when the client pays"}, so it can't be refunded here.{" "}
      <Link href={`/invest?invoice=${inv.invoiceId}`} className="underline">View note</Link>
    </p>}
    <SwarmPdf inv={inv} onPublished={onChanged} />
    {(inv.payTx || (inv as Invoice & { arkivUrl?: string }).arkivUrl) && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {inv.payTx && <TxLink hash={inv.payTx} label="Payment transaction" />}
      {(inv as Invoice & { arkivUrl?: string }).arkivUrl && <a href={(inv as Invoice & { arkivUrl?: string }).arkivUrl} target="_blank" rel="noreferrer"
        className="text-sm font-semibold text-ink-500 hover:text-ink-800 hover:underline">Arkiv record</a>}
    </div>}
    {refundOpen && <RefundPanel inv={inv} account={account} onClose={() => setRefundOpen(false)} onDone={onChanged} />}
  </li>;
}

function RefundPanel({ inv, account, onClose, onDone }: { inv: Invoice; account: PrivateKeyAccount; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(inv.amountUsdt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RefundResult | null>(null);
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(inv.amountUsdt);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      setResult(await refundInvoice(account, inv.invoiceId, amount));
      onDone();
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (result) return <div className="animate-rise mt-3"><Alert tone="brand">
    Refunded <b>{money(amount)} USDT</b> to the client. <TxLink hash={result.txHash} label="Refund transaction" />
  </Alert></div>;

  return <div className="animate-rise mt-3 rounded-2xl bg-ink-50 p-4 ring-1 ring-ink-900/5">
    <p className="text-sm font-semibold">Refund to the client</p>
    <p className="text-xs text-ink-500">Full or partial. You sign once; PaisaLink covers the network fee.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="relative w-40">
        <input className={`${inputCls} tabular bg-white py-2 pr-16 font-bold`} inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Refund amount" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-400">USDT</span>
      </div>
      <Button variant="danger" loading={busy} disabled={!valid} onClick={submit}>Refund {valid ? money(amount) : ""}</Button>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
    </div>
    {err && <div className="mt-3"><Alert>{err}</Alert></div>}
  </div>;
}

/** "Publish PDF to Swarm" -> spinner -> "Open PDF on Swarm". The API stores the reference on the Arkiv invoice entity. */
function SwarmPdf({ inv, onPublished }: { inv: Invoice; onPublished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const link = url ?? (inv.swarmRef ? swarmUrl(inv.swarmRef) : null);
  const publish = async () => {
    setBusy(true); setErr(null);
    try { setUrl((await publishInvoicePdf(inv.invoiceId, inv.swarmRef)).url); onPublished(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    {link ? <a href={link} target="_blank" rel="noreferrer" data-testid="swarm-link"
      className="inline-flex items-center gap-1 font-semibold text-ink-800 hover:underline">
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      Open PDF on Swarm</a>
      : <button type="button" onClick={publish} disabled={busy}
        className="inline-flex items-center gap-1.5 font-semibold text-ink-600 hover:text-ink-900 disabled:opacity-60">
        {busy ? <><Spinner className="size-3.5" /> Publishing PDF to Swarm…</> : "Publish PDF to Swarm"}
      </button>}
    {!link && !busy && <a href={pdfPreviewUrl(inv.invoiceId)} target="_blank" rel="noreferrer" className="text-xs text-ink-400 hover:underline">Preview</a>}
    {err && <span className="text-xs font-medium text-rose-700" role="alert">{err}</span>}
  </div>;
}
