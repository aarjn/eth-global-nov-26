// Live World ID check against World's real staging environment, with the World ID simulator as the wallet.
// Gated: E2E_WORLD=1. Needs E2E_BASE_URL (web) and E2E_API_URL (API) pointing at a server configured with the World keys.
// Never sets `verified` by hand: every verification goes through IDKit -> simulator -> POST /world/verify -> World -> Arkiv.
//   E2E_WORLD=1 E2E_BASE_URL=http://100.125.124.63:5173 E2E_API_URL=http://100.125.124.63:8787 \
//     bun node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts world-live --project=desktop
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { join } from "node:path";
import { API_URL } from "./helpers";

test.skip(process.env.E2E_WORLD !== "1", "set E2E_WORLD=1 to run the live World ID staging check");
test.describe.configure({ mode: "serial" });
test.setTimeout(3 * 60_000);

const SHOTS = join(import.meta.dir, "screenshots");
const stamp = Date.now().toString(36);
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const log = (...a: unknown[]) => console.log("[world-live]", ...a);

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const newMerchant = async (tag: string) => {
  const wallet = fresh();
  const r = await api("POST", "/merchants", { wallet, handle: `w6${tag}${stamp}` });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return wallet;
};

/** Open /onboard, press the button, return the "Use the simulator" connect URL from the IDKit dialog. */
async function startOnboard(page: Page, wallet: string) {
  await page.goto(`/onboard?wallet=${wallet}`, { waitUntil: "networkidle" });
  await page.getByTestId("verify-button").click();
  const link = page.getByRole("link", { name: "Use the simulator" });
  await link.waitFor();
  return (await link.getAttribute("href"))!;
}
/**
 * Drive the simulator like a phone: open it, pick a test identity (Settings > Switch test identity), press "Paste code",
 * paste the connect URL that IDKit shows, and wait for the "Complete verification" sheet.
 * The five simulator identities are deterministic; identity #4 is the default and the one the demo merchant used.
 */
async function openSimulator(ctx: BrowserContext, connectUrl: string, identity: number) {
  const sim = await ctx.newPage();
  await sim.goto("https://simulator.worldcoin.org/", { waitUntil: "networkidle" });
  await sim.getByText("Paste code").waitFor();
  if (identity !== 4) {
    await sim.locator("button").nth(1).click();           // avatar -> Settings
    await sim.getByText("Switch test identity").click();
    await sim.getByText(`Identity #${identity}`, { exact: true }).click();
    await sim.getByText("Paste code").waitFor();
  }
  await sim.getByRole("button", { name: "Paste code" }).click();
  await sim.locator("input").fill(new URL(connectUrl).searchParams.get("connect_url")!); // filling submits
  await sim.getByText("Complete verification").waitFor({ timeout: 30_000 });
  return sim;
}

// FINDING: in World ID 4.0 mode the simulator returns the SAME proof_of_human nullifier for all of its identities (#0-#5,
// and after "Reset simulator"), so against one RP + action it can verify exactly one merchant wallet, ever.
// The demo merchant takes that one slot; every later simulator run is, correctly, a replay (409 NULLIFIER_REUSED).
const DEMO = process.env.E2E_DEMO_MERCHANT || "0xC038827b4E362B0de1Be859377508613CD028946";
let replayBody: unknown;

test.describe("World ID live (staging + simulator)", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "desktop only"); });

  test("a. success: simulator approves the demo merchant, verified on Arkiv", async ({ page, browser }) => {
    const before = (await api("GET", `/merchants/${DEMO}`)).body;
    log("demo merchant before:", JSON.stringify(before));
    if (!before.verified) {
      const t0 = Date.now();
      const verifyResp = page.waitForResponse((r) => r.url().includes("/world/verify"), { timeout: 120_000 });
      const connect = await startOnboard(page, DEMO);
      const ctx = await browser.newContext({ viewport: { width: 900, height: 950 } });
      const sim = await openSimulator(ctx, connect, 4);
      log("simulator showing Complete verification after ms", Date.now() - t0);
      await sim.getByRole("button", { name: "Continue" }).last().click();
      const resp = await verifyResp;
      log("POST /world/verify", resp.status(), "after ms", Date.now() - t0, await resp.text());
      expect(resp.status()).toBe(200);
      await expect(page.getByTestId("verified")).toBeVisible({ timeout: 30_000 });
      log("badge visible after ms", Date.now() - t0);
      await ctx.close();
    } else {
      log("demo merchant already verified by an earlier real run; checking persisted state instead of re-running");
      await page.goto(`/onboard?wallet=${DEMO}`, { waitUntil: "networkidle" });
    }
    await expect(page.getByTestId("verified")).toContainText("Verified human: gas-sponsored checkout on");
    await page.screenshot({ path: join(SHOTS, "world-success.png"), fullPage: true });
    const m = await api("GET", `/merchants/${DEMO}`);
    log("GET merchant", JSON.stringify(m.body));
    expect(m.body.verified).toBe(true);
  });

  test("c. replay: same human on a fresh wallet via the UI, then the same proof again, both 409", async ({ page, browser }) => {
    const other = await newMerchant("rp");
    page.on("request", (r) => { if (r.url().includes("/world/verify")) replayBody = r.postDataJSON(); });
    const verifyResp = page.waitForResponse((r) => r.url().includes("/world/verify"), { timeout: 120_000 });
    const connect = await startOnboard(page, other);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const sim = await openSimulator(ctx, connect, 4);
    await sim.getByRole("button", { name: "Continue" }).last().click();
    const resp = await verifyResp;
    log("fresh wallet, same human ->", resp.status(), await resp.text());
    expect(resp.status()).toBe(409);
    await expect(page.getByTestId("locked")).toBeVisible({ timeout: 30_000 });
    log("locked text:", (await page.getByTestId("locked").innerText()).slice(0, 300).replace(/\n/g, " | "));
    await page.screenshot({ path: join(SHOTS, "world-replay.png"), fullPage: true });
    await ctx.close();
    expect((await api("GET", `/merchants/${other}`)).body.verified).toBe(false);
    // submit the exact same proof body again
    const again = await api("POST", "/world/verify", replayBody);
    log("same proof body again ->", again.status, JSON.stringify(again.body));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("NULLIFIER_REUSED");
  });

  test("b. cancel: simulator cancels, verified stays false, relay says MERCHANT_NOT_VERIFIED", async ({ page, browser }) => {
    const wallet = await newMerchant("no");
    const connect = await startOnboard(page, wallet);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const sim = await openSimulator(ctx, connect, 2);
    await sim.getByRole("button", { name: "Cancel" }).click();
    // FINDING: the simulator's Cancel sends nothing back over the bridge, so IDKit stays on "Connecting... Please continue in app"
    // (the real World App reports verification_rejected). The user's way out is the dialog's own close button.
    await page.waitForTimeout(8000);
    await expect(page.getByText("Connecting...")).toBeVisible();
    log("8s after simulator Cancel the dialog still says: Connecting... Please continue in app");
    await page.screenshot({ path: join(SHOTS, "world-cancel-pending.png"), fullPage: true });
    await page.getByRole("dialog").getByRole("button").first().click();
    await expect(page.getByTestId("locked")).toBeVisible({ timeout: 30_000 });
    log("locked text:", (await page.getByTestId("locked").innerText()).slice(0, 300).replace(/\n/g, " | "));
    await expect(page.getByTestId("locked")).toContainText("Gas-sponsored checkout locked: verification not completed");
    await expect(page.getByTestId("fallback")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "world-cancel.png"), fullPage: true });
    await ctx.close();
    const m = await api("GET", `/merchants/${wallet}`);
    log("GET merchant", JSON.stringify(m.body));
    expect(m.body.verified).toBe(false);
    // gasless relay for this unverified merchant: create an invoice (allowed), then try to relay a payment
    const inv = await api("POST", "/invoices", { merchant: wallet, amountUsdt: "1", dueAt: Math.floor(Date.now() / 1000) + 7 * 86400, memo: "w6 unverified" });
    log("create invoice ->", inv.status, JSON.stringify(inv.body).slice(0, 200));
    expect(inv.status).toBe(201);
    const router = (await api("GET", "/config")).body.paymentRouter;
    const relay = await api("POST", "/relay", {
      invoiceId: inv.body.invoiceId,
      authorization: { from: fresh(), to: router, value: "1000000", validAfter: 0, validBefore: Math.floor(Date.now() / 1000) + 300, nonce: "0x" + "00".repeat(32) },
      signature: "0x" + "11".repeat(65),
    });
    log("relay ->", relay.status, JSON.stringify(relay.body));
    expect(relay.body.code).toBe("MERCHANT_NOT_VERIFIED");
  });
});
