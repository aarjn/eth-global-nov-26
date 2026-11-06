// /invest: invoice financing (Whitechain Tokenize). Investor view with a browser-local TESTNET DEMO investor wallet,
// plus the merchant's "Sell this invoice" entry at /invest?invoice=0x.. . Notes are read from Arkiv through the API
// (GET /notes) and shown with the live InvoiceNote state; investor actions are sent from the investor's own wallet.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "@paisalink/shared";
import { Shell } from "../../components/Shell";
import { Alert, Badge, Button, Card, DemoWalletTag, TxLink } from "../../components/ui";
import { api, ApiError, friendlyError } from "../../lib/api";
import { formatUsdt, usdtBalance } from "../../lib/chain";
import { useQuery } from "../../lib/router";
import { useTick } from "../../lib/hooks";
import { getLocalAccount } from "../../lib/wallet";
import { money } from "../../lib/format";
import { explorerAddressUrl } from "../../lib/config";
import { formatEther } from "viem";
import { getNoteAddress, isAllowed, wbtBalance, type NoteRow, type NotesList } from "./lib";
import { NoteCard } from "./NoteCard";
import { SellInvoice } from "./SellInvoice";

interface DeskResp { allowed: boolean; allowlistTx: Hex | null; gasTx: Hex | null; label: string }

export default function InvestPage() {
  const investor = useMemo(() => getLocalAccount("investor"), []);
  const q = useQuery();
  const sellId = q.get("invoice");
  const sellInvoice = sellId && /^0x[0-9a-fA-F]{64}$/.test(sellId) ? (sellId.toLowerCase() as Hex) : null;
  useTick(1000);

  const [note, setNote] = useState<Address | null | undefined>(undefined);
  const [list, setList] = useState<NoteRow[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0); // chain time - local time, seconds
  const [me, setMe] = useState<{ allowed: boolean | null; wbt: bigint | null; usdt: bigint | null }>({ allowed: null, wbt: null, usdt: null });
  const [setup, setSetup] = useState<{ busy: boolean; err?: string; txs: { label: string; hash: string }[] }>({ busy: false, txs: [] });

  useEffect(() => { void getNoteAddress().then((a) => setNote(a)); }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<NotesList>("/notes");
      setList(r.notes);
      if (r.chainTime) setOffset(r.chainTime - Math.floor(Date.now() / 1000));
      if (r.noteContract) setNote((n) => n ?? r.noteContract);
      setListErr(null);
    } catch (e) { setListErr(friendlyError(e)); }
  }, []);

  const refreshMe = useCallback(async () => {
    const a = investor.address;
    const [allowed, wbt, usdt] = await Promise.all([
      note ? isAllowed(note, a).catch(() => null) : Promise.resolve(null),
      wbtBalance(a).catch(() => null),
      usdtBalance(a).catch(() => null),
    ]);
    setMe({ allowed, wbt, usdt });
  }, [investor.address, note]);

  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { void refreshMe(); const t = setInterval(refreshMe, 10000); return () => clearInterval(t); }, [refreshMe]);

  async function setupInvestor() {
    setSetup({ busy: true, txs: [] });
    const txs: { label: string; hash: string }[] = [];
    try {
      const d = await api.post<DeskResp>("/notes/demo-investor", { address: investor.address });
      if (d.allowlistTx) txs.push({ label: "Allowlisted by the demo compliance desk", hash: d.allowlistTx });
      if (d.gasTx) txs.push({ label: "Test WBT for gas", hash: d.gasTx });
      try {
        const f = await api.post<{ txHash: Hex; amountUsdt: string }>("/demo/fund", { address: investor.address });
        txs.push({ label: `${f.amountUsdt} test USDT`, hash: f.txHash });
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "DEMO_FAUCET_LIMIT")) throw e; // already has test USDT: fine
      }
      setSetup({ busy: false, txs });
    } catch (e) {
      setSetup({ busy: false, txs, err: friendlyError(e) });
    }
    void refreshMe();
  }

  const nowSec = Math.floor(Date.now() / 1000) + offset;
  const existing = sellInvoice ? list?.find((n) => n.invoiceId.toLowerCase() === sellInvoice) : undefined;
  const ordered = useMemo(() => {
    if (!list) return [];
    // the note being sold first, then open/funded, then settled
    const rank = (n: NoteRow) => (sellInvoice && n.invoiceId.toLowerCase() === sellInvoice ? 0 : (n.onchain?.state ?? n.state) === "settled" ? 2 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || b.noteId - a.noteId);
  }, [list, sellInvoice]);
  const ready = me.allowed && (me.wbt ?? 0n) > 0n;

  return <Shell>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink-500">Invoice financing</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Buy invoices, get paid in USDT at maturity</h1>
        <p className="mt-2 max-w-2xl text-ink-600">Merchants sell unpaid invoices at a small discount and get cash today. Approved investors buy them as on-chain notes.
          The customer's payment goes into escrow, and at maturity the holder receives the full face value in USDT.</p>
      </div>
    </div>

    {note === null && <div className="mt-4"><Alert tone="amber"><b>Invoice financing is not switched on yet.</b> The InvoiceNote contract is not deployed on the testnet, so notes cannot be listed or bought until it is.</Alert></div>}

    {sellInvoice && <div className="mt-6"><SellInvoice invoiceId={sellInvoice} existing={existing}
      onIssued={(n) => { setList((l) => [n, ...(l ?? []).filter((x) => x.noteId !== n.noteId)]); setTimeout(() => void refresh(), 1500); }} /></div>}

    {/* investor wallet */}
    <Card className="mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DemoWalletTag address={investor.address} role="investor" />
          {me.allowed === true && <Badge tone="brand">On the investor allowlist</Badge>}
          {me.allowed === false && <Badge tone="rose">Not allowlisted</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span><span className="text-ink-400">USDT</span> <b className="tabular-nums">{me.usdt === null ? "…" : money(formatUsdt(me.usdt))}</b></span>
          <span><span className="text-ink-400">WBT (gas)</span> <b className="tabular-nums">{me.wbt === null ? "…" : Number(formatEther(me.wbt)).toFixed(4)}</b></span>
          {note && !ready && <Button onClick={setupInvestor} loading={setup.busy}>Set up demo investor</Button>}
        </div>
      </div>
      {note && !ready && <p className="mt-3 text-xs text-ink-500">Testnet demo only: the PaisaLink compliance desk allowlists this browser wallet, sends a little test WBT for gas, and the demo faucet sends test USDT.
        In production the compliance officer (the contract owner) allowlists investors after KYC. No real value.</p>}
      {setup.err && <div className="mt-3"><Alert>{setup.err}</Alert></div>}
      {setup.txs.length > 0 && <ul className="mt-3 space-y-1">{setup.txs.map((t) => <li key={t.hash} className="flex items-center gap-2 text-sm"><span className="text-ink-500">{t.label}</span><TxLink hash={t.hash} label="explorer" /></li>)}</ul>}
    </Card>

    {/* notes */}
    <div className="mt-8 flex items-baseline justify-between">
      <h2 className="text-xl font-extrabold tracking-tight">Notes</h2>
      <span className="text-xs text-ink-400">Read from Arkiv · live state from Whitechain</span>
    </div>
    {listErr && list === null && <div className="mt-3"><Alert tone="amber">{listErr}</Alert></div>}
    {list && list.length === 0 && <Card className="mt-3 p-6 text-center text-ink-500">No invoices for sale yet. A merchant can sell one from the dashboard ("Sell this invoice").</Card>}
    <div className="mt-3 space-y-4">
      {note && ordered.map((n) => <NoteCard key={n.noteId} row={n} note={note} investor={investor} nowSec={nowSec}
        investorAllowed={me.allowed} investorWbt={me.wbt} onChanged={() => { void refresh(); void refreshMe(); }} />)}
    </div>

    <Card className="mt-8 p-5 sm:p-6">
      <h3 className="font-bold">How the rules are enforced</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
        <li>Only the invoice's merchant can list it, once, for at most the invoice amount (merchant signs; the relayer pays gas).</li>
        <li>Only allowlisted investors can buy. The price goes straight to the merchant in USDT.</li>
        <li>When the customer pays, the payment router forwards the USDT into the note's escrow; the merchant cannot refund or withdraw it.</li>
        <li>Notes move only between allowlisted wallets and only before maturity. After maturity, transfers revert.</li>
        <li>On or after maturity anyone can settle: the holder receives exactly the face value in USDT.</li>
      </ol>
      {note && <p className="mt-3 text-xs text-ink-500">Contract: <a className="font-mono underline" href={explorerAddressUrl(note)} target="_blank" rel="noreferrer">{note}</a></p>}
    </Card>
  </Shell>;
}
