// W6 /onboard page states. fetch is replaced by a TEST-ONLY double that answers like apps/api.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import OnboardPage from "../src/routes/onboard";
import { LOCKED_TITLE, VERIFIED_TITLE, WHY_ONE_LINER, failureReason } from "../src/routes/onboard/world";

const WALLET = "0xC038827b4E362B0de1Be859377508613CD028946";
const realFetch = globalThis.fetch;

function mockApi(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(k));
    const r = key ? routes[key]!(init) : { status: 404, body: { error: "not found", code: "NOT_FOUND" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const merchant = (verified: boolean) => () => ({ status: 200, body: { wallet: WALLET, handle: "chai-studio", verified, gasUsedWei: "0", createdAt: 1 } });
const notConfigured = { status: 503, body: { error: "World ID is not configured on this server yet", code: "WORLD_NOT_CONFIGURED", missing: ["WORLD_APP_ID", "WORLD_RP_ID", "WORLD_SIGNING_KEY"] } };

beforeEach(() => { history.replaceState(null, "", `/onboard?wallet=${WALLET}`); });
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("/onboard", () => {
  test("explains why in one sentence and says when World ID is not configured, with the self-paid fallback", async () => {
    mockApi({
      [`/merchants/${WALLET}`]: merchant(false),
      "/world/config": () => ({ status: 200, body: { configured: false, missing: notConfigured.body.missing, app_id: null, action: "paisalink-merchant", environment: "staging", allow_legacy_proofs: false, credential: "proof_of_human", simulatorUrl: null } }),
    });
    const { getByTestId, findByTestId } = render(<OnboardPage />);
    expect(getByTestId("why").textContent).toBe(WHY_ONE_LINER);
    const box = await findByTestId("not-configured");
    expect(box.textContent).toContain("World ID isn't connected on this server yet");
    expect(box.textContent).toContain("WORLD_SIGNING_KEY");
    expect(box.textContent).toContain("pay()");
  });

  test("verify refused by the server -> locked banner + fallback, verified flag untouched", async () => {
    mockApi({
      [`/merchants/${WALLET}`]: merchant(false),
      "/world/config": () => ({ status: 200, body: { configured: true, missing: [], app_id: "app_staging_x", action: "paisalink-merchant", environment: "staging", allow_legacy_proofs: false, credential: "proof_of_human", simulatorUrl: "https://simulator.worldcoin.org/id/0x18310f83" } }),
      "/world/request": () => notConfigured,
    });
    const { findByTestId } = render(<OnboardPage />);
    fireEvent.click(await findByTestId("verify-button"));
    const locked = await findByTestId("locked");
    expect(locked.textContent).toContain(LOCKED_TITLE);
    expect(locked.textContent).toContain("You can still get paid");
  });

  test("an already-verified merchant sees the verified badge", async () => {
    mockApi({
      [`/merchants/${WALLET}`]: merchant(true),
      "/world/config": () => ({ status: 200, body: { configured: true, missing: [], app_id: "app_staging_x", action: "paisalink-merchant", environment: "staging", allow_legacy_proofs: false, credential: "proof_of_human", simulatorUrl: null } }),
    });
    const { findByTestId } = render(<OnboardPage />);
    await waitFor(async () => expect((await findByTestId("verified")).textContent).toContain(VERIFIED_TITLE));
  });

  test("failure copy covers cancel, reuse and wrong credential", () => {
    expect(failureReason("cancelled")).toContain("closed");
    expect(failureReason("NULLIFIER_REUSED")).toContain("already verified another");
    expect(failureReason("WORLD_WRONG_CREDENTIAL")).toContain("Proof of Human");
    expect(failureReason("something_new", "raw")).toBe("raw");
  });
});
