import { useEffect, useMemo, useRef, useState } from "react";
import type { Invoice, Merchant } from "@paisalink/shared";
import { Shell } from "../../components/Shell";
import { Alert, Badge, Button, Card, DemoWalletTag, Field, inputCls } from "../../components/ui";
import { api, friendlyError } from "../../lib/api";
import { useInvoices, useMerchant, useNotedInvoices, useServiceStatus, useTick } from "../../lib/hooks";
import { getLocalAccount } from "../../lib/wallet";
import { ago, inr, money } from "../../lib/format";
import { Link } from "../../lib/router";
import { CreateInvoice } from "./CreateInvoice";
import { InvoiceList } from "./InvoiceList";

export default function MerchantPage() {
  const account = useMemo(() => getLocalAccount("merchant"), []);
  const wallet = account.address;
  const { merchant, error: merchantError, setMerchant, refresh: refreshMerchant } = useMerchant(wallet);
  const { noted, refresh: refreshNotes } = useNotedInvoices(wallet);
  // Any server event (payment, refund, note, World ID verification) also refreshes the profile and notes,
  // so the verified badge and the financed markers flip without waiting for a poll.
  const { invoices, syncedAt, error, live, refresh, setInvoices } = useInvoices(wallet, { onEvent: () => { void refreshMerchant(); void refreshNotes(); } });
  const service = useServiceStatus();
  const [toast, setToast] = useState<string | null>(null);
  const prev = useRef<Map<string, string>>(new Map());
  useTick(1000);

  // Toast when an invoice flips to paid (the "it landed" moment).
  useEffect(() => {
    if (!invoices) return;
    const before = prev.current;
    if (before.size) {
      for (const inv of invoices) {
        const was = before.get(inv.invoiceId);
        if (was === "open" && inv.state === "paid") {
          setToast(`Payment received: ${money(inv.amountUsdt)} USDT${inv.memo ? ` · ${inv.memo}` : ""}`);
          setTimeout(() => setToast(null), 6000);
        }
      }
    }
    prev.current = new Map(invoices.map((i) => [i.invoiceId, i.state]));
  }, [invoices]);

  const stats = useMemo(() => {
    const list = invoices ?? [];
    const sum = (f: (i: Invoice) => boolean) => list.filter(f).reduce((a, i) => a + Number(i.amountUsdt), 0);
    return {
      collected: sum((i) => i.state === "paid" || i.state === "settled"),
      awaiting: sum((i) => i.state === "open"),
      count: list.length,
    };
  }, [invoices]);

  const onCreated = (inv: Invoice) => {
    setInvoices((cur) => [inv, ...(cur ?? []).filter((i) => i.invoiceId !== inv.invoiceId)]);
    setTimeout(() => void refresh(), 2500);
  };

  return <Shell>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink-500">Merchant dashboard</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{merchant?.handle ? `@${merchant.handle}` : "Your business"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DemoWalletTag address={wallet} role="merchant" />
          <VerificationBadge merchant={merchant} wallet={wallet} />
          {merchant && (merchant as Merchant & { arkivUrl?: string }).arkivUrl && <a href={(merchant as Merchant & { arkivUrl?: string }).arkivUrl} target="_blank" rel="noreferrer"
            className="text-xs font-semibold text-ink-500 underline hover:text-ink-800">Profile record on Arkiv</a>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SyncPill live={live} syncedAt={syncedAt} error={error} />
        <a href={api.url(`/merchants/${wallet}/export.csv`)} download={`paisalink-${wallet.slice(0, 8)}.csv`}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-900 ring-1 ring-ink-900/10 hover:bg-ink-50">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Export CSV
        </a>
      </div>
    </div>

    {merchantError && merchant === undefined && <div className="mt-4"><Alert tone="amber">{merchantError} Your profile will load when the connection is back.</Alert></div>}
    {service && !service.router && <div className="mt-4"><Alert tone="amber">
      <b>Payments are not switched on yet.</b> The PaisaLink payment contract is not deployed on the testnet, so new invoices and payments will be refused until it is.
    </Alert></div>}
    {merchant === null && <div className="mt-6"><SetupCard wallet={wallet} onDone={setMerchant} /></div>}
    {merchant && !merchant.verified && <div className="mt-6"><Alert tone="amber">
      <b>Gas-sponsored checkout locked: verification not completed.</b> Your clients can still pay, but free checkout turns on after a one-time
      human check. <Link className="font-semibold underline" href={`/onboard?wallet=${wallet}`}>Verify now</Link>
    </Alert></div>}

    <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
      <Stat label="Collected" value={stats.collected} />
      <Stat label="Awaiting" value={stats.awaiting} />
      <Stat label="Invoices" value={stats.count} plain />
    </div>

    <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <CreateInvoice wallet={wallet} disabled={merchant === null} onCreated={onCreated} />
      </div>
      <InvoiceList invoices={invoices} account={account} noted={noted} onChanged={refresh} />
    </div>

    {toast && <div className="animate-rise fixed inset-x-4 bottom-6 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3.5 text-sm font-semibold text-white shadow-2xl">
      <span className="flex size-7 items-center justify-center rounded-full bg-brand-500"><svg className="size-4" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      {toast}
    </div>}
  </Shell>;
}

function Stat({ label, value, plain }: { label: string; value: number; plain?: boolean }) {
  return <Card className="min-w-0 p-3.5 sm:p-5">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 sm:text-xs">{label}</p>
    <p className="tabular mt-1 text-xl font-extrabold tracking-tight sm:text-3xl">{money(value)}{!plain && <span className="block text-xs font-bold text-ink-400 sm:ml-1 sm:inline sm:text-sm">USDT</span>}</p>
    {!plain && <p className="tabular hidden text-xs text-ink-400 sm:block">{inr(value)}</p>}
  </Card>;
}

function SyncPill({ live, syncedAt, error }: { live: boolean; syncedAt: number | null; error: string | null }) {
  const stale = !!error;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${stale ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-white text-ink-600 ring-ink-900/10"}`}
    title={error ?? "Invoices are read from Arkiv through the PaisaLink API"}>
    <span className={`size-2 rounded-full ${stale ? "bg-amber-500" : "bg-brand-500 animate-pulse"}`} />
    {stale ? `Offline · synced ${syncedAt ? ago(syncedAt) : "never"}` : `${live ? "Live" : "Synced"} · ${syncedAt ? ago(syncedAt) : "…"}`}
  </span>;
}

function VerificationBadge({ merchant, wallet }: { merchant: Merchant | null | undefined; wallet: string }) {
  if (!merchant) return null;
  if (merchant.verified) return <Badge tone="brand">
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" fill="currentColor" opacity=".18" /><path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    Verified human · free checkout on</Badge>;
  return <Link href={`/onboard?wallet=${wallet}`}><Badge tone="amber">Not verified · verify to unlock free checkout →</Badge></Link>;
}

function SetupCard({ wallet, onDone }: { wallet: string; onDone: (m: Merchant) => void }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[a-z0-9._-]{3,32}$/.test(handle);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onDone(await api.post<Merchant>("/merchants", { wallet, handle })); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return <Card className="p-5 sm:p-6">
    <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <h2 className="text-lg font-bold">Set up your business</h2>
        <p className="mb-3 text-sm text-ink-500">Pick a public handle your clients will see on payment links. No name or email needed.</p>
        <Field label="Handle" hint="3–32 characters: a–z, 0–9, dot, dash, underscore">
          <div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400">@</span>
            <input className={`${inputCls} pl-8`} value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="priya.designs" autoComplete="off" /></div>
        </Field>
      </div>
      <Button type="submit" loading={busy} disabled={!valid} className="sm:mb-6">Create profile</Button>
    </form>
    {err && <div className="mt-3"><Alert>{err}</Alert></div>}
  </Card>;
}
