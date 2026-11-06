// W6: World ID (IDKit 4.6.0) merchant verification.
//
// Trust moment: a merchant asks PaisaLink to pay gas for its customers (the relayer spends real WBT for them).
// Credential: Proof of Human (Orb, issuer schema 1). One human = one merchant = one sponsored gas budget.
// Device-level is cheap to farm (one person, many accounts, drained relayer); passport / selfie reveal more than we need.
//
// Routes (mounted at "/" by plugins.ts):
//   GET  /world/config            public, no secrets: is World configured, app id, action, environment, credential
//   GET  /world/request?wallet=   signs a fresh RP context (IDKit 4 `signRequest`) for this merchant wallet
//   POST /world/verify            { wallet, result: IDKitResult } -> verify with the Developer Portal, nullifier once, set verified
//
// Nullifiers live in `.data/nullifiers.json` (git-ignored), never on Arkiv. Missing env -> 503 WORLD_NOT_CONFIGURED.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import { getAddress, isAddress, zeroHash } from "viem";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { Nullifier } from "@worldcoin/idkit-core/nullifier";
import type { Address } from "@paisalink/shared";
import type { PluginContext } from "./plugins";

// ---------------------------------------------------------------- config

export type WorldEnvironment = "production" | "staging";

export interface WorldConfig {
  appId?: `app_${string}`;
  rpId?: string;
  /** Secret. Never logged, never returned. */
  signingKey?: string;
  action: string;
  environment: WorldEnvironment;
  /** Accept World ID 3.0 proofs as a fallback (ProofOfHuman preset). Off by default: one nullifier space only. */
  allowLegacy: boolean;
  verifyBaseUrl: string;
  nullifierFile: string;
  /** Seconds an RP signature stays valid. */
  requestTtlSec: number;
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
export const SIMULATOR_URL = "https://simulator.worldcoin.org/id/0x18310f83";

export function loadWorldConfig(env: Record<string, string | undefined> = process.env): WorldConfig {
  const appId = (env.WORLD_APP_ID || env.VITE_WORLD_APP_ID || "").trim();
  const environment: WorldEnvironment = env.WORLD_ENVIRONMENT === "production" ? "production" : "staging";
  return {
    appId: appId.startsWith("app_") ? (appId as `app_${string}`) : undefined,
    rpId: (env.WORLD_RP_ID || "").trim() || undefined,
    signingKey: (env.WORLD_SIGNING_KEY || "").trim() || undefined,
    action: (env.WORLD_ACTION || "").trim() || "paisalink-merchant",
    environment,
    allowLegacy: env.WORLD_ALLOW_LEGACY === "1",
    verifyBaseUrl: (env.WORLD_VERIFY_URL || "https://developer.world.org/api/v4/verify").replace(/\/+$/, ""),
    nullifierFile: env.WORLD_NULLIFIER_FILE || join(REPO_ROOT, ".data", "nullifiers.json"),
    requestTtlSec: 300,
  };
}

/** Names (never values) of the env vars still missing. */
export function missingWorldEnv(c: WorldConfig): string[] {
  const m: string[] = [];
  if (!c.appId) m.push("WORLD_APP_ID");
  if (!c.rpId) m.push("WORLD_RP_ID");
  if (!c.signingKey) m.push("WORLD_SIGNING_KEY");
  return m;
}

// ---------------------------------------------------------------- errors

export type WorldErrorCode =
  | "WORLD_NOT_CONFIGURED"
  | "BAD_REQUEST"
  | "MERCHANT_NOT_FOUND"
  | "WORLD_ENV_MISMATCH"
  | "WORLD_ACTION_MISMATCH"
  | "WORLD_WRONG_CREDENTIAL"
  | "WORLD_SIGNAL_MISMATCH"
  | "WORLD_VERIFICATION_FAILED"
  | "WORLD_UNAVAILABLE"
  | "NULLIFIER_REUSED"
  | "STORE_UNAVAILABLE";

const STATUS: Record<WorldErrorCode, number> = {
  WORLD_NOT_CONFIGURED: 503,
  BAD_REQUEST: 400,
  MERCHANT_NOT_FOUND: 404,
  WORLD_ENV_MISMATCH: 400,
  WORLD_ACTION_MISMATCH: 400,
  WORLD_WRONG_CREDENTIAL: 400,
  WORLD_SIGNAL_MISMATCH: 400,
  WORLD_VERIFICATION_FAILED: 400,
  WORLD_UNAVAILABLE: 502,
  NULLIFIER_REUSED: 409,
  STORE_UNAVAILABLE: 503,
};

export class WorldError extends Error {
  readonly status: number;
  constructor(readonly code: WorldErrorCode, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.status = STATUS[code];
  }
  toJSON() { return { error: this.message, code: this.code, ...this.extra }; }
}

// ---------------------------------------------------------------- Developer Portal verifier

export interface PortalResponse { status: number; body: Record<string, unknown> }
/** POST the IDKit result, unchanged, to the Developer Portal. Tests pass a double instead. */
export type WorldVerifier = (rpId: string, result: unknown) => Promise<PortalResponse>;

export function developerPortalVerifier(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): WorldVerifier {
  return async (rpId, result) => {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/${encodeURIComponent(rpId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new WorldError("WORLD_UNAVAILABLE", `could not reach the World Developer Portal: ${(e as Error).message.split("\n")[0]}`);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = { detail: text.slice(0, 200) }; }
    return { status: res.status, body };
  };
}

// ---------------------------------------------------------------- nullifier store (.data/nullifiers.json)

export interface NullifierRecord {
  action: string;
  /** Decimal string of the field element. */
  nullifier: string;
  wallet: Address;
  /** "pending": World said yes but the Arkiv write has not landed yet (the same wallet may retry). */
  status: "pending" | "done";
  verifiedAt: number;
  protocol: string;
}

export class NullifierStore {
  private rows = new Map<string, NullifierRecord>();
  constructor(readonly file: string | null) {
    if (file && existsSync(file)) {
      // A corrupt file must stop the server: silently starting empty would let every nullifier be reused.
      let data: { nullifiers?: NullifierRecord[] };
      try { data = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error(`[world] ${file} is not valid JSON; fix or move it before starting`); }
      for (const r of data.nullifiers ?? []) this.rows.set(NullifierStore.key(r.action, r.nullifier), r);
    }
  }
  static key(action: string, nullifier: string) { return `${action}:${nullifier}`; }
  get(action: string, nullifier: string) { return this.rows.get(NullifierStore.key(action, nullifier)); }
  get size() { return this.rows.size; }
  /** Atomic insert (single-threaded event loop): false if the nullifier already exists. */
  reserve(r: NullifierRecord): boolean {
    const k = NullifierStore.key(r.action, r.nullifier);
    if (this.rows.has(k)) return false;
    this.rows.set(k, r);
    this.flush();
    return true;
  }
  markDone(action: string, nullifier: string) {
    const r = this.rows.get(NullifierStore.key(action, nullifier));
    if (r && r.status !== "done") { r.status = "done"; this.flush(); }
  }
  private flush() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ note: "World ID nullifiers (anonymous, RP-scoped). Kept off Arkiv on purpose.", nullifiers: [...this.rows.values()] }, null, 2));
    renameSync(tmp, this.file);
  }
}

/** World ID nullifiers arrive as decimal (v4 types), 0x-hex (v3 / docs) or `nil_` canonical strings. Returns decimal. */
export function normalizeNullifier(raw: unknown): string {
  if (typeof raw !== "string" || !raw) throw new WorldError("BAD_REQUEST", "proof has no nullifier");
  const s = raw.trim();
  try {
    if (s.startsWith("nil_")) return Nullifier.fromCanonicalString(s).toBigInt().toString();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return Nullifier.fromHex(s).toBigInt().toString();
    if (/^[0-9]+$/.test(s)) return Nullifier.fromHex(`0x${BigInt(s).toString(16)}`).toBigInt().toString();
  } catch { /* fall through */ }
  throw new WorldError("BAD_REQUEST", "proof nullifier is malformed");
}

const sameField = (a: string, b: string) => { try { return BigInt(a) === BigInt(b); } catch { return false; } };

// ---------------------------------------------------------------- proof checks + verification

/** Credentials we accept: Proof of Human only. v4 identifier "proof_of_human" (schema 1); v3 legacy "orb". */
const POH_IDS = new Set(["proof_of_human", "orb"]);

interface ProofResponse { identifier?: string; issuer_schema_id?: number; nullifier?: string; signal_hash?: string }

export interface VerifyInput { wallet: Address; result: Record<string, unknown> }

export function parseVerifyBody(body: unknown): VerifyInput {
  if (!body || typeof body !== "object") throw new WorldError("BAD_REQUEST", "body must be a JSON object");
  const b = body as Record<string, unknown>;
  if (typeof b.wallet !== "string" || !isAddress(b.wallet)) throw new WorldError("BAD_REQUEST", "wallet must be a 0x address");
  const wallet = getAddress(b.wallet);
  let result = (b.result ?? b.idkitResponse) as Record<string, unknown> | undefined;
  if (!result) { const { wallet: _w, ...rest } = b; result = rest; } // the IDKit result spread at top level
  if (!result || typeof result !== "object" || !Array.isArray(result.responses)) throw new WorldError("BAD_REQUEST", "result must be the IDKit result object (with responses[])");
  return { wallet, result };
}

/** Local checks before we spend a Developer Portal call. Returns the Proof of Human response item. */
export function checkProofShape(cfg: WorldConfig, input: VerifyInput): ProofResponse {
  const r = input.result;
  if (typeof r.session_id === "string" && typeof r.action !== "string") throw new WorldError("BAD_REQUEST", "session proofs are not accepted here; send a uniqueness proof");
  if ((r.environment ?? "production") !== cfg.environment) {
    throw new WorldError("WORLD_ENV_MISMATCH", `proof is for environment "${String(r.environment ?? "production")}", this server expects "${cfg.environment}"`);
  }
  if (r.action !== cfg.action) throw new WorldError("WORLD_ACTION_MISMATCH", `proof is for action "${String(r.action)}", expected "${cfg.action}"`);
  if (r.protocol_version === "3.0" && !cfg.allowLegacy) throw new WorldError("WORLD_WRONG_CREDENTIAL", "World ID 3.0 (legacy) proofs are turned off; use a World ID 4.0 proof");
  const items = r.responses as ProofResponse[];
  const poh = items.find((i) => typeof i?.identifier === "string" && POH_IDS.has(i.identifier) && (r.protocol_version !== "4.0" || i.issuer_schema_id === 1));
  if (!poh) {
    const got = items.map((i) => i?.identifier).filter(Boolean).join(", ") || "none";
    throw new WorldError("WORLD_WRONG_CREDENTIAL", `Proof of Human (Orb) is required for gas sponsorship; got: ${got}`);
  }
  const expected = hashSignal(input.wallet);
  if (typeof poh.signal_hash !== "string" || !sameField(poh.signal_hash, expected)) {
    throw new WorldError("WORLD_SIGNAL_MISMATCH", "proof is not bound to this merchant wallet (signal mismatch)");
  }
  return poh;
}

export interface VerifyDeps {
  config: WorldConfig;
  store: PluginContext["store"];
  nullifiers: NullifierStore;
  verifier: WorldVerifier;
  notify?: PluginContext["notify"];
  now?: () => number;
}

export interface VerifyOutcome {
  verified: true;
  wallet: Address;
  alreadyVerified?: boolean;
  resumed?: boolean;
  credential: "proof_of_human";
  environment: WorldEnvironment;
}

export async function verifyMerchant(d: VerifyDeps, body: unknown): Promise<VerifyOutcome> {
  const cfg = d.config;
  const missing = missingWorldEnv(cfg);
  if (missing.length) throw new WorldError("WORLD_NOT_CONFIGURED", "World ID is not configured on this server yet", { missing });
  const input = parseVerifyBody(body);
  const base = { verified: true as const, wallet: input.wallet, credential: "proof_of_human" as const, environment: cfg.environment };

  const merchant = await d.store.getMerchant(input.wallet);
  if (!merchant) throw new WorldError("MERCHANT_NOT_FOUND", "create the merchant profile first (POST /merchants), then verify");

  const poh = checkProofShape(cfg, input);
  const claimed = normalizeNullifier(poh.nullifier);
  const prior = d.nullifiers.get(cfg.action, claimed);
  let resumed = false;
  if (prior) {
    // Same wallet whose Arkiv write failed after World said yes: finish the write without re-verifying.
    if (prior.status === "pending" && prior.wallet.toLowerCase() === input.wallet.toLowerCase()) resumed = true;
    else throw reused(); // a replayed proof, or the same human verifying a second merchant wallet
  }
  // A different human proving for an already-verified wallet changes nothing; don't consume their nullifier.
  if (merchant.verified && !resumed) return { ...base, alreadyVerified: true };

  if (!resumed) {
    const { status, body: v } = await d.verifier(cfg.rpId!, input.result);
    if (status < 200 || status >= 300 || v.success !== true) {
      throw new WorldError("WORLD_VERIFICATION_FAILED", `World ID rejected the proof: ${String(v.detail ?? v.code ?? `HTTP ${status}`)}`,
        { worldCode: v.code ?? null, worldStatus: status });
    }
    if (typeof v.environment === "string" && v.environment !== cfg.environment) {
      throw new WorldError("WORLD_ENV_MISMATCH", `World verified the proof for "${v.environment}", expected "${cfg.environment}"`);
    }
    if (typeof v.action === "string" && v.action !== cfg.action) throw new WorldError("WORLD_ACTION_MISMATCH", `World verified action "${v.action}", expected "${cfg.action}"`);
    const verifiedNullifier = v.nullifier !== undefined && v.nullifier !== null ? normalizeNullifier(v.nullifier) : claimed;
    if (verifiedNullifier !== claimed) throw new WorldError("WORLD_VERIFICATION_FAILED", "nullifier returned by World does not match the proof");
    const ok = d.nullifiers.reserve({
      action: cfg.action, nullifier: claimed, wallet: input.wallet, status: "pending",
      verifiedAt: Math.floor((d.now?.() ?? Date.now()) / 1000), protocol: String(input.result.protocol_version ?? ""),
    });
    if (!ok) throw reused(); // a concurrent request with the same proof won the race
  }

  try {
    await d.store.setMerchantVerified(input.wallet, true);
  } catch (e) {
    const err = e as Error;
    throw new WorldError("STORE_UNAVAILABLE", `World ID verified you, but saving to Arkiv failed (${err.message.split("\n")[0]}). Retry with the same proof.`,
      { retryable: true, ...(err.name === "ArkivRateLimitedError" ? { arkiv: "rate_limited" } : {}) });
  }
  d.nullifiers.markDone(cfg.action, claimed);
  // Dashboards refetch the merchant on any SSE event; there is no "merchant" kind, so send an invoice event with a zero id.
  try { d.notify?.(input.wallet, "invoice", zeroHash); } catch { /* never fail a verification on a listener */ }
  return resumed ? { ...base, resumed: true } : base;
}

function reused() {
  return new WorldError("NULLIFIER_REUSED", "this World ID has already verified a PaisaLink merchant; one human gets one sponsored gas budget");
}

/** Fresh RP context for IDKit 4 (`rp_context`). The signing key never leaves the server. */
export function buildRequest(cfg: WorldConfig, walletRaw: string | undefined) {
  const missing = missingWorldEnv(cfg);
  if (missing.length) throw new WorldError("WORLD_NOT_CONFIGURED", "World ID is not configured on this server yet", { missing });
  if (!walletRaw || !isAddress(walletRaw)) throw new WorldError("BAD_REQUEST", "wallet query parameter must be a 0x address");
  const wallet = getAddress(walletRaw);
  let sig;
  try {
    sig = signRequest({ signingKeyHex: cfg.signingKey!, action: cfg.action, ttl: cfg.requestTtlSec });
  } catch {
    throw new WorldError("WORLD_NOT_CONFIGURED", "WORLD_SIGNING_KEY is set but could not sign (value not shown)", { missing: [] });
  }
  return {
    app_id: cfg.appId!,
    action: cfg.action,
    environment: cfg.environment,
    allow_legacy_proofs: cfg.allowLegacy,
    credential: "proof_of_human" as const,
    signal: wallet,
    rp_context: { rp_id: cfg.rpId!, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
  };
}

// ---------------------------------------------------------------- routes

export interface WorldRouteOptions {
  env?: Record<string, string | undefined>;
  config?: WorldConfig;
  verifier?: WorldVerifier;
  nullifiers?: NullifierStore;
  now?: () => number;
}

export function worldRoutes(ctx: PluginContext, opts: WorldRouteOptions = {}): Hono {
  const config = opts.config ?? loadWorldConfig(opts.env ?? process.env);
  const nullifiers = opts.nullifiers ?? new NullifierStore(config.nullifierFile);
  const verifier = opts.verifier ?? developerPortalVerifier(config.verifyBaseUrl);
  const deps: VerifyDeps = { config, store: ctx.store, nullifiers, verifier, notify: ctx.notify, now: opts.now };
  const app = new Hono();

  const fail = (c: Context, e: unknown) => {
    if (e instanceof WorldError) return c.json(e.toJSON(), e.status as 400);
    const err = e as Error;
    if (err?.name === "ArkivRateLimitedError") return c.json({ error: "Arkiv is rate limiting us; try again shortly", code: "ARKIV_RATE_LIMITED" }, 429);
    if (/arkiv/i.test(err?.name ?? "")) return c.json({ error: `Arkiv unavailable: ${err.message.split("\n")[0]}`, code: "ARKIV_UNAVAILABLE" }, 503);
    console.error("[world] unhandled", err?.message?.split("\n")[0]);
    return c.json({ error: "internal error", code: "INTERNAL" }, 500);
  };

  app.get("/world/config", (c) => {
    const missing = missingWorldEnv(config);
    return c.json({
      configured: missing.length === 0, missing,
      app_id: config.appId ?? null, action: config.action, environment: config.environment,
      allow_legacy_proofs: config.allowLegacy, credential: "proof_of_human",
      simulatorUrl: config.environment === "staging" ? SIMULATOR_URL : null,
    });
  });

  app.get("/world/request", (c) => {
    try { return c.json(buildRequest(config, c.req.query("wallet"))); } catch (e) { return fail(c, e); }
  });

  app.post("/world/verify", async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return fail(c, new WorldError("BAD_REQUEST", "body must be JSON")); }
    try {
      const out = await verifyMerchant(deps, body);
      console.log(`[world] merchant ${out.wallet} verified${out.alreadyVerified ? " (already)" : out.resumed ? " (resumed)" : ""}`);
      return c.json(out);
    } catch (e) {
      if (e instanceof WorldError) console.warn(`[world] verify refused: ${e.code}`);
      return fail(c, e);
    }
  });

  return app;
}
