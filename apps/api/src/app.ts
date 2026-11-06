import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { formatEther, formatUnits } from "viem";
import { USDT_DECIMALS, type Address, type PaisaStore } from "@paisalink/shared";
import type { ApiConfig } from "./config";
import type { FaucetChain, RouterChain } from "./chain";
import { ApiError } from "./errors";
import { Relayer, parseAddress, parseBytes32 } from "./relayer";
import { DemoFaucet, DEMO_LABEL } from "./demo";
import { buildExportCsv } from "./csv";
import { jsonSafe } from "./typed";
import { mountPlugins, type PluginContext } from "./plugins";

export interface AppDeps {
  config: ApiConfig;
  store: PaisaStore;
  chain?: RouterChain;
  faucet?: FaucetChain;
  /** Read-only RPC probe for /health when the router is not configured yet. */
  probe?: { rpcChainId(): Promise<number>; balance(a: Address): Promise<bigint>; relayerAddress?: Address };
  /** Directory scanned for plugin files (defaults to src/). Tests pass a dir without plugins. */
  pluginDir?: string | false;
  now?: () => number;
}

const VERSION = "0.1.0";

/** Client IP: Bun's socket address; X-Forwarded-For only when TRUST_PROXY=1 (behind our own proxy). */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  const server = c.env as { requestIP?: (r: Request) => { address: string } | null } | undefined;
  try { return server?.requestIP?.(c.req.raw)?.address ?? "unknown"; } catch { return "unknown"; }
}

async function json(c: Context): Promise<unknown> {
  try { return await c.req.json(); } catch { throw new ApiError("BAD_REQUEST", "body must be JSON"); }
}

export async function createApp(d: AppDeps) {
  const { config, store } = d;
  const relayer = new Relayer({ store, chain: d.chain, config, now: d.now });
  const faucet = new DemoFaucet(d.faucet, config, d.now);
  const app = new Hono();
  const ip = (c: Context) => clientIp(c, config.trustProxy);

  app.use("*", cors({ origin: config.corsOrigins === "*" ? "*" : config.corsOrigins, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"], exposeHeaders: ["Content-Disposition"], maxAge: 600 }));
  app.use("*", bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "body too large", code: "BAD_REQUEST" }, 413) }));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err.code === "RATE_LIMITED" && typeof err.extra.retryAfterSec === "number") c.header("Retry-After", String(err.extra.retryAfterSec));
      return c.json(err.toJSON(), err.status as 400);
    }
    // Arkiv (W4) errors: rate limit or node unavailable.
    if (err?.name === "ArkivRateLimitedError") return c.json({ error: "Arkiv is rate limiting us; try again shortly", code: "ARKIV_RATE_LIMITED" }, 429);
    if (/arkiv/i.test(err?.name ?? "")) return c.json({ error: `Arkiv unavailable: ${err.message.split("\n")[0]}`, code: "ARKIV_UNAVAILABLE" }, 503);
    console.error("[api] unhandled", err);
    return c.json({ error: "internal error", code: "INTERNAL" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found", code: "NOT_FOUND" }, 404));

  app.get("/", (c) => c.json({ service: "paisalink-api", version: VERSION, health: "/health" }));

  // Public config for the web app (no secrets).
  app.get("/config", (c) => c.json({
    chainId: config.chainId, explorerUrl: config.explorerUrl, arkivChainId: config.arkivChainId,
    usdt: config.usdt, paymentRouter: d.chain?.routerAddress ?? config.paymentRouter ?? null, invoiceNote: config.invoiceNote ?? null,
    relayer: d.chain?.relayerAddress ?? null, gasless: relayer.hasChain, demoFaucet: faucet.enabled ? { amountUsdt: config.demo.amountUsdt, label: DEMO_LABEL } : null,
    authWindowSec: config.limits.maxAuthWindowSec,
  }));

  app.get("/health", async (c) => {
    const safe = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { error: (e as Error).message.split("\n")[0] }; } };
    const ch = d.chain;
    const relayerAddress = ch?.relayerAddress ?? d.probe?.relayerAddress;
    const storeHealth = (store as { health?: () => Promise<unknown> }).health;
    const [rpcChainId, relayerWei, faucetUsdt, arkiv] = await Promise.all([
      ch ? safe(() => ch.rpcChainId()) : d.probe ? safe(() => d.probe!.rpcChainId()) : null,
      ch ? safe(() => ch.relayerBalance()) : d.probe && relayerAddress ? safe(() => d.probe!.balance(relayerAddress)) : null,
      d.faucet ? safe(() => d.faucet!.usdtBalance(d.faucet!.address)) : null,
      storeHealth ? safe(() => storeHealth.call(store)) : null,
    ]);
    const relayerBalanceWbt = typeof relayerWei === "bigint" ? formatEther(relayerWei) : relayerWei;
    return c.json({
      ok: !!ch && typeof relayerWei === "bigint" && rpcChainId === config.chainId,
      service: "paisalink-api", version: VERSION, time: new Date().toISOString(),
      chains: { whitechain: { expected: config.chainId, rpc: rpcChainId }, arkiv: { chainId: config.arkivChainId } },
      arkiv: jsonSafe(arkiv),
      contracts: { usdt: config.usdt, paymentRouter: ch?.routerAddress ?? config.paymentRouter ?? null, invoiceNote: config.invoiceNote ?? null },
      relayer: ch ? { address: ch.relayerAddress, balanceWbt: relayerBalanceWbt, queueDepth: ch.queueDepth() }
        : { address: relayerAddress ?? null, balanceWbt: relayerBalanceWbt, error: "gasless relay off: PaymentRouter not deployed/configured or RELAYER_PRIVATE_KEY missing" },
      budget: {
        perMerchantDailyWbt: formatEther(config.limits.merchantDailyGasWei),
        merchantsToday: relayer.budget.snapshot(),
        rateLimits: { payerPerHour: config.limits.payerPerHour, ipPerHour: config.limits.ipPerHour, globalPerHour: config.limits.globalPerHour, globalRemaining: relayer.limits.global.remaining("global") },
      },
      stats: relayer.stats,
      demoFaucet: faucet.enabled ? { label: DEMO_LABEL, address: d.faucet!.address, balanceUsdt: typeof faucetUsdt === "bigint" ? formatUnits(faucetUsdt, USDT_DECIMALS) : faucetUsdt, grants: faucet.grants } : null,
      plugins: mounted,
    });
  });

  // ---- invoices ----
  app.post("/invoices", async (c) => c.json(await relayer.createInvoice(await json(c), ip(c)), 201));

  app.get("/invoices/:id", async (c) => {
    const id = parseBytes32(c.req.param("id"), "invoice id");
    const inv = await store.getInvoice(id);
    if (!inv) throw new ApiError("INVOICE_NOT_FOUND", "invoice not found");
    const [m, payment] = await Promise.all([store.getMerchant(inv.merchant), inv.state === "open" ? null : store.getPayment(id)]);
    // Extra fields beyond Invoice for the pay page and receipt page.
    return c.json({ ...inv, merchantHandle: m?.handle ?? null, gaslessAvailable: !!m?.verified && relayer.hasChain, payment: payment ?? null, paymentRouter: d.chain?.routerAddress ?? null });
  });

  // Public receipt (/r/:id): everything read from Arkiv.
  app.get("/invoices/:id/receipt", async (c) => {
    const id = parseBytes32(c.req.param("id"), "invoice id");
    const invoice = await store.getInvoice(id);
    if (!invoice) throw new ApiError("INVOICE_NOT_FOUND", "invoice not found");
    const [merchant, payment] = await Promise.all([store.getMerchant(invoice.merchant), store.getPayment(id)]);
    return c.json({
      invoice, payment: payment ?? null, merchant: merchant ?? null,
      links: {
        payTx: payment?.txHash ? relayer.txUrl(payment.txHash) : invoice.payTx ? relayer.txUrl(invoice.payTx) : null,
        refundTx: payment?.refundTx ? relayer.txUrl(payment.refundTx) : null,
      },
    });
  });

  // The browser signs exactly the returned typedData (BigInts as decimal strings), then POSTs { amountUsdt, deadline, signature }.
  app.get("/invoices/:id/refund-typed-data", async (c) => {
    const typedData = await relayer.refundTypedData(parseBytes32(c.req.param("id"), "invoice id"), c.req.query("amountUsdt"));
    // Both shapes: the typed data itself at top level (what apps/web signs) and { typedData, deadline } (handoffs item 4).
    return c.json(jsonSafe({ ...typedData, typedData, deadline: typedData.message.deadline, amount: typedData.message.amount }));
  });
  app.get("/invoices/:id/withdraw-typed-data", async (c) => {
    const typedData = await relayer.withdrawTypedData(parseBytes32(c.req.param("id"), "invoice id"));
    return c.json(jsonSafe({ ...typedData, typedData, deadline: typedData.message.deadline }));
  });
  app.post("/invoices/:id/refund", async (c) => c.json(await relayer.refund(parseBytes32(c.req.param("id"), "invoice id"), await json(c), ip(c))));
  app.post("/invoices/:id/withdraw", async (c) => c.json(await relayer.withdraw(parseBytes32(c.req.param("id"), "invoice id"), await json(c), ip(c))));

  // ---- relay ----
  app.post("/relay", async (c) => c.json(await relayer.relay(await json(c), ip(c))));

  // ---- merchant extras (W4 owns POST /merchants and GET /merchants/:wallet/invoices) ----
  app.get("/merchants/:wallet/export.csv", async (c) => {
    const wallet = parseAddress(c.req.param("wallet"), "wallet");
    const [invoices, payments] = await Promise.all([store.listInvoicesByMerchant(wallet), store.listPaymentsByMerchant(wallet)]);
    const csv = buildExportCsv(invoices, payments, config.explorerUrl);
    const day = new Date().toISOString().slice(0, 10);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paisalink-${wallet.slice(0, 8).toLowerCase()}-${day}.csv"`,
      "Cache-Control": "no-store",
    });
  });

  app.get("/merchants/:wallet/budget", (c) => c.json(relayer.budgetFor(parseAddress(c.req.param("wallet"), "wallet"))));

  // Live dashboard updates (Server-Sent Events): our own writes immediately, plus Arkiv entity events.
  app.get("/merchants/:wallet/events", (c) => {
    const wallet: Address = parseAddress(c.req.param("wallet"), "wallet");
    return streamSSE(c, async (stream) => {
      let id = 0;
      // Unnamed events so EventSource.onmessage fires: data {"kind":"invoice"|"payment"|"note","id":"0x.."}.
      const send = (kind: string, changedId: string, source: string) =>
        void stream.writeSSE({ id: String(++id), data: JSON.stringify({ kind, id: changedId, source }) }).catch(() => {});
      const offLocal = relayer.onChange((m, kind, invoiceId) => { if (m.toLowerCase() === wallet.toLowerCase()) send(kind, invoiceId, "api"); });
      let offArkiv: () => void = () => {};
      try { offArkiv = store.watchMerchant(wallet, (kind, invId) => send(kind, invId, "arkiv")); } catch (e) { console.warn("[sse] watchMerchant failed:", (e as Error).message); }
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ merchant: wallet }) });
      const stop = new Promise<void>((resolve) => stream.onAbort(() => resolve()));
      while (!stream.aborted) {
        await Promise.race([stream.sleep(15_000), stop]);
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {});
      }
      offLocal(); offArkiv();
    });
  });

  // ---- testnet demo faucet ----
  app.post("/demo/fund", async (c) => c.json(await faucet.fund(await json(c), ip(c))));

  // ---- other workstreams' routes ----
  const ctx: PluginContext = { store, config, relayer, notify: (m, k, id) => relayer.notify(m, k, id) };
  const mounted = d.pluginDir === false ? [] : await mountPlugins(app, ctx, d.pluginDir);

  return { app, relayer, faucet, mounted };
}
