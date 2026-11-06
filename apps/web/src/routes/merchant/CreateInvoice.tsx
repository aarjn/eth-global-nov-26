import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Address, Invoice } from "@paisalink/shared";
import { Alert, Button, Card, Field, inputCls } from "../../components/ui";
import { api, friendlyError } from "../../lib/api";
import { payLink } from "../../lib/config";
import { inr, money } from "../../lib/format";
import { CopyButton } from "./CopyButton";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function CreateInvoice({ wallet, disabled, onCreated }: { wallet: Address; disabled?: boolean; onCreated: (inv: Invoice) => void }) {
  const [amount, setAmount] = useState("49");
  const [memo, setMemo] = useState("");
  const [due, setDue] = useState(() => isoDate(new Date(Date.now() + 7 * 86400e3)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Invoice | null>(null);

  const validAmount = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0;
  const memoBytes = new TextEncoder().encode(memo).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // Due at the end of the chosen day (local time).
      const dueAt = Math.floor(new Date(`${due}T23:59:59`).getTime() / 1000);
      const inv = await api.post<Invoice>("/invoices", { merchant: wallet, amountUsdt: amount, dueAt, memo });
      setCreated(inv);
      onCreated(inv);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (created) {
    const link = payLink(created.invoiceId);
    return <Card className="animate-rise p-5 sm:p-6">
      <div className="flex items-center gap-2 text-sm font-bold text-brand-700">
        <span className="flex size-6 items-center justify-center rounded-full bg-brand-100"><svg className="size-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        Payment link ready
      </div>
      <p className="tabular mt-3 text-4xl font-extrabold tracking-tight">{money(created.amountUsdt)} <span className="text-lg text-ink-400">USDT</span></p>
      {created.memo && <p className="mt-1 text-sm text-ink-600">{created.memo}</p>}
      <div className="mt-5 flex justify-center rounded-2xl bg-ink-50 p-4"><QRCodeSVG value={link} size={168} level="M" bgColor="transparent" fgColor="#111627" /></div>
      <p className="mt-2 text-center text-xs text-ink-500">Your client scans this or opens the link on their phone</p>
      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-ink-50 p-2 pl-3 ring-1 ring-ink-900/10">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700" data-testid="pay-link">{link}</span>
        <CopyButton text={link} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={link} target="_blank" rel="noreferrer" className="rounded-2xl bg-gradient-to-b from-brand-500 to-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-brand hover:bg-brand-700">Open link</a>
        <Button variant="secondary" onClick={() => setCreated(null)}>New invoice</Button>
      </div>
    </Card>;
  }

  return <Card className="p-5 sm:p-6">
    <h2 className="text-lg font-bold">New invoice</h2>
    <p className="text-sm text-ink-500">Creates a payment link you can send on WhatsApp or email.</p>
    <form onSubmit={submit} className="mt-5 space-y-4">
      <Field label="Amount" hint={validAmount ? `${inr(amount)} at an indicative rate` : "Enter an amount, up to 6 decimals"}>
        <div className="relative">
          <input className={`${inputCls} tabular pr-20 text-2xl font-bold`} inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in USDT" />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-400">USDT</span>
        </div>
      </Field>
      <Field label="What is it for?" hint={`${memoBytes}/128 · visible to your client and on the public receipt; no personal data please`}>
        <input className={inputCls} value={memo} maxLength={128} onChange={(e) => setMemo(e.target.value)} placeholder="Logo design, 2 revisions" />
      </Field>
      <Field label="Due date">
        <input type="date" className={inputCls} value={due} min={isoDate(new Date())} onChange={(e) => setDue(e.target.value)} />
      </Field>
      {err && <Alert>{err}</Alert>}
      <Button shimmer type="submit" className="w-full py-3.5 text-base" loading={busy} disabled={disabled || !validAmount || memoBytes > 128 || !due}>
        {busy ? "Creating link…" : "Create payment link"}
      </Button>
      {disabled && <p className="text-center text-xs text-ink-500">Set up your handle first.</p>}
    </form>
  </Card>;
}
