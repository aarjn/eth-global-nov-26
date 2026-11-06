// Rate-limit breaker: after one 429 the client fails fast instead of extending the lockout.
import { afterAll, expect, test } from "bun:test";
import { makePublicClient, rateLimitState, resetRateLimit } from "../src/client";

let hits = 0;
const server = Bun.serve({ port: 0, fetch() { hits++; return new Response(JSON.stringify({ error: "ANON_COST_LIMITED" }), { status: 429 }); } });
afterAll(() => { server.stop(true); resetRateLimit(); });

test("a 429 opens the breaker; later calls never reach the network", async () => {
  const realFetch = globalThis.fetch;
  // Point the guarded fetch at the local 429 server, whatever URL viem asks for.
  globalThis.fetch = Object.assign((_i: unknown, init?: RequestInit) => realFetch(server.url, init), { preconnect: realFetch.preconnect }) as typeof fetch;
  try {
    const c = makePublicClient({ ARKIV_ACCESS_KEY: "x" });
    await expect(c.getBlockNumber()).rejects.toThrow();
    const after = hits;
    expect(after).toBe(1);
    expect(rateLimitState()).toMatchObject({ limited: true, detail: "ANON_COST_LIMITED" });
    await expect(c.getBlockNumber()).rejects.toThrow();
    expect(hits).toBe(after);
  } finally {
    globalThis.fetch = realFetch;
  }
});
