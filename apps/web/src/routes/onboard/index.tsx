// /onboard?wallet=0x..  (W6) World ID Proof of Human gate for gas-sponsored checkout.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CredentialRequest, IDKitRequestWidget, proofOfHuman, type IDKitErrorCodes, type IDKitRequestHookConfig, type IDKitResult } from "@worldcoin/idkit";
import { getAddress, isAddress } from "viem";
import { Shell } from "../../components/Shell";
import { Alert, Badge, Button, Card, DemoWalletTag } from "../../components/ui";
import { useMerchant } from "../../lib/hooks";
import { Link, useQuery } from "../../lib/router";
import { getLocalAccount } from "../../lib/wallet";
import { short } from "../../lib/format";
import {
  LOCKED_TITLE, SIMULATOR_URL, VERIFIED_TITLE, WHY_ONE_LINER, codeOf, failureReason, worldApi,
  type WorldPublicConfig, type WorldRequest,
} from "./world";

type Phase = "idle" | "starting" | "open" | "verifying" | "success" | "failed";

export default function OnboardPage() {
  const q = useQuery();
  const demoWallet = useMemo(() => getLocalAccount("merchant").address, []);
  const raw = q.get("wallet");
  const wallet = raw && isAddress(raw) ? getAddress(raw) : demoWallet;
  const badWallet = !!raw && !isAddress(raw);
  const { merchant, error: merchantError, refresh } = useMerchant(wallet);

  const [cfg, setCfg] = useState<WorldPublicConfig | null | undefined>(undefined);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [req, setReq] = useState<WorldRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const [failCode, setFailCode] = useState<string | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const serverCode = useRef<string | null>(null);
  const serverMsg = useRef<string | null>(null);
  const lastResult = useRef<IDKitResult | null>(null);

  const loadConfig = useCallback(async () => {
    try { setCfg(await worldApi.config()); setCfgError(null); }
    catch (e) { setCfg(null); setCfgError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const fail = (code: string | null, msg?: string) => { setFailCode(code); setFailMsg(msg ?? null); setPhase("failed"); };

  const start = async () => {
    setFailCode(null); setFailMsg(null); serverCode.current = null; serverMsg.current = null; lastResult.current = null;
    setPhase("starting");
    try {
      setReq(await worldApi.request(wallet)); // fresh RP signature each attempt (valid 5 minutes)
      setPhase("open");
      setOpen(true);
    } catch (e) {
      fail(codeOf(e) ?? null, e instanceof Error ? e.message : String(e));
      if (codeOf(e) === "WORLD_NOT_CONFIGURED") void loadConfig();
    }
  };

  // Called by the widget with the proof; the server verifies it with World and flips `verified` on Arkiv.
  const handleVerify = async (result: IDKitResult) => {
    lastResult.current = result;
    setPhase("verifying");
    try {
      await worldApi.verify(wallet, result);
    } catch (e) {
      serverCode.current = codeOf(e) ?? "WORLD_VERIFICATION_FAILED";
      serverMsg.current = e instanceof Error ? e.message : String(e);
      throw e; // the widget shows its error screen; onError below records the reason
    }
  };

  const finishSaving = async () => {
    if (!lastResult.current) return start();
    setPhase("verifying");
    try { await worldApi.verify(wallet, lastResult.current); setPhase("success"); void refresh(); }
    catch (e) { fail(codeOf(e) ?? null, e instanceof Error ? e.message : String(e)); }
  };

  const onSuccess = () => { setPhase("success"); void refresh(); };
  const onError = (code: IDKitErrorCodes) => {
    const fromServer = code === "failed_by_host_app" && serverCode.current;
    fail(fromServer ? serverCode.current : code, fromServer ? serverMsg.current ?? undefined : undefined);
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o && (phaseRef.current === "open" || phaseRef.current === "starting")) fail("cancelled");
    if (!o && phaseRef.current === "verifying" && serverCode.current) fail(serverCode.current, serverMsg.current ?? undefined);
  };

  const widgetConfig: IDKitRequestHookConfig | null = req ? {
    app_id: req.app_id,
    action: req.action,
    rp_context: req.rp_context,
    environment: req.environment,
    allow_legacy_proofs: req.allow_legacy_proofs,
    // World ID 4.0 Proof of Human bound to this merchant wallet (signal). Legacy Orb fallback only if the server allows it.
    ...(req.allow_legacy_proofs
      ? { preset: proofOfHuman({ signal: req.signal }) }
      : { constraints: CredentialRequest("proof_of_human", { signal: req.signal }) }),
  } : null;

  const verified = merchant?.verified === true || phase === "success";
  const configured = cfg?.configured === true;
  const isDemo = wallet === demoWallet;

  return <Shell wide={false}>
    <p className="text-sm font-semibold text-ink-500">Merchant verification</p>
    <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Turn on free checkout for your customers</h1>
    <p className="mt-3 max-w-2xl text-base text-ink-600" data-testid="why">{WHY_ONE_LINER}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {isDemo ? <DemoWalletTag address={wallet} role="merchant" /> : <Badge>Merchant wallet · {short(wallet)}</Badge>}
      {merchant?.handle && <Badge>@{merchant.handle}</Badge>}
    </div>
    {badWallet && <div className="mt-4"><Alert tone="amber">The wallet in the link isn't a valid address, so this page uses your merchant wallet instead.</Alert></div>}

    <Card className="mt-6 p-5 sm:p-7">
      {verified ? <VerifiedPanel /> : <>
        {merchant === undefined && !merchantError && <p className="text-sm text-ink-500">Loading your merchant profile…</p>}
        {merchantError && merchant === undefined && <Alert tone="amber">Can't load your merchant profile right now ({merchantError}).</Alert>}
        {merchant === null && <Alert tone="amber">
          <b>Create your merchant profile first.</b> Pick a handle on the <Link className="font-semibold underline" href="/merchant">dashboard</Link>, then come back here to verify.
        </Alert>}

        {merchant && cfg === null && <Alert tone="amber">Can't reach PaisaLink to start World ID ({cfgError}). Gas-sponsored checkout stays locked for now.</Alert>}
        {merchant && cfg && !configured && <div data-testid="not-configured"><Alert tone="amber">
          <b>World ID isn't connected on this server yet.</b> The operator still has to add the World Developer Portal app
          {cfg.missing.length ? <> (missing: <code className="text-xs">{cfg.missing.join(", ")}</code>)</> : null}. Until then gas-sponsored checkout stays locked.
        </Alert><Fallback /></div>}

        {merchant && configured && phase !== "failed" && <div>
          <h2 className="text-lg font-bold">One check, once: prove you're a unique human</h2>
          <p className="mt-1 text-sm text-ink-600">World ID shows PaisaLink only that you are a real, unique person. No name, no photo, no document.</p>
          <Button className="mt-4 w-full py-3.5 text-base sm:w-auto" onClick={() => void start()} loading={phase === "starting" || phase === "verifying"} data-testid="verify-button">
            {phase === "verifying" ? "Checking your proof…" : "Verify with World ID"}
          </Button>
          {cfg?.environment === "staging" && <p className="mt-3 text-xs text-ink-500">
            Testnet: this uses World ID <b>staging</b>. Scan the QR code with the <a className="font-semibold underline" href={cfg.simulatorUrl ?? SIMULATOR_URL} target="_blank" rel="noreferrer">World ID simulator</a> (or use the simulator link inside the dialog).
          </p>}
        </div>}

        {merchant && phase === "failed" && <div data-testid="locked">
          <Alert tone="rose"><b>{LOCKED_TITLE}</b><br />{failureReason(failCode, failMsg ?? undefined)}</Alert>
          <div className="mt-4 flex flex-wrap gap-2">
            {failCode === "STORE_UNAVAILABLE" ? <Button onClick={() => void finishSaving()}>Finish saving</Button>
              : configured && failCode !== "NULLIFIER_REUSED" && <Button onClick={() => void start()}>Try again</Button>}
            <Link href="/merchant" className="inline-flex items-center rounded-2xl px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-900/5">Back to dashboard</Link>
          </div>
          <Fallback />
        </div>}
      </>}
    </Card>

    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-bold">Why Proof of Human, and nothing more</h3>
        <ul className="mt-2 space-y-2 text-sm text-ink-600">
          <li><b className="text-ink-800">The trust moment:</b> you are asking PaisaLink to spend real gas on your customers' payments.</li>
          <li><b className="text-ink-800">Proof of Human (Orb):</b> one person, one merchant account, one daily gas budget (0.02 WBT). That is all we need to know.</li>
          <li><b className="text-ink-800">Not device-level:</b> a phone check is cheap to repeat, so one person could open many accounts and drain the relayer.</li>
          <li><b className="text-ink-800">Not passport or selfie:</b> those reveal nationality, age or your face. Paying gas doesn't need any of that.</li>
        </ul>
      </Card>
      <Card className="p-5">
        <h3 className="font-bold">What gets stored</h3>
        <ul className="mt-2 space-y-2 text-sm text-ink-600">
          <li>Your merchant record on Arkiv gets one flag: <code className="text-xs">verified = 1</code>.</li>
          <li>World ID gives us an anonymous number (a nullifier) so the same person can't verify twice. We keep it on our server only, never on Arkiv.</li>
          <li>The proof is checked on our server with World, and is tied to this wallet so it can't be reused for another one.</li>
        </ul>
      </Card>
    </div>

    {widgetConfig && <IDKitRequestWidget {...widgetConfig} open={open} onOpenChange={onOpenChange}
      handleVerify={handleVerify} onSuccess={onSuccess} onError={onError} />}
  </Shell>;
}

function VerifiedPanel() {
  return <div data-testid="verified">
    <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 text-base font-bold text-brand-800 ring-1 ring-brand-200">
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" fill="currentColor" opacity=".18" /><path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {VERIFIED_TITLE}
    </span>
    <p className="mt-3 text-sm text-ink-600">Your customers can now pay your invoices without holding any gas token. PaisaLink's relayer pays the fee from your daily sponsored budget.</p>
    <Link href="/merchant" className="mt-4 inline-flex items-center rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Go to dashboard</Link>
  </div>;
}

function Fallback() {
  return <div className="mt-4 rounded-2xl bg-ink-50 p-4 text-sm text-ink-700" data-testid="fallback">
    <b>You can still get paid.</b> Without verification PaisaLink won't pay gas for your customers, but every invoice stays payable through the
    self-paid path: the customer calls <code className="text-xs">pay()</code> on the PaisaLink payment contract from their own wallet and pays the small network fee
    themselves (about 0.0001 WBT). Invoices, refunds and the accountant export work the same.
  </div>;
}
