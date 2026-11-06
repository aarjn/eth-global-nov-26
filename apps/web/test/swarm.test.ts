import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "../src/lib/api";
import { claimAutoPublish, publishInvoicePdf } from "../src/lib/swarm";

const ID = ("0x" + "12".repeat(32)) as `0x${string}`;
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; localStorage.clear(); });
const fakeFetch = (status: number, body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
};

describe("Swarm PDF publishing (test-only fake fetch)", () => {
  test("returns the url from a fresh upload", async () => {
    fakeFetch(201, { swarmRef: "ab".repeat(32), url: "https://gw.example/bzz/abab/" });
    expect(await publishInvoicePdf(ID)).toEqual({ swarmRef: "ab".repeat(32), url: "https://gw.example/bzz/abab/", cached: undefined });
  });

  test("cached answer without url falls back to the gateway url of the known ref", async () => {
    fakeFetch(200, { cached: true });
    const r = await publishInvoicePdf(ID, "cd".repeat(32));
    expect(r.url).toContain("cd".repeat(32));
    expect(r.cached).toBe(true);
  });

  test("503 SWARM_NOT_CONFIGURED and 429 surface as ApiError codes", async () => {
    fakeFetch(503, { error: "swarm not configured", code: "SWARM_NOT_CONFIGURED" });
    await expect(publishInvoicePdf(ID)).rejects.toMatchObject({ code: "SWARM_NOT_CONFIGURED", status: 503 });
    fakeFetch(429, { error: "slow down", code: "RATE_LIMITED" });
    const e = await publishInvoicePdf(ID).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(429);
  });

  test("auto-publish is claimed once per invoice", () => {
    expect(claimAutoPublish(ID)).toBe(true);
    expect(claimAutoPublish(ID.toUpperCase().replace("0X", "0x"))).toBe(false);
  });
});
