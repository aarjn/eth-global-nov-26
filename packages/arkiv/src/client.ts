// Arkiv client factory for the Rabdi testnet, with a guard against the anonymous-endpoint lockout.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { getAddress, http, webSocket, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ARKIV_CHAIN_ID = 7794095;
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
/** The PaisaLink Arkiv writer (deployer wallet). Reads filter on ownedBy(WRITER) for trust. */
export const WRITER_ADDRESS: Address = "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb";

export const explorerEntity = (key: string) => `${ARKIV_EXPLORER}/entity/${key}`;
export const explorerArkivTx = (hash: string) => `${ARKIV_EXPLORER}/tx/${hash}`;
export const explorerArkivAddress = (a: string) => `${ARKIV_EXPLORER}/address/${a}`;

/** Env read by createArkivStore. All optional: with nothing set you get a read-only, anonymous client. */
export interface ArkivEnv {
  /** Writer key. Without it the store is read-only. */
  ARKIV_PRIVATE_KEY?: string | undefined;
  /** Hub access key (https://hub.arkiv.network/access-keys). Empty = public, heavily rate-limited endpoint. */
  ARKIV_ACCESS_KEY?: string | undefined;
  /** Whose entities to trust on reads. Defaults to the writer key's address, else WRITER_ADDRESS. */
  ARKIV_WRITER_ADDRESS?: string | undefined;
  /** Set to "1" to allow writes without an access key (risks the 429 ANON_COST_LIMITED lockout). */
  ARKIV_ALLOW_ANON_WRITES?: string | undefined;
}

/** Thrown when the Arkiv RPC answered 429, and for every call made while the breaker is open. */
export class ArkivRateLimitedError extends Error {
  constructor(readonly until: number, detail = "") {
    super(
      `Arkiv RPC rate limited (HTTP 429${detail ? `, ${detail}` : ""}); not calling it again until ` +
        `${new Date(until).toISOString()}. Use an access key from https://hub.arkiv.network/access-keys.`,
    );
    this.name = "ArkivRateLimitedError";
  }
}

/** Process-wide breaker: after a 429, every Arkiv HTTP call fails fast instead of extending the lockout. */
const breaker = { until: 0, detail: "" };
const DEFAULT_LOCKOUT_MS = 30 * 60 * 1000; // observed ~27 min (arkiv-sdk-js #126)

/** Test helper: close the breaker. */
export function resetRateLimit() {
  breaker.until = 0;
  breaker.detail = "";
}

export function rateLimitState() {
  return { limited: Date.now() < breaker.until, until: breaker.until, detail: breaker.detail };
}

const guardedFetch: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (Date.now() < breaker.until) throw new ArkivRateLimitedError(breaker.until, breaker.detail);
    const res = await fetch(input, init);
    // Some gateways answer HTTP 200 with a JSON-RPC error {code: 429}; error bodies are small, so
    // only short responses are inspected.
    const len = Number(res.headers.get("content-length") ?? "0");
    if (res.status === 200 && len > 0 && len < 2048) {
      const text = await res.clone().text().catch(() => "");
      if (/"code"\s*:\s*429\b|ANON_COST_LIMITED/.test(text)) {
        breaker.detail = text.includes("ANON_COST_LIMITED") ? "ANON_COST_LIMITED" : "JSON-RPC 429";
        breaker.until = Date.now() + DEFAULT_LOCKOUT_MS;
        throw new ArkivRateLimitedError(breaker.until, breaker.detail);
      }
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after"));
      const body = await res.clone().text().catch(() => "");
      breaker.detail = (body.match(/[A-Z_]{6,}/)?.[0] ?? "").slice(0, 40);
      breaker.until = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : DEFAULT_LOCKOUT_MS);
      throw new ArkivRateLimitedError(breaker.until, breaker.detail);
    }
    return res;
  },
  { preconnect: fetch.preconnect },
);

export function arkivChain(env: ArkivEnv) {
  return rabdi({ accessKey: env.ARKIV_ACCESS_KEY ?? "" });
}

export function makePublicClient(env: ArkivEnv) {
  return createPublicClient({ chain: arkivChain(env), transport: http(undefined, { fetchFn: guardedFetch, retryCount: 1 }) });
}

/** WebSocket client for watchEntityEvents (push, not polling). */
export function makeWsClient(env: ArkivEnv) {
  return createPublicClient({ chain: arkivChain(env), transport: webSocket(undefined, { keepAlive: true, reconnect: true }) });
}

export function makeWalletClient(env: ArkivEnv) {
  if (!env.ARKIV_PRIVATE_KEY) return undefined;
  const pk = (env.ARKIV_PRIVATE_KEY.startsWith("0x") ? env.ARKIV_PRIVATE_KEY : `0x${env.ARKIV_PRIVATE_KEY}`) as Hex;
  return createWalletClient({
    chain: arkivChain(env),
    transport: http(undefined, { fetchFn: guardedFetch, retryCount: 0 }),
    account: privateKeyToAccount(pk),
  });
}

export function writerAddress(env: ArkivEnv): Address {
  if (env.ARKIV_WRITER_ADDRESS) return getAddress(env.ARKIV_WRITER_ADDRESS);
  const w = makeWalletClient(env);
  return w ? w.account.address : WRITER_ADDRESS;
}

export type ArkivPublicClient = ReturnType<typeof makePublicClient>;
export type ArkivWalletClient = NonNullable<ReturnType<typeof makeWalletClient>>;
