// Full live flow on Whitechain testnet. Gated: E2E_LIVE=1. Needs (see docs/verification.md):
//   - contracts deployed (PaymentRouter + InvoiceNote) and the API restarted so /config shows them
//   - relayer funded with WBT, deployer funded with WBT + test USDT (for /demo/fund and the investor desk)
//   - Arkiv writer funded + ARKIV_ACCESS_KEY set
//   - the browser's demo merchant must be World-verified (or the gasless step is refused, which the test reports)
// The browser-local demo wallets (merchant/payer/investor) are created fresh in a new context, so each run is independent.
// Desktop project only: it is one long serial scenario.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { API_URL, LIVE, apiGet, shot } from "./helpers";

test.skip(!LIVE, "set E2E_LIVE=1 to run the live testnet flow");
test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60_000);

const handle = `e2e${Date.now().toString(36)}`;
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
  if (await get.isVisible({ timeout: 8000 }).catch(() => false)) {
    await get.click();
    await expect(page.getByTestId("pay-button")).toBeEnabled({ timeout: 90_000 });
  }
  await shot(page, info, `${tag}-pay`);
  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 120_000 });
  await shot(page, info, `${tag}-paid`);
}

test.describe("live flow", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "desktop only"); });

  test("0. preconditions", async () => {
    const cfg = await apiGet<{ paymentRouter: string | null; invoiceNote: string | null; gasless: boolean }>("/config");
    expect(cfg.body.paymentRouter, "PaymentRouter deployed").toBeTruthy();
    expect(cfg.body.invoiceNote, "InvoiceNote deployed").toBeTruthy();
    const h = await apiGet<{ ok: boolean }>("/health");
    expect(h.body.ok, "/health ok").toBe(true);
  });

  test("1. create invoice A", async ({ page }, info) => {
    const r = await createInvoice(page, "5", "e2e invoice A");
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
    const row = page.getByTestId("invoice-row").filter({ hasText: "e2e invoice A" });
    await expect(row).toHaveAttribute("data-state", "paid", { timeout: 30_000 });
    await expect(row.getByText("Paid", { exact: true })).toBeVisible();
    await shot(page, info, "live-4-dashboard-paid");
  });

  test("5. partial refund", async ({ page }, info) => {
    await page.goto("/merchant");
    const row = page.getByTestId("invoice-row").filter({ hasText: "e2e invoice A" });
    await row.getByRole("button", { name: "Refund", exact: true }).click();
    await row.getByLabel("Refund amount").fill("2");
    await row.getByRole("button", { name: /^Refund 2/ }).click();
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
    const row = page.getByTestId("invoice-row").filter({ hasText: "e2e invoice A" });
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
    const r = await createInvoice(page, "20", "e2e invoice B");
    invoiceB = r.id;
    await page.goto(`/invest?invoice=${invoiceB}`);
    await expect(page.getByTestId("sell-summary")).toBeVisible();
    await page.locator("select").selectOption({ label: "2 minutes (demo)" });
    await page.getByRole("button", { name: /^Sell for/ }).click();
    await expect(page.getByText(/Listed as note #/)).toBeVisible({ timeout: 120_000 });
    await shot(page, info, "live-8-listed");

    // investor desk: allowlist + gas + test USDT, then fund (separate context = separate investor wallet)
    const inv = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await inv.goto(`/invest`);
    await inv.getByRole("button", { name: /Set up demo investor/i }).click();
    await expect(inv.getByText(/Allowlisted|Test WBT for gas|test USDT/).first()).toBeVisible({ timeout: 120_000 });
    const card = inv.locator("article, li, div").filter({ hasText: /e2e invoice B|Escrow for settlement/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await inv.getByRole("button", { name: /^Fund for/ }).first().click();
    await expect(inv.getByText("Funded the note")).toBeVisible({ timeout: 120_000 });
    await shot(inv, info, "live-8-funded");

    // the customer's payment goes to the note escrow
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await payInvoice(await ctx.newPage(), r.url, info, "live-8");
    await ctx.close();

    // 9. rule-refusal: the contract must revert and the UI must show the reason
    await inv.reload();
    await inv.getByRole("button", { name: /Try to settle early|Try a transfer to a non-allowlisted wallet/ }).first().click();
    await expect(inv.getByTestId("revert")).toContainText(/Reverted:/, { timeout: 60_000 });
    await shot(inv, info, "live-9-revert");

    // 10. settle after maturity (2 min demo maturity)
    const settle = inv.getByRole("button", { name: /^Settle: pay/ });
    await expect(settle).toBeVisible({ timeout: 4 * 60_000 });
    await settle.click();
    await expect(inv.getByText("Settled in USDT")).toBeVisible({ timeout: 120_000 });
    await shot(inv, info, "live-10-settled");
  });
});
