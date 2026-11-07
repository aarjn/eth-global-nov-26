import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { invoicePaymentNonce } from "@paisalink/shared";
import { buildReceiveAuthTypedData, whitechainTestnet, type Address, type Eip3009Authorization, type Hex, type Invoice, type Merchant, type RelayResponse } from "@paisalink/shared";
import { Alert, Button, DemoWalletTag, Logo, Spinner, cx } from "../../components/ui";
import { api, ApiError, friendlyError } from "../../lib/api";
import { usdtBalance, parseUsdt, formatUsdt } from "../../lib/chain";
import { explorerTxUrl, getRouterAddress, receiptLink } from "../../lib/config";
import { dateStr, inr, money } from "../../lib/format";
import { getLocalAccount } from "../../lib/wallet";
import { selfPay, type SelfPayStep } from "../../lib/selfPay";
import { motion } from "motion/react";
import { Avatar } from "../../components/magicui/avatar";
import { celebrate } from "../../components/magicui/confetti";

type Phase = "idle" | "funding" | "approving" | "sending" | "selfpay" | "paid";
type Payer = { kind: "demo"; address: Address } | { kind: "injected"; address: Address };

const eth = () => (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
const isEmbed = () => new URLSearchParams(location.search).get("embed") === "1";
const post = (msg: Record<string, unknown>) => { if (window.parent !== window) window.parent.postMessage({ source: "paisalink", ...msg }, "*"); };

/** GET /invoices/:id adds these fields to the Invoice entity for the pay page. */
type PayInvoice = Invoice & { merchantHandle?: string | null; gaslessAvailable?: boolean; paymentRouter?: Address | null };

export default function PayPage({ params }: { params: Record<string, string> }) {
  const invoiceId = params.id as Hex;
  const embed = isEmbed();
  const demo = useMemo(() => getLocalAccount("payer"), []);
  const [payer, setPayer] = useState<Payer>({ kind: "demo", address: demo.address });
  const [invoice, setInvoice] = useState<PayInvoice | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<RelayResponse | null>(null);
  /** undefined = checking, null = contracts not deployed / not configured yet */
  const [router, setRouter] = useState<Address | null | undefined>(undefined);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [selfStep, setSelfStep] = useState<SelfPayStep | null>(null);
  const [selfPaid, setSelfPaid] = useState(false);

  const loadInvoice = useCallback(async () => {
    try {
      const inv = await api.get<PayInvoice>(`/invoices/${invoiceId}`);
      setInvoice(inv); setLoadErr(null);
      return inv;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setInvoice(null);
      else setLoadErr(friendlyError(e));
      return undefined;
    }
  }, [invoiceId]);

  useEffect(() => { void loadInvoice(); }, [loadInvoice]);
  useEffect(() => {
    if (!invoice?.merchant) return;
    api.get<Merchant>(`/merchants/${invoice.merchant}`).then(setMerchant).catch(() => setMerchant(null));
  }, [invoice?.merchant]);

  useEffect(() => {
    if (!invoice) return;
    if (invoice.paymentRouter) { setRouter(invoice.paymentRouter); return; }
    getRouterAddress().then(setRouter).catch(() => setRouter(null));
  }, [invoice]);

  const refreshBalance = useCallback(async () => {
    try { const b = await usdtBalance(payer.address); setBalance(b); return b; } catch { return null; }
  }, [payer.address]);
  // Retry until the first balance read succeeds: a slow or failed RPC call must not leave the page stuck on "…".
  useEffect(() => {
    setBalance(null);
    let stop = false;
    const tick = async () => { if (!stop && (await refreshBalance()) === null) setTimeout(tick, 3000); };
    void tick();
    return () => { stop = true; };
  }, [refreshBalance]);

  // Someone else may pay the same link (or the relay confirmed): keep the invoice fresh.
  useEffect(() => {
    if (phase === "paid" || invoice === null) return;
    const t = setInterval(() => void loadInvoice(), 6000);
    return () => clearInterval(t);
  }, [phase, invoice, loadInvoice]);

  const amount = invoice ? parseUsdt(invoice.amountUsdt) : 0n;
  const enough = balance !== null && balance >= amount;
  const payable = invoice && (invoice.state === "open" || invoice.state === "financed");
  const offline = router === null;

  const getTestUsdt = async () => {
    setErr(null); setPhase("funding");
    try {
      // ask only for what this invoice needs (the faucet caps it at DEMO_FUND_USDT): test USDT is scarce
      await api.post("/demo/fund", { address: payer.address, amountUsdt: invoice?.amountUsdt });
      setNotice("Test USDT is on its way to your wallet…");
      for (let i = 0; i < 30; i++) {
        const b = await refreshBalance();
        if (b !== null && b >= amount) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      setNotice(null);
    } catch (e) { setErr(friendlyError(e)); setNotice(null); }
    finally { setPhase("idle"); }
  };

  const pay = async () => {
    if (!invoice) return;
    setErr(null); setPhase("approving");
    try {
      const to = router ?? (await getRouterAddress());
      // The nonce is bound to this invoice (PaymentRouter.paymentNonce), so the approval can only pay this invoice.
      const auth: Eip3009Authorization = {
        from: payer.address, to, value: amount.toString(), validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 9 * 60, nonce: invoicePaymentNonce(to, invoice.invoiceId),
      };
      const typed = buildReceiveAuthTypedData(auth);
      let signature: Hex;
      if (payer.kind === "demo") signature = await demo.signTypedData(typed);
      else {
        const provider = eth();
        if (!provider) throw new Error("No wallet found in this browser.");
        const wc = createWalletClient({ chain: whitechainTestnet, transport: custom(provider) });
        try { await wc.switchChain({ id: whitechainTestnet.id }); } catch { await wc.addChain({ chain: whitechainTestnet }); }
        signature = await wc.signTypedData({ account: payer.address, ...typed });
      }
      setPhase("sending");
      const res = await api.post<RelayResponse>("/relay", { invoiceId: invoice.invoiceId, authorization: auth, signature });
      setResult(res); setPhase("paid");
      post({ type: "paid", invoiceId, txHash: res.txHash, explorerUrl: res.explorerUrl || explorerTxUrl(res.txHash), receiptUrl: receiptLink(invoiceId) });
      void refreshBalance();
    } catch (e) {
      setErr(friendlyError(e)); setErrCode(e instanceof ApiError ? e.code ?? null : null); setPhase("idle");
    }
  };

  /** Fallback when sponsored checkout is unavailable: the payer's own wallet calls PaymentRouter.pay() and pays the fee. */
  const paySelf = async () => {
    if (!invoice) return;
    setErr(null); setPhase("selfpay");
    try {
      const to = router ?? (await getRouterAddress());
      const r = await selfPay({ router: to, invoiceId: invoice.invoiceId, amount, onStep: setSelfStep });
      // Ask the API to mirror the on-chain payment into Arkiv (optional endpoint; the payment is final either way).
      void api.post(`/invoices/${invoice.invoiceId}/sync`, { txHash: r.txHash }).catch(() => {});
      const res = { txHash: r.txHash, explorerUrl: explorerTxUrl(r.txHash) };
      setResult(res); setSelfPaid(true); setPhase("paid");
      post({ type: "paid", invoiceId, txHash: res.txHash, explorerUrl: res.explorerUrl, receiptUrl: receiptLink(invoiceId) });
    } catch (e) {
      setErr(friendlyError(e)); setPhase("idle");
    } finally { setSelfStep(null); }
  };

  const pickInjected = async () => {
    const provider = eth();
    if (!provider) return;
    try {
      const wc = createWalletClient({ chain: whitechainTestnet, transport: custom(provider) });
      const [address] = await wc.requestAddresses();
      if (address) setPayer({ kind: "injected", address });
    } catch (e) { setErr(friendlyError(e)); }
  };

  const handleName = merchant?.handle ?? invoice?.merchantHandle ?? null;
  const handle = handleName ? `@${handleName}` : "the merchant";
  const busy = phase === "approving" || phase === "sending" || phase === "funding" || phase === "selfpay";
  const offerSelfPay = invoice?.gaslessAvailable === false || errCode === "MERCHANT_NOT_VERIFIED";
  const selfLabel = { connecting: "Connecting your wallet…", approving: "Approve USDT in your wallet…", paying: "Confirm the payment in your wallet…", confirming: "Confirming…" };

  return <div className={cx("flex min-h-dvh flex-col overflow-x-clip bg-warm", embed && "min-h-[100dvh]")}>
    {!embed && <header className="mx-auto flex w-full max-w-md items-center justify-between px-5 pt-5"><Logo className="text-lg" /><span className="flex items-center gap-1 text-xs font-semibold text-ink-500">
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M8 11V8a4 4 0 118 0v3" stroke="currentColor" strokeWidth="2" /></svg>Secure checkout</span></header>}

    <main className={cx("mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6", embed ? "pt-14" : "pt-6")}>
      {invoice === undefined && !loadErr && <div className="flex flex-1 items-center justify-center text-ink-400"><Spinner className="size-6" /></div>}
      {loadErr && invoice === undefined && <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <Alert tone="amber">{loadErr}</Alert><Button variant="secondary" onClick={() => void loadInvoice()}>Try again</Button></div>}
      {invoice === null && <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-2xl font-bold">Payment link not found</p>
        <p className="mt-2 text-ink-500">Check the link with the person who sent it.</p></div>}

      {invoice && phase === "paid" && result && <Success invoice={invoice} handle={handle} result={result} embed={embed} selfPaid={selfPaid} />}

      {invoice && phase !== "paid" && <>
        <section className="animate-rise rounded-[2rem] bg-white p-6 shadow-card ring-1 ring-ink-900/5">
          <div className="flex items-center gap-3">
            <Avatar name={handleName ?? "P"} />
            <div className="min-w-0">
              <p className="truncate font-bold text-ink-900">{handleName ? `@${handleName}` : "Payment request"}</p>
              <p className="flex items-center gap-1 text-xs text-ink-500">{merchant?.verified && <svg className="size-3.5 text-brand-600" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" fill="currentColor" opacity=".18" /><path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}{merchant?.verified ? "Verified business" : "requests a payment"}</p>
            </div>
          </div>
          <p className="mt-6 text-sm font-semibold text-ink-500">{payable ? "Amount due" : "Amount"}</p>
          <p className="tabular mt-1 text-6xl font-extrabold leading-none tracking-tight text-ink-900" data-testid="amount">{money(invoice.amountUsdt)}<span className="ml-2 text-2xl font-bold text-ink-400">USDT</span></p>
          <p className="tabular mt-2 text-sm text-ink-500">{inr(invoice.amountUsdt)} · 1 USDT = 1 US dollar</p>
          {invoice.memo && <p className="mt-5 rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-700">{invoice.memo}</p>}
          <div className="mt-4 flex justify-between text-sm"><span className="text-ink-500">Due</span><span className="font-semibold">{dateStr(invoice.dueAt)}</span></div>
          <div className="mt-1 flex justify-between text-sm"><span className="text-ink-500">Fees for you</span>{offerSelfPay ? <span className="font-semibold text-amber-700">Small network fee</span> : <span className="font-semibold text-brand-700">None</span>}</div>
        </section>

        {payable && invoice.gaslessAvailable === false && <div className="mt-4"><Alert tone="amber">
          Free checkout isn't switched on for this merchant yet (they haven't finished verification), so PaisaLink can't cover the network fee.
          You can pay from your own wallet below and pay the small fee yourself.
        </Alert></div>}

        {!payable && <div className="animate-rise mt-5 flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3.5 text-sm text-brand-900 ring-1 ring-brand-200" role="status">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-brand" aria-hidden="true">
            <svg className="size-5" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span>This invoice is already {invoice.state === "paid" ? "paid" : invoice.state}. All sorted! <a className="font-semibold underline" href={`/r/${invoiceId}`}>View receipt</a></span>
        </div>}

        {payable && offline && <div className="mt-auto pt-6"><Alert tone="amber">
          Payments are switched off for a moment while PaisaLink finishes setting up. Please keep this link and try again shortly.
        </Alert><Button variant="secondary" className="mt-3 w-full" onClick={() => void loadInvoice()}>Check again</Button></div>}

        {payable && !offline && <div className="mt-auto pt-6">
          {err && <div className="mb-3"><Alert>{err}</Alert></div>}
          {notice && <div className="mb-3"><Alert tone="brand">{notice}</Alert></div>}

          {balance !== null && !enough && phase !== "funding" ? <>
            <Button className="w-full py-4 text-lg" onClick={getTestUsdt}>Get test USDT</Button>
            <p className="mt-2 text-center text-xs text-ink-500">Your wallet is empty. This sends free <b>testnet</b> USDT to it.</p>
          </> : <Button shimmer className="w-full py-4 text-lg" onClick={pay} loading={busy} disabled={balance === null || busy || router === undefined} data-testid="pay-button">
            {phase === "funding" ? "Adding test USDT…" : phase === "approving" ? "Approving…" : phase === "sending" ? "Sending payment…" : `Pay ${money(invoice.amountUsdt)} USDT`}
          </Button>}

          {offerSelfPay && <div className="mt-3">
            <Button variant="secondary" className="w-full py-3.5" onClick={paySelf} loading={phase === "selfpay"} disabled={busy || !eth()} data-testid="self-pay-button">
              {phase === "selfpay" && selfStep ? selfLabel[selfStep] : "Pay with my own wallet (I pay the network fee)"}
            </Button>
            <p className="mt-1.5 text-center text-xs text-ink-500">{eth() ? "Uses your browser wallet: one approval, one payment. Needs a little WBT for the fee." : "Needs a browser wallet such as MetaMask."}</p>
          </div>}

          <div className="mt-4 flex flex-col items-center gap-2 text-center">
            {payer.kind === "demo" ? <DemoWalletTag address={payer.address} role="payer" /> :
              <span className="text-xs font-semibold text-ink-600">Paying from your wallet · {payer.address.slice(0, 6)}…{payer.address.slice(-4)}</span>}
            <span className="tabular text-xs text-ink-500">Balance: {balance === null ? "…" : `${money(formatUsdt(balance))} USDT`}</span>
            {payer.kind === "demo" && eth() && <button type="button" onClick={pickInjected} className="text-xs font-semibold text-brand-700 underline">Use my own wallet instead</button>}
            {payer.kind === "injected" && <button type="button" onClick={() => setPayer({ kind: "demo", address: demo.address })} className="text-xs font-semibold text-brand-700 underline">Use the browser wallet</button>}
          </div>
        </div>}
      </>}
    </main>
  </div>;
}

function Success({ invoice, handle, result, embed, selfPaid }: { invoice: Invoice; handle: string; result: RelayResponse; embed: boolean; selfPaid: boolean }) {
  const explorer = result.explorerUrl || explorerTxUrl(result.txHash);
  useEffect(() => { celebrate(); }, []);
  return <div className="flex flex-1 flex-col items-center pt-8 text-center" data-testid="paid">
    <span className="relative flex size-24 items-center justify-center">
      <span aria-hidden="true" className="animate-halo absolute inset-0 rounded-full bg-brand-400" />
      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 16 }}
        className="relative flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
        <svg className="size-12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.45, ease: "easeOut" }} />
        </svg>
      </motion.span>
    </span>
    <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Paid. Thank you! 🙏</h1>
    <p className="tabular mt-2 text-lg text-ink-700"><b>{money(invoice.amountUsdt)} USDT</b> to {handle}</p>
    <p className="mt-1 text-sm font-medium text-brand-700">Money's on its way. {handle === "the merchant" ? "They" : handle} will see it land in seconds.</p>
    {invoice.memo && <p className="mt-1 text-sm text-ink-500">{invoice.memo}</p>}
    <div className="mt-8 w-full space-y-3">
      <a href={`/r/${invoice.invoiceId}`} target={embed ? "_blank" : undefined} rel="noreferrer"
        className="block w-full rounded-2xl bg-gradient-to-b from-brand-500 to-brand-700 py-4 text-lg font-semibold text-white shadow-brand hover:from-brand-600 hover:to-brand-800">View receipt</a>
      <a href={explorer} target="_blank" rel="noreferrer" className="block w-full rounded-2xl bg-white py-3.5 font-semibold text-ink-800 ring-1 ring-ink-900/10 hover:bg-ink-50">Public payment record</a>
      {embed && <button type="button" onClick={() => post({ type: "close" })} className="w-full py-2 text-sm font-semibold text-ink-500">Done</button>}
    </div>
    <p className="mt-6 text-xs text-ink-400">{selfPaid ? "Paid from your own wallet; you covered the network fee." : "No fees were charged to you."}</p>
  </div>;
}
