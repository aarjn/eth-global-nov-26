// W6 World ID tests. The Developer Portal call is replaced by a TEST-ONLY double (`fakePortal`); the running
// server always uses developerPortalVerifier (real HTTPS call). RP signing uses the real IDKit signRequest.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToBytes, recoverMessageAddress, type Hex } from "viem";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { computeRpSignatureMessage } from "@worldcoin/idkit-core/signing";
import type { Address } from "@paisalink/shared";
import {
  NullifierStore, developerPortalVerifier, loadWorldConfig, normalizeNullifier, worldRoutes,
  type PortalResponse, type WorldVerifier,
} from "../src/world";
import { setup, testConfig } from "./helpers";

const ACTION = "paisalink-merchant";
const SIGNING_KEY = generatePrivateKey();
const NULLIFIER = "1234567890123456789012345678901234567890";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "paisalink-world-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const env = (over: Record<string, string> = {}) => ({
  WORLD_APP_ID: "app_staging_test", WORLD_RP_ID: "rp_test", WORLD_SIGNING_KEY: SIGNING_KEY, WORLD_ACTION: ACTION,
  WORLD_NULLIFIER_FILE: join(dir, "nullifiers.json"), ...over,
});

/** A World ID 4.0 uniqueness result shaped like IDKitResultV4 (proof values are placeholders; the double decides). */
function idkitResult(wallet: Address, over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0", nonce: "0x01", action: ACTION, environment: "staging",
    responses: [{ identifier: "proof_of_human", issuer_schema_id: 1, nullifier: NULLIFIER, signal_hash: hashSignal(wallet),
      proof: ["0x1", "0x2", "0x3", "0x4", "0x5"], expires_at_min: 1_900_000_000, ...item }],
    ...over,
  };
}

/** TEST-ONLY double for POST https://developer.world.org/api/v4/verify/{rp_id}. */
function fakePortal(reply: (body: any) => PortalResponse = (b) => ({ status: 200, body: { success: true, action: b.action, nullifier: b.responses[0].nullifier, environment: b.environment, results: [{ identifier: "proof_of_human", success: true }] } })) {
  const calls: { rpId: string; body: any }[] = [];
  const verifier: WorldVerifier = async (rpId, body) => { calls.push({ rpId, body }); return reply(body); };
  return { verifier, calls };
}

async function world(opts: { verified?: boolean; env?: Record<string, string>; portal?: ReturnType<typeof fakePortal> } = {}) {
  const s = await setup({ verified: opts.verified ?? false });
  const portal = opts.portal ?? fakePortal();
  const notified: string[] = [];
  const ctx = { store: s.store, config: testConfig(), relayer: s.relayer, notify: (m: Address) => { notified.push(m); } };
  const config = loadWorldConfig(opts.env ?? env());
  const nullifiers = new NullifierStore(config.nullifierFile);
  s.app.route("/", worldRoutes(ctx, { config, verifier: portal.verifier, nullifiers }));
  const verify = (body: unknown) => s.post("/world/verify", body);
  return { ...s, portal, notified, config, nullifiers, verify };
}

const json = async (r: Response) => (await r.json()) as any;

describe("World ID: not configured (env still empty)", () => {
  test("config says so, request and verify return 503 WORLD_NOT_CONFIGURED with the missing names only", async () => {
    const w = await world({ env: { WORLD_ACTION: ACTION, WORLD_NULLIFIER_FILE: join(dir, "n.json") } });
    const cfg = await json(await w.app.request("/world/config"));
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(["WORLD_APP_ID", "WORLD_RP_ID", "WORLD_SIGNING_KEY"]);
    expect(cfg.environment).toBe("staging");
    const r1 = await w.app.request(`/world/request?wallet=${w.merchantAcct.address}`);
    expect(r1.status).toBe(503);
    expect((await json(r1)).code).toBe("WORLD_NOT_CONFIGURED");
    const r2 = await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) });
    expect(r2.status).toBe(503);
    expect((await json(r2)).code).toBe("WORLD_NOT_CONFIGURED");
    expect(w.portal.calls).toHaveLength(0);
  });
});

describe("World ID: RP request signing", () => {
  test("GET /world/request returns an rp_context signed by WORLD_SIGNING_KEY (EIP-191 over the IDKit message)", async () => {
    const w = await world();
    const r = await w.app.request(`/world/request?wallet=${w.merchantAcct.address.toLowerCase()}`);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.app_id).toBe("app_staging_test");
    expect(b.action).toBe(ACTION);
    expect(b.environment).toBe("staging");
    expect(b.allow_legacy_proofs).toBe(false);
    expect(b.signal).toBe(w.merchantAcct.address); // checksummed
    expect(b.rp_context.rp_id).toBe("rp_test");
    expect(b.rp_context.expires_at - b.rp_context.created_at).toBe(300);
    const msg = computeRpSignatureMessage(hexToBytes(b.rp_context.nonce as Hex), b.rp_context.created_at, b.rp_context.expires_at, ACTION);
    const signer = await recoverMessageAddress({ message: { raw: msg }, signature: b.rp_context.signature as Hex });
    expect(signer).toBe(privateKeyToAccount(SIGNING_KEY).address);
    expect(JSON.stringify(b)).not.toContain(SIGNING_KEY.slice(2));
    expect(JSON.stringify(await json(await w.app.request("/world/config")))).not.toContain(SIGNING_KEY.slice(2));
  });

  test("bad wallet -> 400", async () => {
    const w = await world();
    expect((await w.app.request("/world/request?wallet=nope")).status).toBe(400);
  });
});

describe("World ID: POST /world/verify", () => {
  test("success: proof forwarded unchanged, merchant verified, nullifier stored off Arkiv, dashboard notified", async () => {
    const w = await world();
    const wallet = w.merchantAcct.address;
    const result = idkitResult(wallet);
    const r = await w.verify({ wallet, result });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ verified: true, wallet, credential: "proof_of_human", environment: "staging" });
    expect(w.portal.calls).toHaveLength(1);
    expect(w.portal.calls[0]!.rpId).toBe("rp_test");
    expect(w.portal.calls[0]!.body).toEqual(result);
    expect((await w.store.getMerchant(wallet))!.verified).toBe(true);
    expect(w.notified).toEqual([wallet]);
    const file = JSON.parse(readFileSync(w.config.nullifierFile, "utf8"));
    expect(file.nullifiers).toHaveLength(1);
    expect(file.nullifiers[0]).toMatchObject({ action: ACTION, nullifier: NULLIFIER, status: "done" });
  });

  test("the IDKit result may also be spread at top level", async () => {
    const w = await world();
    const r = await w.verify({ wallet: w.merchantAcct.address, ...idkitResult(w.merchantAcct.address) });
    expect(r.status).toBe(200);
    expect(w.portal.calls[0]!.body.wallet).toBeUndefined();
  });

  test("replayed proof -> 409 NULLIFIER_REUSED, World not called again", async () => {
    const w = await world();
    const body = { wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) };
    expect((await w.verify(body)).status).toBe(200);
    const r = await w.verify(body);
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe("NULLIFIER_REUSED");
    expect(w.portal.calls).toHaveLength(1);
  });

  test("same human, second merchant wallet -> 409 NULLIFIER_REUSED and the second wallet stays unverified", async () => {
    const w = await world();
    expect((await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) })).status).toBe(200);
    const second = privateKeyToAccount(generatePrivateKey()).address;
    await w.store.upsertMerchant({ wallet: second, handle: "sybil", verified: false, gasUsedWei: "0", createdAt: 2 });
    // nullifier written as hex this time: still the same field element
    const r = await w.verify({ wallet: second, result: idkitResult(second, {}, { nullifier: `0x${BigInt(NULLIFIER).toString(16)}` }) });
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe("NULLIFIER_REUSED");
    expect((await w.store.getMerchant(second))!.verified).toBe(false);
  });

  test("nullifiers survive a restart (file reload)", async () => {
    const w = await world();
    expect((await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) })).status).toBe(200);
    const reloaded = new NullifierStore(w.config.nullifierFile);
    expect(reloaded.get(ACTION, NULLIFIER)?.status).toBe("done");
  });

  test("denied path: World rejects -> 400 WORLD_VERIFICATION_FAILED, nothing stored, relay stays MERCHANT_NOT_VERIFIED", async () => {
    const portal = fakePortal(() => ({ status: 400, body: { success: false, code: "all_verifications_failed", detail: "All proof verifications failed" } }));
    const w = await world({ portal });
    const wallet = w.merchantAcct.address;
    const r = await w.verify({ wallet, result: idkitResult(wallet) });
    expect(r.status).toBe(400);
    const b = await json(r);
    expect(b.code).toBe("WORLD_VERIFICATION_FAILED");
    expect(b.worldCode).toBe("all_verifications_failed");
    expect((await w.store.getMerchant(wallet))!.verified).toBe(false);
    expect(w.nullifiers.size).toBe(0);
    const inv = await w.createInvoice();
    const relay = await w.post("/relay", await w.signAuth(inv.invoiceId));
    expect(relay.status).toBe(403);
    expect((await json(relay)).code).toBe("MERCHANT_NOT_VERIFIED");
  });

  test("after a successful verification the relay accepts the same merchant", async () => {
    const w = await world();
    const inv = await w.createInvoice();
    expect((await w.post("/relay", await w.signAuth(inv.invoiceId))).status).toBe(403);
    expect((await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) })).status).toBe(200);
    const relay = await w.post("/relay", await w.signAuth(inv.invoiceId));
    expect(relay.status).toBe(200);
    expect((await json(relay)).txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("World says success:false with HTTP 200 -> still refused", async () => {
    const w = await world({ portal: fakePortal(() => ({ status: 200, body: { success: false, code: "x", detail: "no" } })) });
    expect((await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) })).status).toBe(400);
    expect((await w.store.getMerchant(w.merchantAcct.address))!.verified).toBe(false);
  });

  test("local checks refuse before calling World: signal, credential, environment, action, legacy", async () => {
    const w = await world();
    const wallet = w.merchantAcct.address;
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const cases: [unknown, number, string][] = [
      [{ wallet, result: idkitResult(other) }, 400, "WORLD_SIGNAL_MISMATCH"],
      [{ wallet, result: idkitResult(wallet, {}, { signal_hash: undefined }) }, 400, "WORLD_SIGNAL_MISMATCH"],
      [{ wallet, result: idkitResult(wallet, {}, { identifier: "device", issuer_schema_id: 0 }) }, 400, "WORLD_WRONG_CREDENTIAL"],
      [{ wallet, result: idkitResult(wallet, {}, { identifier: "passport", issuer_schema_id: 9303 }) }, 400, "WORLD_WRONG_CREDENTIAL"],
      [{ wallet, result: idkitResult(wallet, { environment: "production" }) }, 400, "WORLD_ENV_MISMATCH"],
      [{ wallet, result: idkitResult(wallet, { action: "something-else" }) }, 400, "WORLD_ACTION_MISMATCH"],
      [{ wallet, result: idkitResult(wallet, { protocol_version: "3.0" }) }, 400, "WORLD_WRONG_CREDENTIAL"],
      [{ wallet: "0x123", result: idkitResult(wallet) }, 400, "BAD_REQUEST"],
      [{ wallet }, 400, "BAD_REQUEST"],
    ];
    for (const [body, status, code] of cases) {
      const r = await w.verify(body);
      expect(r.status).toBe(status);
      expect((await json(r)).code).toBe(code);
    }
    expect(w.portal.calls).toHaveLength(0);
    expect((await w.store.getMerchant(wallet))!.verified).toBe(false);
  });

  test("unknown merchant -> 404 MERCHANT_NOT_FOUND (proof not spent)", async () => {
    const w = await world();
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    const r = await w.verify({ wallet: stranger, result: idkitResult(stranger) });
    expect(r.status).toBe(404);
    expect((await json(r)).code).toBe("MERCHANT_NOT_FOUND");
    expect(w.portal.calls).toHaveLength(0);
  });

  test("already-verified merchant with a fresh human -> 200 alreadyVerified, no nullifier consumed", async () => {
    const w = await world({ verified: true });
    const r = await w.verify({ wallet: w.merchantAcct.address, result: idkitResult(w.merchantAcct.address) });
    expect(r.status).toBe(200);
    expect((await json(r)).alreadyVerified).toBe(true);
    expect(w.portal.calls).toHaveLength(0);
    expect(w.nullifiers.size).toBe(0);
  });

  test("Arkiv write fails after World said yes -> 503 STORE_UNAVAILABLE; the same wallet can finish with the same proof", async () => {
    const w = await world();
    const wallet = w.merchantAcct.address;
    const orig = w.store.setMerchantVerified.bind(w.store);
    let fail = true;
    w.store.setMerchantVerified = async (a, v) => { if (fail) throw new Error("simulated Arkiv outage"); return orig(a, v); };
    const body = { wallet, result: idkitResult(wallet) };
    const r1 = await w.verify(body);
    expect(r1.status).toBe(503);
    expect((await json(r1)).code).toBe("STORE_UNAVAILABLE");
    expect(w.nullifiers.get(ACTION, NULLIFIER)?.status).toBe("pending");
    fail = false;
    const r2 = await w.verify(body);
    expect(r2.status).toBe(200);
    expect((await json(r2)).resumed).toBe(true);
    expect(w.portal.calls).toHaveLength(1);
    expect(w.nullifiers.get(ACTION, NULLIFIER)?.status).toBe("done");
    expect((await w.verify(body)).status).toBe(409);
  });

  test("legacy (3.0) Orb proofs are accepted only with WORLD_ALLOW_LEGACY=1", async () => {
    const w = await world({ env: env({ WORLD_ALLOW_LEGACY: "1" }) });
    const wallet = w.merchantAcct.address;
    const v3 = { protocol_version: "3.0", nonce: "0x01", action: ACTION, environment: "staging",
      responses: [{ identifier: "orb", proof: "0xabc", merkle_root: "0x1", nullifier: "0x2a", signal_hash: hashSignal(wallet) }] };
    const r = await w.verify({ wallet, result: v3 });
    expect(r.status).toBe(200);
    expect(w.nullifiers.get(ACTION, "42")).toBeDefined();
  });
});

describe("World ID helpers", () => {
  test("normalizeNullifier: decimal, hex and nil_ forms agree; garbage refused", () => {
    expect(normalizeNullifier("42")).toBe("42");
    expect(normalizeNullifier("0x2a")).toBe("42");
    expect(normalizeNullifier(`nil_${(42).toString(16).padStart(64, "0")}`)).toBe("42");
    expect(() => normalizeNullifier("zz")).toThrow();
    expect(() => normalizeNullifier(undefined)).toThrow();
  });

  test("developerPortalVerifier posts the body unchanged to /api/v4/verify/{rp_id}; network failure -> WORLD_UNAVAILABLE", async () => {
    const seen: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ success: true, nullifier: "0x1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const v = developerPortalVerifier("https://developer.world.org/api/v4/verify", fakeFetch);
    const body = { protocol_version: "4.0", responses: [{ a: 1 }] };
    const out = await v("rp_abc", body);
    expect(out).toEqual({ status: 200, body: { success: true, nullifier: "0x1" } });
    expect(seen[0]!.url).toBe("https://developer.world.org/api/v4/verify/rp_abc");
    expect(seen[0]!.body).toBe(JSON.stringify(body));
    const down = developerPortalVerifier("https://x", (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    await expect(down("rp", {})).rejects.toMatchObject({ code: "WORLD_UNAVAILABLE" });
  });

  test("a corrupt nullifier file stops startup instead of silently allowing reuse", async () => {
    const f = join(dir, "bad.json");
    await Bun.write(f, "{not json");
    expect(() => new NullifierStore(f)).toThrow(/not valid JSON/);
  });
});
