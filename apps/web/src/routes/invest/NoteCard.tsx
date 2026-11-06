import { useCallback, useEffect, useState } from "react";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address } from "@paisalink/shared";
import { Alert, Badge, Button, Card, TxLink, cx, inputCls } from "../../components/ui";
import { api, friendlyError } from "../../lib/api";
import { parseUsdt } from "../../lib/chain";
import { explorerAddressUrl } from "../../lib/config";
import { dateTimeStr, money, short } from "../../lib/format";
import { Link } from "../../lib/router";
import {
  DEMO_PAYER, TxReverted, countdown, discount, forceCall, fundNote, revertLabel, settleNote, strangerAddress, syncNote,
  transferNote, tryCall, type NoteDetail, type NoteRow, type Revert, type SentTx,
} from "./lib";

const stateTone = { issued: "amber", funded: "brand", settled: "ink" } as const;
const stateLabel = { issued: "For sale", funded: "Funded · awaiting maturity", settled: "Settled in USDT" } as const;

type Proof = { title: string; from: Address; fn: "fund" | "transfer" | "settle"; args: readonly unknown[]; result?: { ok: true } | { ok: false; revert: Revert }; forced?: SentTx; canForce: boolean };

export function NoteCard({ row, note, investor, nowSec, investorAllowed, investorWbt, onChanged }: {
  row: NoteRow; note: Address; investor: PrivateKeyAccount; nowSec: number;
  investorAllowed: boolean | null; investorWbt: bigint | null; onChanged: () => void;
}) {
  const c = row.onchain;
  // The chain is the source of truth for actions; the Arkiv mirror is what the list reads.
  const state = c?.state ?? row.state;
  const holder = (c?.holder ?? row.investor ?? null) as Address | null;
  const maturity = c?.maturity ?? row.maturity;
  const left = maturity - nowSec;
  const matured = left <= 0;
  const iHold = !!holder && holder.toLowerCase() === investor.address.toLowerCase();
  const d = discount(row.faceUsdt, row.priceUsdt);

  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ msg: string; revert?: Revert } | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]);
  const [to, setTo] = useState<string>(DEMO_PAYER);
  const [proof, setProof] = useState<Proof | null>(null);

  const loadDetail = useCallback(() => api.get<NoteDetail>(`/notes/${row.noteId}`).then(setDetail).catch(() => {}), [row.noteId]);
  useEffect(() => { void loadDetail(); }, [loadDetail, state, holder, c?.escrowUsdt]);

  async function run(label: string, fn: () => Promise<{ label: string; hash: string }[]>) {
    setErr(null); setBusy(label);
    try {
      const out = await fn();
      setTxs((t) => [...t, ...out]);
      await syncNote(row.noteId); // mirror the new chain state into Arkiv
      onChanged();
      void loadDetail();
    } catch (e) {
      if (e instanceof TxReverted) setErr({ msg: e.revert.text, revert: e.revert });
      else setErr({ msg: friendlyError(e) });
    } finally { setBusy(null); }
  }

  const fund = () => run("Buying…", async () => {
    const r = await fundNote(investor, note, row.noteId, parseUsdt(row.priceUsdt), setBusy);
    return [...(r.approve ? [{ label: "USDT approval", hash: r.approve.hash }] : []), { label: "Funded the note", hash: r.fund.hash }];
  });
  const transfer = () => run("Transferring…", async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Enter a wallet address (0x…).");
    const r = await transferNote(investor, note, row.noteId, to as Address);
    return [{ label: `Transferred to ${short(to)}`, hash: r.hash }];
  });
  const settle = () => run("Settling…", async () => [{ label: "Settled in USDT", hash: (await settleNote(investor, note, row.noteId)).hash }]);

  async function prove(p: Omit<Proof, "result">) {
    setProof({ ...p });
    const result = await tryCall(note, p.from, p.fn, p.args);
    setProof({ ...p, result });
  }
  async function recordProof() {
    if (!proof) return;
    setBusy("Recording the attempt on chain…");
    try { const forced = await forceCall(investor, note, proof.fn, proof.args); setProof({ ...proof, forced }); }
    catch (e) { setErr({ msg: friendlyError(e) }); }
    finally { setBusy(null); }
  }

  const escrowShort = c ? !c.escrowFull : true;
  const hasGas = investorWbt !== null && investorWbt > 0n;

  return <Card className="p-5 transition-shadow duration-300 hover:shadow-lg sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink-500">Note #{row.noteId}</span>
          <Badge tone={stateTone[state]}>{stateLabel[state]}</Badge>
          {detail && !detail.inSync && <Badge tone="amber">Arkiv record catching up</Badge>}
        </div>
        <p className="mt-2 text-2xl font-extrabold tracking-tight">{money(row.faceUsdt)} USDT <span className="text-base font-semibold text-ink-500">face value</span></p>
        <p className="mt-1 text-sm text-ink-600">Price {money(row.priceUsdt)} USDT · <b>{d.pct}% discount</b> · investor earns {money(d.profit)} USDT</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Maturity</p>
        <p className={cx("text-2xl font-extrabold tabular-nums", matured ? "text-ink-500" : "text-violet-700")} data-testid="countdown">{countdown(left)}</p>
        <p className="text-xs text-ink-500">{dateTimeStr(maturity)}</p>
      </div>
    </div>

    <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div><dt className="text-ink-400">Issuer (merchant)</dt><dd><a className="font-mono hover:underline" href={explorerAddressUrl(row.issuer)} target="_blank" rel="noreferrer">{short(row.issuer)}</a></dd></div>
      <div><dt className="text-ink-400">Holder</dt><dd>{holder ? <a className="font-mono hover:underline" href={explorerAddressUrl(holder)} target="_blank" rel="noreferrer">{short(holder)}{iHold ? " (you)" : ""}</a> : "nobody yet"}</dd></div>
      <div><dt className="text-ink-400">Escrow for settlement</dt><dd>{c ? `${money(c.escrowUsdt)} / ${money(c.faceUsdt)} USDT` : "…"}</dd></div>
    </dl>

    {/* ---- actions ---- */}
    <div className="mt-5 flex flex-wrap items-center gap-2">
      {state === "issued" && !matured && <Button onClick={fund} loading={busy?.startsWith("Buy") || busy?.startsWith("Approv")} disabled={!!busy || investorAllowed === false || !hasGas}>
        Fund for {money(row.priceUsdt)} USDT</Button>}
      {state === "funded" && iHold && !matured && <>
        <input className={cx(inputCls, "max-w-xs py-2 font-mono text-xs")} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Transfer to address" />
        <Button variant="secondary" onClick={transfer} loading={busy === "Transferring…"} disabled={!!busy || !hasGas}>Transfer</Button>
      </>}
      {state === "funded" && matured && <Button onClick={settle} loading={busy === "Settling…"} disabled={!!busy || escrowShort || !hasGas}>Settle: pay {money(row.faceUsdt)} USDT to the holder</Button>}
    </div>
    {state === "issued" && investorAllowed === false && <p className="mt-2 text-xs text-amber-700">Your demo investor wallet is not allowlisted yet. Use "Set up demo investor" above.</p>}
    {state === "funded" && iHold && !matured && to.toLowerCase() === DEMO_PAYER.toLowerCase() && <p className="mt-2 text-xs text-ink-500">Default target: the PaisaLink demo payer wallet, allowlisted at deploy.</p>}
    {state === "funded" && escrowShort && <p className="mt-2 text-sm text-ink-600">
      Waiting for the customer to pay the invoice: the payment goes straight into this note's escrow.{" "}
      <Link className="font-semibold text-brand-700 hover:underline" href={`/pay/${row.invoiceId}`}>Open the payment link</Link>.
      If it is still unpaid at maturity, the merchant tops the escrow up with <code>repay()</code> (recourse).</p>}
    {busy && <p className="mt-2 text-sm text-ink-500">{busy}</p>}
    {err && <div className="mt-3"><Alert>{err.revert ? <><b>Refused by the contract: {revertLabel(err.revert)}.</b> {err.msg}</> : err.msg}</Alert></div>}
    {txs.length > 0 && <ul className="mt-3 space-y-1">{txs.map((t) => <li key={t.hash} className="flex items-center gap-2 text-sm"><span className="text-ink-500">{t.label}</span><TxLink hash={t.hash} label="explorer" /></li>)}</ul>}

    {/* ---- the rules, proven against the deployed contract ---- */}
    {state !== "settled" && <div className="mt-5 rounded-2xl bg-ink-50 p-4">
      <p className="text-sm font-semibold text-ink-800">Rules enforced on chain: try to break them</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {state === "issued" && <Button variant="danger" onClick={() => prove({ title: "Fund from a non-allowlisted wallet", from: strangerAddress(), fn: "fund", args: [BigInt(row.noteId)], canForce: false })}>
          Try to fund from a non-allowlisted wallet</Button>}
        {state === "funded" && holder && !matured && <Button variant="danger" onClick={() => prove({ title: "Transfer to a non-allowlisted wallet", from: holder, fn: "transfer", args: [BigInt(row.noteId), strangerAddress()], canForce: iHold })}>
          Try a transfer to a non-allowlisted wallet</Button>}
        {state === "funded" && holder && !matured && <Button variant="danger" onClick={() => prove({ title: "Settle before maturity", from: holder, fn: "settle", args: [BigInt(row.noteId)], canForce: iHold })}>
          Try to settle early</Button>}
        {state === "funded" && holder && <Button variant="danger" disabled={!matured}
          onClick={() => prove({ title: "Transfer after maturity", from: holder, fn: "transfer", args: [BigInt(row.noteId), DEMO_PAYER], canForce: iHold })}>
          Try a transfer after maturity{!matured ? ` (unlocks in ${countdown(left)})` : ""}</Button>}
      </div>
      {proof && <div className="mt-3 rounded-xl bg-white p-3 text-sm ring-1 ring-ink-900/10" role="status">
        <p className="font-semibold">{proof.title}</p>
        {!proof.result ? <p className="text-ink-500">Asking the contract…</p>
          : proof.result.ok ? <p className="text-amber-800">The contract would accept this call right now.</p>
          : <>
            <p className="mt-1 font-mono text-rose-700" data-testid="revert">Reverted: {revertLabel(proof.result.revert)}</p>
            <p className="text-ink-700">{proof.result.revert.text}</p>
            <p className="mt-1 text-xs text-ink-500">Checked with eth_call as {short(proof.from)} against InvoiceNote <a className="underline" href={explorerAddressUrl(note)} target="_blank" rel="noreferrer">{short(note)}</a> on Whitechain testnet. No gas spent.</p>
            {proof.canForce && !proof.forced && hasGas && <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={recordProof} disabled={!!busy}>Record this failed attempt on chain (costs a little test WBT)</Button>}
            {proof.forced && <p className="mt-2 text-sm">Mined with status <b>{proof.forced.status}</b>. <TxLink hash={proof.forced.hash} label="See the failed tx" /></p>}
          </>}
      </div>}
    </div>}

    {/* ---- lifecycle from chain events ---- */}
    {detail?.events && detail.events.length > 0 && <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Lifecycle (from contract events)</p>
      <ol className="mt-2 space-y-1">{detail.events.map((e) => <li key={`${e.txHash}-${e.name}`} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{EVENT_LABEL[e.name] ?? e.name}</span><TxLink hash={e.txHash} label="tx" />
      </li>)}</ol>
    </div>}
  </Card>;
}

const EVENT_LABEL: Record<string, string> = {
  NoteIssued: "Issued by the merchant",
  NoteFunded: "Bought by an allowlisted investor (USDT to the merchant)",
  NoteEscrowFunded: "Customer payment held in escrow",
  NoteTransferred: "Transferred to another allowlisted investor",
  NoteSettled: "Settled: face value paid in USDT",
};
