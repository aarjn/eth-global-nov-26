// W7: Swarm upload/read for invoice PDFs (Arkiv + Swarm bonus).
//
// The bytes go to Swarm; only the plain 64-hex Swarm reference goes to Arkiv (invoice entity attribute `swarm_ref`).
// Uploads are never encrypted: an encrypted reference (128 hex) carries its decryption key and Arkiv entities are public,
// so `assertPlainReference` refuses to hand one to the store.
//
// Where uploads go (env):
//   BEE_URL unset/empty  -> the Swarm Foundation public gateway https://api.gateway.ethswarm.org. It accepts uploads
//                           without our own postage batch (the gateway stamps them with its own batch), so BEE_BATCH_ID
//                           is sent as 64 zeros and ignored by the gateway.
//   BEE_URL=<bee node>   -> your own Bee node (or a hackathon gateway); BEE_BATCH_ID=<usable postage batch> is required.
//   SWARM_DISABLED=1     -> no uploads; POST /invoices/:id/pdf answers 503 SWARM_NOT_CONFIGURED.
//   SWARM_GATEWAY_URL    -> base of the public read links (default https://api.gateway.ethswarm.org/bzz).
//
// Route (mounted at "/" by plugins.ts): GET /swarm/status (public, no secrets).
// CLI (one upload, one read), from apps/api:
//   bun --env-file=../../.env.local src/swarm.ts upload <file> [content-type]
//   bun --env-file=../../.env.local src/swarm.ts read <reference> [out-file]
import { Bee } from "@ethersphere/bee-js";
import { Hono } from "hono";

export const PUBLIC_GATEWAY = "https://api.gateway.ethswarm.org";
export const ZERO_BATCH = "0".repeat(64);

export interface SwarmConfig {
  /** Bee API base URL used for uploads (no trailing slash). */
  beeUrl: string;
  /** Postage batch id (64 hex). ZERO_BATCH when the public gateway stamps for us. */
  batchId: string;
  /** True when uploading through the Swarm Foundation public gateway. */
  publicGateway: boolean;
  /** Base for openable read links, e.g. https://api.gateway.ethswarm.org/bzz */
  readBase: string;
  timeoutMs: number;
}

export class SwarmNotConfiguredError extends Error {
  override name = "SwarmNotConfiguredError";
}
export class SwarmUploadError extends Error {
  override name = "SwarmUploadError";
}

const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");
const HEX64 = /^[0-9a-f]{64}$/;

/** Returns null when Swarm is switched off or a custom Bee node lacks a batch id (caller answers 503). */
export function loadSwarmConfig(env: Record<string, string | undefined> = process.env): SwarmConfig | null {
  if (env.SWARM_DISABLED === "1") return null;
  const custom = trimSlash(env.BEE_URL ?? "");
  const beeUrl = custom || PUBLIC_GATEWAY;
  const publicGateway = beeUrl === PUBLIC_GATEWAY;
  let batchId = (env.BEE_BATCH_ID ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!batchId) {
    if (!publicGateway) return null; // own Bee node without a postage batch: cannot upload
    batchId = ZERO_BATCH;
  }
  if (!HEX64.test(batchId)) throw new Error("BEE_BATCH_ID must be 64 hex characters");
  const readBase = trimSlash(env.SWARM_GATEWAY_URL || `${PUBLIC_GATEWAY}/bzz`);
  const timeoutMs = Number(env.SWARM_TIMEOUT_MS) > 0 ? Number(env.SWARM_TIMEOUT_MS) : 60_000;
  return { beeUrl, batchId, publicGateway, readBase, timeoutMs };
}

/** A plain Swarm reference is 32 bytes (64 hex). 128 hex = encrypted (reference + key): never store it on Arkiv. */
export function assertPlainReference(ref: string): string {
  const r = ref.toLowerCase().replace(/^0x/, "");
  if (r.length === 128) throw new SwarmUploadError("got an encrypted Swarm reference; refusing to store it (it contains the key)");
  if (!HEX64.test(r)) throw new SwarmUploadError(`unexpected Swarm reference: ${ref.slice(0, 80)}`);
  return r;
}

export const swarmLink = (cfg: Pick<SwarmConfig, "readBase">, ref: string) => `${cfg.readBase}/${ref}/`;

/** Strip credentials and query strings before showing a URL. */
export function safeUrl(u: string): string {
  try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, "")}`; } catch { return "(invalid url)"; }
}

export interface SwarmUploadResult { reference: string; url: string; bytes: number }

export interface SwarmClient {
  readonly config: SwarmConfig;
  upload(data: Uint8Array, name: string, contentType: string): Promise<SwarmUploadResult>;
  download(ref: string): Promise<{ data: Uint8Array; name?: string; contentType?: string }>;
  health(): Promise<boolean>;
}

export function createSwarmClient(cfg: SwarmConfig): SwarmClient {
  const bee = new Bee(cfg.beeUrl, { timeout: cfg.timeoutMs });
  return {
    config: cfg,
    async upload(data, name, contentType) {
      let res;
      try {
        // bee-js 13: single-file upload lives under `bee.file` (POST /bzz). encrypt:false -> plain 64-hex reference;
        // deferred:false -> the request returns only after the node pushed the chunks to the network.
        res = await bee.file.upload(cfg.batchId, data, name, { contentType, encrypt: false, deferred: false });
      } catch (e) {
        const msg = (e as Error)?.message?.split("\n")[0] ?? String(e);
        throw new SwarmUploadError(`Swarm upload via ${safeUrl(cfg.beeUrl)} failed: ${msg}`);
      }
      const reference = assertPlainReference(res.reference.toHex());
      return { reference, url: swarmLink(cfg, reference), bytes: data.byteLength };
    },
    async download(ref) {
      const f = await bee.file.download(assertPlainReference(ref));
      return { data: f.data.toUint8Array(), name: f.name, contentType: f.contentType };
    },
    async health() {
      try {
        const r = await fetch(`${cfg.beeUrl}/health`, { signal: AbortSignal.timeout(5_000) });
        return r.ok;
      } catch { return false; }
    },
  };
}

/** Public status for judges and the dashboard: which service, which batch, where links open. No secrets. */
export function swarmStatus(cfg: SwarmConfig | null) {
  if (!cfg) return { configured: false, reason: "SWARM_DISABLED=1, or BEE_URL is set without BEE_BATCH_ID" };
  return {
    configured: true,
    service: cfg.publicGateway ? "Swarm Foundation public gateway (gateway-proxy, stamps uploads with its own postage batch)" : "Bee node from BEE_URL",
    uploadUrl: safeUrl(cfg.beeUrl),
    batchId: cfg.publicGateway ? null : cfg.batchId,
    readBase: safeUrl(cfg.readBase),
    encrypted: false,
  };
}

export function swarmRoutes(_ctx?: unknown, env: Record<string, string | undefined> = process.env): Hono {
  const app = new Hono();
  let cfg: SwarmConfig | null = null;
  let cfgError: string | null = null;
  try { cfg = loadSwarmConfig(env); } catch (e) { cfgError = (e as Error).message; }
  app.get("/swarm/status", async (c) => {
    if (cfgError) return c.json({ configured: false, reason: cfgError });
    const status = swarmStatus(cfg);
    const healthy = cfg ? await createSwarmClient(cfg).health() : false;
    return c.json({ ...status, healthy });
  });
  return app;
}

// ---------------------------------------------------------------- CLI

async function cli(argv: string[]) {
  const [cmd, a, b] = argv;
  const cfg = loadSwarmConfig();
  if (!cfg) throw new SwarmNotConfiguredError("Swarm is not configured (see the header of src/swarm.ts)");
  const client = createSwarmClient(cfg);
  if (cmd === "upload" && a) {
    const data = new Uint8Array(await Bun.file(a).arrayBuffer());
    const name = a.split("/").pop() || "file";
    const type = b || Bun.file(a).type || "application/octet-stream";
    const r = await client.upload(data, name, type);
    console.log(JSON.stringify({ ...r, service: safeUrl(cfg.beeUrl), name, contentType: type }, null, 2));
  } else if (cmd === "read" && a) {
    const f = await client.download(a);
    const sha256 = new Bun.CryptoHasher("sha256").update(f.data).digest("hex");
    if (b) await Bun.write(b, f.data);
    console.log(JSON.stringify({ reference: a, url: swarmLink(cfg, a), name: f.name, contentType: f.contentType, bytes: f.data.byteLength, sha256, savedTo: b ?? null }, null, 2));
  } else {
    console.error("usage: bun src/swarm.ts upload <file> [content-type] | read <reference> [out-file]");
    process.exit(2);
  }
}

if (import.meta.main) {
  cli(process.argv.slice(2)).catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
}
