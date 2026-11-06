// Merchant entry from the dashboard: /invest?invoice=0x.. -> "Sell this invoice". The merchant signs an EIP-712
// Issue message with its browser-local testnet demo merchant wallet; the PaisaLink relayer submits issueWithSig and
// pays the gas, so the merchant needs no WBT.
import { useEffect, useMemo, useState } from "react";
import type { Hex, Invoice } from "@paisalink/shared";
import { Alert, Button, Card, DemoWalletTag, Field, StateBadge, TxLink, inputCls } from "../../components/ui";
import { api, friendlyError } from "../../lib/api";
import { getLocalAccount } from "../../lib/wallet";
import { signTyped, type TypedDataJson } from "../../lib/sign";
import { money } from "../../lib/format";
import { discount, type NoteRow } from "./lib";

const MATURITIES = [
  { sec: 120, label: "2 minutes (demo)" },
  { sec: 30 * 86400, label: "30 days" },
  { sec: 60 * 86400, label: "60 days" },
  { sec: 90 * 86400, label: "90 days" },
];

type InvoiceView = Invoice & { merchantHandle?: string | null };
interface TypedResp { typedData: TypedDataJson; faceUsdt: string; priceUsdt: string; discountPct: number; maturity: string; deadline: string }
interface IssueResp { note: NoteRow; txHash: Hex; explorerUrl: string; storeWarning?: string }

/** 97.5% of face, rounded down to a cent (same default as the API). */
const defaultPrice = (face: string) => {
  const f = Number(face);
  return Number.isFinite(f) && f > 0 ? String(Math.floor(f * 97.5) / 100) : "";
};

export function SellInvoice({ invoiceId, existing, onIssued }: { invoiceId: Hex; existing: NoteRow | undefined; onIssued: (n: NoteRow) => void }) {
  const merchant = useMemo(() => getLocalAccount("merchant"), []);
  const [inv, setInv] = useState<InvoiceView | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [face, setFace] = useState("");
  const [price, setPrice] = useState("");
  const [maturitySec, setMaturitySec] = useState(120);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<IssueResp | null>(null);

  useEffect(() => {
    let stop = false;
    api.get<InvoiceView>(`/invoices/${invoiceId}`)
      .then((i) => { if (stop) return; setInv(i); setFace(i.amountUsdt); setPrice(defaultPrice(i.amountUsdt)); })
      .catch((e) => { if (!stop) { setInv(null); setLoadErr(friendlyError(e)); } });
    return () => { stop = true; };
  }, [invoiceId]);

  const d = discount(face, price);
  const mine = !!inv && inv.merchant.toLowerCase() === merchant.address.toLowerCase();
  const maturityLabel = MATURITIES.find((m) => m.sec === maturitySec)?.label ?? `${maturitySec}s`;

  async function sell() {
    setErr(null); setBusy("Preparing the sale…");
    try {
      const q = new URLSearchParams({ faceUsdt: face, priceUsdt: price, maturitySec: String(maturitySec) });
      const td = await api.get<TypedResp>(`/invoices/${invoiceId}/note-typed-data?${q}`);
      if (td.typedData.primaryType !== "Issue") throw new Error("Unexpected request from the server.");
      setBusy("Signing with your merchant wallet…");
      const signature = await signTyped(merchant, td.typedData);
      setBusy("Listing the invoice on chain…");
      const r = await api.post<IssueResp>("/notes/issue", {
        invoiceId, faceUsdt: td.faceUsdt, priceUsdt: td.priceUsdt,
        maturity: String(td.typedData.message.maturity), deadline: String(td.typedData.message.deadline), signature,
      });
      setDone(r);
      onIssued({ ...r.note, onchain: null });
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(null); }
  }

  return <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-violet-700">Sell this invoice</p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight">Get cash today instead of waiting</h2>
      </div>
      <DemoWalletTag address={merchant.address} role="merchant" />
    </div>

    {inv === undefined && <p className="mt-4 text-sm text-ink-500">Loading the invoice…</p>}
    {inv === null && <div className="mt-4"><Alert>{loadErr ?? "Invoice not found."}</Alert></div>}

    {inv && <>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3 text-sm">
        <span className="font-semibold">Invoice {money(inv.amountUsdt)} USDT</span>
        {inv.memo && <span className="text-ink-500">· {inv.memo}</span>}
        <StateBadge state={inv.state} />
      </div>

      {existing ? <div className="mt-4"><Alert tone="brand">This invoice is already listed as note #{existing.noteId} ({existing.state}). See it below.</Alert></div>
        : done ? <div className="mt-4 space-y-2">
          <Alert tone="brand"><b>Listed as note #{done.note.noteId}.</b> An approved investor can buy it now; you receive {money(done.note.priceUsdt)} USDT the moment they do.
            The PaisaLink relayer paid the gas.</Alert>
          <TxLink hash={done.txHash} label="View the listing transaction" />
          {done.storeWarning && <p className="text-xs text-amber-700">Saved on chain; the Arkiv record will catch up ({done.storeWarning}).</p>}
        </div>
        : !mine ? <div className="mt-4"><Alert tone="amber">Only the merchant wallet that created this invoice can sell it. Open this page in the browser that holds that merchant's demo wallet.</Alert></div>
        : inv.state !== "open" ? <div className="mt-4"><Alert tone="amber">Only unpaid (open) invoices can be sold. This one is {inv.state}.</Alert></div>
        : <>
          <p className="mt-4 text-base font-semibold text-ink-900" data-testid="sell-summary">
            Sell this invoice: face ${money(face || "0")}, price ${money(price || "0")}, maturity {maturityLabel}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Face value (USDT)" hint="Paid to the investor at maturity">
              <input className={inputCls} inputMode="decimal" value={face} onChange={(e) => { setFace(e.target.value); setPrice(defaultPrice(e.target.value)); }} />
            </Field>
            <Field label="Price (USDT)" hint={d.pct > 0 ? `${d.pct}% discount · investor earns ${money(d.profit)} USDT` : "What you receive today"}>
              <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Maturity">
              <select className={inputCls} value={maturitySec} onChange={(e) => setMaturitySec(Number(e.target.value))}>
                {MATURITIES.map((m) => <option key={m.sec} value={m.sec}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={sell} loading={!!busy} disabled={!face || !price}>{busy ?? `Sell for ${money(price || "0")} USDT`}</Button>
            <span className="text-xs text-ink-500">You sign a message; no gas needed. Rules (allowlist, maturity, USDT settlement) are enforced by the InvoiceNote contract.</span>
          </div>
          {err && <div className="mt-3"><Alert>{err}</Alert></div>}
        </>}
    </>}
  </Card>;
}
