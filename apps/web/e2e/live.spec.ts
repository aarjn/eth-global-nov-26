// Full live flow on Whitechain testnet. Gated: E2E_LIVE=1. Needs (see docs/verification.md):
//   - contracts deployed (PaymentRouter + InvoiceNote) and the API restarted so /config shows them
//   - relayer funded with WBT, deployer funded with WBT + test USDT (for /demo/fund and the investor desk)
//   - Arkiv writer funded + ARKIV_ACCESS_KEY set
//   - the merchant must be World-verified, or the relay refuses with MERCHANT_NOT_VERIFIED. The staging simulator gives
//     one nullifier per action, so a fresh browser merchant cannot verify: the merchant contexts load the verified
//     demo merchant key (DEMO_MERCHANT_PRIVATE_KEY, from .env.local via `bun --env-file`) into the browser's
//     "testnet demo wallet" slot with a TEST-ONLY addInitScript. App code is unchanged. Payer and investor contexts
//     stay fresh, so their demo wallets are new on every run.
//   - small amounts (test USDT is scarce): invoice A 4.90, partial refund 0.90, invoice B 1.00 sold for 0.95 with a
//     "2 minutes (demo)" maturity. The faucet sends each fresh wallet only what it needs (DEMO_FUND_USDT=4.90 cap):
//     payer A 4.90 + investor 0.95 + payer B 1.00 = 6.85 test USDT from the deployer. One full run per pool top-up.
// Desktop project only: it is one long serial scenario.
import { expect, test, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { readFile } from "node:fs/promises";
import { API_URL, LIVE, apiGet, shot } from "./helpers";

test.skip(!LIVE, "set E2E_LIVE=1 to run the live testnet flow");
test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60_000);
// Never record a trace here: it would capture the addInitScript argument (the merchant key) into test-results/.
test.use({ trace: "off", video: "off" });

const DEMO_MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946";
const MERCHANT_WALLET_SLOT = "paisalink.demo-wallet.merchant"; // apps/web/src/lib/wallet.ts keyName("merchant")
const AMOUNT_A = "4.90";
const REFUND_A = "0.90";
const AMOUNT_B = "1.00";
const PRICE_B = "0.95";
const FAUCET_NEED = 4.9 + 0.95 + 1.0;

/** DEMO_MERCHANT_PRIVATE_KEY as 0x-hex, or null. Never printed: errors only name the variable. */
function merchantKey(): `0x${string}` | null {
  const raw = process.env.DEMO_MERCHANT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const k = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? k : null;
}

const handle = "priya.designs"; // only used if the demo merchant has no profile yet
const run = Date.now().toString(36);
const memoA = `e2e invoice A ${run}`;
const memoB = `e2e invoice B ${run}`;
let payUrl = "";   // invoice A
let invoiceA = "";
let invoiceB = "";

async function createInvoice(page: Page, amount: string, memo: string) {
  await page.goto("/merchant");
  const setup = page.getByRole("button", { name: "Create profile" });
  if (await setup.isVisible().catch(() => false)) {
    await page.getByPlaceholder("priya.designs").fill(handle);
    await setup.click();
    await expect(page.getByRole("heading", { name: `@${handle}` })).toBeVisible();
  }
  await page.getByLabel("Amount in USDT").fill(amount);
  await page.getByPlaceholder("Logo design, 2 revisions").fill(memo);
  await page.getByRole("button", { name: "Create payment link" }).click();
  const link = page.getByTestId("pay-link");
  await expect(link).toBeVisible({ timeout: 60_000 }); // on-chain createInvoice + Arkiv write
  const url = (await link.textContent())!.trim();
  return { url, id: url.split("/pay/")[1] };
}

async function payInvoice(page: Page, url: string, info: Parameters<typeof shot>[1], tag: string) {
  await page.goto(url);
  await expect(page.getByTestId("amount")).toBeVisible();
  // fresh demo payer is empty: "Get test USDT" appears instead of the pay button
  const get = page.getByRole("button", { name: "Get test USDT" });
  // Wait for the payer balance to load ("Balance: …" -> "Balance: 0.00 USDT") before deciding whether to fund.
  await expect(page.getByText(/Balance: \d/)).toBeVisible({ timeout: 60_000 });
  if (await get.isVisible()) {
    await get.click();
    await expect(page.getByTestId("pay-button")).toBeEnabled({ timeout: 90_000 });
  }
  await shot(page, info, `${tag}-pay`);
  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 120_000 });
  await shot(page, info, `${tag}-paid`);
}

test.describe("live flow", () => {
  test.beforeEach(async ({ context }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    // TEST-ONLY: the default context is the merchant's browser. Put the verified demo merchant key in the slot the app
    // reads (lib/wallet.ts) before any app script runs. Contexts made with browser.newContext() are not touched.
    const k = merchantKey();
    if (!k) throw new Error("DEMO_MERCHANT_PRIVATE_KEY missing or malformed (run with bun --env-file=../../.env.local)");
    await context.addInitScript(([slot, key]) => { window.localStorage.setItem(slot, key); }, [MERCHANT_WALLET_SLOT, k] as const);
  });

  test("0. preconditions", async () => {
    const k = merchantKey();
    expect(k, "DEMO_MERCHANT_PRIVATE_KEY set").toBeTruthy();
    expect(privateKeyToAccount(k!).address, "key is the verified demo merchant").toBe(DEMO_MERCHANT);
    const cfg = await apiGet<{ paymentRouter: string | null; invoiceNote: string | null; gasless: boolean; demoFaucet: { amountUsdt: string } | null }>("/config");
    expect(cfg.body.paymentRouter, "PaymentRouter deployed").toBeTruthy();
    expect(cfg.body.invoiceNote, "InvoiceNote deployed").toBeTruthy();
    expect(cfg.body.gasless, "relayer configured").toBe(true);
    expect(Number(cfg.body.demoFaucet?.amountUsdt), "faucet cap covers invoice A").toBeGreaterThanOrEqual(Number(AMOUNT_A));
    const h = await apiGet<{ ok: boolean; demoFaucet: { balanceUsdt: string } | null }>("/health");
    expect(h.body.ok, "/health ok").toBe(true);
    expect(Number(h.body.demoFaucet?.balanceUsdt), "faucet holds payer A + investor + payer B").toBeGreaterThanOrEqual(FAUCET_NEED - 1e-9);
    const m = await apiGet<{ verified: boolean }>(`/merchants/${DEMO_MERCHANT}`);
    expect(m.body?.verified, "demo merchant is World-verified").toBe(true);
  });

  test("1. create invoice A", async ({ page }, info) => {
    const r = await createInvoice(page, AMOUNT_A, memoA);
    payUrl = r.url; invoiceA = r.id;
    expect(invoiceA).toMatch(/^0x[0-9a-fA-F]{64}$/);
    await shot(page, info, "live-1-created");
  });

  test("2-4. get test USDT, pay gaslessly, dashboard shows Paid", async ({ browser }, info) => {
    // Same browser context would share demo wallets; use a separate context for the customer (phone-like).
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const payer = await ctx.newPage();
    await payInvoice(payer, payUrl, info, "live-2");
    await expect(payer.getByText("No fees were charged to you.")).toBeVisible();
    await ctx.close();
    const inv = await apiGet<{ state: string; payTx?: string }>(`/invoices/${invoiceA}`);
    expect(["paid", "refunded"]).toContain(inv.body.state);
    expect(inv.body.payTx).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  test("4. dashboard shows Paid (live update)", async ({ page }, info) => {
    await page.goto("/merchant");
    const row = page.getByTestId("invoice-row").filter({ hasText: memoA });
    await expect(row).toHaveAttribute("data-state", "paid", { timeout: 30_000 });
    await expect(row.getByText("Paid", { exact: true })).toBeVisible();
    await shot(page, info, "live-4-dashboard-paid");
  });

  test("5. partial refund", async ({ page }, info) => {
    await page.goto("/merchant");
    const row = page.getByTestId("invoice-row").filter({ hasText: memoA });
    await row.getByRole("button", { name: "Refund", exact: true }).click();
    await row.getByLabel("Refund amount").fill(REFUND_A);
    await row.getByRole("button", { name: /^Refund 0\.90?$/ }).click();
    await expect(row.getByText(/Refunded/)).toBeVisible({ timeout: 90_000 });
    await expect(row.getByRole("link", { name: "Refund transaction" })).toHaveAttribute("href", /\/tx\/0x[0-9a-fA-F]{64}/);
    await shot(page, info, "live-5-refund");
  });

  test("6. CSV download", async ({ page }) => {
    await page.goto("/merchant");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    const path = await dl.path();
    const text = (await readFile(path, "utf8")).replace(/^﻿/, "");
    expect(text.split("\n").length, "header + at least one row").toBeGreaterThan(1);
    expect(text).toContain(invoiceA);
    void API_URL;
  });

  test("7. publish PDF to Swarm", async ({ page }, info) => {
    await page.goto("/merchant");
    const row = page.getByTestId("invoice-row").filter({ hasText: memoA });
    await row.getByRole("button", { name: "Publish PDF to Swarm" }).click();
    const link = row.getByTestId("swarm-link");
    await expect(link).toBeVisible({ timeout: 120_000 });
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const res = await fetch(href!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("pdf");
    await shot(page, info, "live-7-swarm");
  });

  test("8. finance invoice B: sell, investor funds, customer pays into escrow", async ({ page, browser }, info) => {
    test.setTimeout(14 * 60_000); // 5-minute demo maturity plus funding, escrow pay and settle
    const r = await createInvoice(page, AMOUNT_B, memoB);
    invoiceB = r.id;
    await page.goto(`/invest?invoice=${invoiceB}`);
    await expect(page.getByTestId("sell-summary")).toBeVisible();
    await page.locator("select").selectOption({ label: "5 minutes (demo)" });
    // the sell UI takes a price (default 97.5% of face); set it to 0.95 for face 1.00
    await page.getByLabel("Face value (USDT)").fill(AMOUNT_B);
    await page.getByLabel("Price (USDT)").fill(PRICE_B);
    await expect(page.getByTestId("sell-summary")).toContainText("price $0.95");
    await page.getByRole("button", { name: "Sell for 0.95 USDT" }).click();
    const listed = page.getByText(/Listed as note #\d+/);
    await expect(listed).toBeVisible({ timeout: 120_000 });
    const noteId = Number((await listed.textContent())!.match(/note #(\d+)/)![1]);
    await shot(page, info, "live-8-listed");

    // investor desk: allowlist + gas + test USDT, then fund (separate context = separate investor wallet)
    const inv = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await inv.goto(`/invest`);
    // The note card: the innermost div holding this note's number and its escrow line.
    const card = inv.locator("div").filter({ hasText: new RegExp(`Note #${noteId}(?!\\d)`) }).filter({ hasText: "Escrow for settlement" }).last();
    // Wait for the note to be listed before the desk runs: the page asks the faucet for the newest note's price
    // (0.95), so a list that has not loaded yet would draw the full faucet cap.
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByRole("button", { name: "Fund for 0.95 USDT" })).toBeVisible();
    await inv.getByRole("button", { name: /Set up demo investor/i }).click();
    await expect(inv.getByText(/0\.95 test USDT/)).toBeVisible({ timeout: 120_000 });
    await expect(card.getByRole("button", { name: "Fund for 0.95 USDT" })).toBeEnabled({ timeout: 30_000 });
    await card.getByRole("button", { name: "Fund for 0.95 USDT" }).click();
    await expect(card.getByText("Funded the note")).toBeVisible({ timeout: 120_000 });
    await shot(inv, info, "live-8-funded");

    // the customer's payment goes to the note escrow
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await payInvoice(await ctx.newPage(), r.url, info, "live-8");
    await ctx.close();

    // 9. rule-refusal: the contract must revert and the UI must show the reason
    // (before maturity: settle early / transfer to a stranger; if the 2 minutes are already up: transfer after maturity)
    await inv.reload();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole("button", { name: /^(Try to settle early|Try a transfer to a non-allowlisted wallet|Try a transfer after maturity)$/ }).first().click();
    await expect(card.getByTestId("revert")).toContainText(/Reverted:/, { timeout: 60_000 });
    await shot(inv, info, "live-9-revert");

    // 10. settle after maturity (2 min demo maturity)
    const settle = card.getByRole("button", { name: "Settle: pay 1 USDT to the holder" });
    await expect(settle).toBeVisible({ timeout: 4 * 60_000 });
    await expect(settle).toBeEnabled({ timeout: 60_000 });
    await settle.click();
    await expect(card.getByText("Settled in USDT").first()).toBeVisible({ timeout: 120_000 });
    await shot(inv, info, "live-10-settled");
  });
});
