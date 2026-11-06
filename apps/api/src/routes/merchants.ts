// Merchant routes (W4). Mounted by apps/api/src/plugins.ts at "/", so paths are absolute.
//   POST /merchants                  {wallet, handle} -> Merchant   (upsert; never resets verified / gas used / created_at)
//   GET  /merchants/:wallet          -> Merchant | 404
//   GET  /merchants/:wallet/invoices -> Invoice[]  (?state=open|paid|... optional), read live from Arkiv
//   GET  /merchants/:wallet/payments -> Payment[]  read live from Arkiv
// Errors are JSON {error, code}.
import { Hono, type Context } from "hono";
import type { Address, InvoiceState, Merchant, PaisaStore } from "@paisalink/shared";
import { getAddress, isAddress } from "viem";

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/; // 3-32 chars (matches the web form), public, no personal data
const STATES: readonly InvoiceState[] = ["open", "paid", "refunded", "financed", "settled"];

/** Optional ArkivStore extras, used when present (duck-typed so tests can pass any PaisaStore). */
type Extras = {
  getMerchantByHandle?: (handle: string) => Promise<Merchant | null>;
  explorerUrlFor?: (kind: "merchant", id: string) => string | undefined;
};

type Code = "BAD_REQUEST" | "MERCHANT_NOT_FOUND" | "HANDLE_TAKEN" | "ARKIV_RATE_LIMITED" | "ARKIV_UNAVAILABLE";
const fail = (c: Context, status: 400 | 404 | 409 | 429 | 503, code: Code, error: string) => c.json({ error, code }, status);

function wallet(raw: string | undefined): Address | null {
  return raw && isAddress(raw) ? getAddress(raw) : null;
}

/** Store failures are Arkiv failures: the node is the database. */
function arkivError(c: Context, err: unknown) {
  const e = err as Error;
  if (e?.name === "ArkivRateLimitedError") return fail(c, 429, "ARKIV_RATE_LIMITED", e.message);
  console.error("[merchants] Arkiv call failed:", e?.message ?? e);
  return fail(c, 503, "ARKIV_UNAVAILABLE", `Arkiv read/write failed: ${e?.message ?? String(e)}`);
}

export function merchantsRoutes(store: PaisaStore): Hono {
  const app = new Hono();
  const extra = store as PaisaStore & Extras;

  app.post("/merchants", async (c) => {
    let body: { wallet?: unknown; handle?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, "BAD_REQUEST", "body must be JSON {wallet, handle}");
    }
    const w = typeof body.wallet === "string" ? wallet(body.wallet) : null;
    if (!w) return fail(c, 400, "BAD_REQUEST", "wallet must be a 0x address");
    const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
    if (!HANDLE_RE.test(handle)) {
      return fail(c, 400, "BAD_REQUEST", "handle must be 3-32 chars: a-z, 0-9, dot, dash, underscore; starting and ending with a letter or digit");
    }
    try {
      const existing = await store.getMerchant(w);
      if (extra.getMerchantByHandle && existing?.handle !== handle) {
        const owner = await extra.getMerchantByHandle(handle);
        if (owner && owner.wallet !== w) return fail(c, 409, "HANDLE_TAKEN", `handle @${handle} is taken`);
      }
      const m: Merchant = existing
        ? { ...existing, handle } // keep verified, gasUsedWei, createdAt
        : { wallet: w, handle, verified: false, gasUsedWei: "0", createdAt: Math.floor(Date.now() / 1000) };
      const saved = await store.upsertMerchant(m);
      const arkivUrl = extra.explorerUrlFor?.("merchant", w);
      return c.json(arkivUrl ? { ...saved, arkivUrl } : saved, existing ? 200 : 201);
    } catch (err) {
      return arkivError(c, err);
    }
  });

  app.get("/merchants/:wallet", async (c) => {
    const w = wallet(c.req.param("wallet"));
    if (!w) return fail(c, 400, "BAD_REQUEST", "wallet must be a 0x address");
    try {
      const m = await store.getMerchant(w);
      if (!m) return fail(c, 404, "MERCHANT_NOT_FOUND", `no merchant ${w}`);
      const arkivUrl = extra.explorerUrlFor?.("merchant", w);
      return c.json(arkivUrl ? { ...m, arkivUrl } : m);
    } catch (err) {
      return arkivError(c, err);
    }
  });

  app.get("/merchants/:wallet/invoices", async (c) => {
    const w = wallet(c.req.param("wallet"));
    if (!w) return fail(c, 400, "BAD_REQUEST", "wallet must be a 0x address");
    const state = c.req.query("state");
    if (state !== undefined && !STATES.includes(state as InvoiceState)) {
      return fail(c, 400, "BAD_REQUEST", `state must be one of ${STATES.join(", ")}`);
    }
    try {
      const all = await store.listInvoicesByMerchant(w);
      c.header("Cache-Control", "no-store");
      return c.json(state ? all.filter((i) => i.state === state) : all);
    } catch (err) {
      return arkivError(c, err);
    }
  });

  app.get("/merchants/:wallet/payments", async (c) => {
    const w = wallet(c.req.param("wallet"));
    if (!w) return fail(c, 400, "BAD_REQUEST", "wallet must be a 0x address");
    try {
      c.header("Cache-Control", "no-store");
      return c.json(await store.listPaymentsByMerchant(w));
    } catch (err) {
      return arkivError(c, err);
    }
  });

  return app;
}

export default merchantsRoutes;
