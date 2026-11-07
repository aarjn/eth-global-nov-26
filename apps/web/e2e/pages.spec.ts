// Offline-safe checks that work before the contracts are deployed or the wallets are funded.
// Assertions on the "not switched on yet" states apply only while /config reports no contract;
// once deployed they assert the live state instead, so this file stays green before and after deploy.
import { expect, test } from "@playwright/test";
import { apiGet, noHorizontalScroll, notesOn, paymentsOn, shot, watchErrors } from "./helpers";

const ZERO_ID = "0x" + "11".repeat(32);

test.describe("pages render", () => {
  test("home", async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Get paid from abroad");
    await expect(page.getByRole("link", { name: "Open my dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "See an example shop" })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, info, "home");
    expect(errors).toEqual([]);
  });

  test("merchant dashboard + payments-off banner", async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto("/merchant");
    await expect(page.getByText("Merchant dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "New invoice" }).or(page.getByText("Set up your business"))).toBeVisible();
    await expect(page.getByText("Export CSV")).toBeVisible();
    if (!(await paymentsOn())) {
      await expect(page.getByText("Payments are not switched on yet.")).toBeVisible();
    } else {
      await expect(page.getByText("Payments are not switched on yet.")).toHaveCount(0);
    }
    await noHorizontalScroll(page);
    await shot(page, info, "merchant");
    expect(errors).toEqual([]);
  });

  test("invest + financing-off banner", async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto("/invest");
    await expect(page.getByRole("heading", { name: /Buy invoices, get paid in USDT at maturity/ })).toBeVisible();
    if (!(await notesOn())) {
      await expect(page.getByText("Invoice financing is not switched on yet.")).toBeVisible();
    }
    await noHorizontalScroll(page);
    await shot(page, info, "invest");
    expect(errors).toEqual([]);
  });

  test("onboard: World not configured", async ({ page }, info) => {
    const errors = watchErrors(page);
    const cfg = await apiGet<{ configured: boolean }>("/world/config");
    await page.goto("/onboard");
    await expect(page.getByRole("heading", { name: "Turn on free checkout for your customers" })).toBeVisible();
    // The not-configured alert needs a merchant profile; without one the page tells the user to set up first.
    const notConfigured = page.getByTestId("not-configured");
    const needsProfile = page.getByText(/set up|profile/i).first();
    if (cfg.body && cfg.body.configured === false) {
      await expect(notConfigured.or(needsProfile)).toBeVisible();
    }
    await noHorizontalScroll(page);
    await shot(page, info, "onboard");
    expect(errors).toEqual([]);
  });

  test("onboard: bad wallet falls back to the demo wallet", async ({ page }) => {
    await page.goto("/onboard?wallet=0xnope");
    await expect(page.getByText("isn't a valid address")).toBeVisible();
  });

  test("demo store renders the widget button and source", async ({ page }, info) => {
    await page.goto("/demo-store");
    await expect(page.locator("[data-paisalink-button]")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, info, "demo-store");
  });

  test("pay link that does not exist", async ({ page }, info) => {
    await page.goto(`/pay/${ZERO_ID}`);
    await expect(page.getByText("Payment link not found")).toBeVisible();
    await shot(page, info, "pay-not-found");
  });

  test("receipt page: unknown invoice", async ({ page }, info) => {
    await page.goto(`/r/${ZERO_ID}`);
    await expect(page.getByText("Receipt not found")).toBeVisible();
    await shot(page, info, "receipt-not-found");
  });

  test("unknown route", async ({ page }) => {
    await page.goto("/definitely-not-a-page");
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("demo-store widget", () => {
  test("click shows a plain error while payments are off (real API)", async ({ page }, info) => {
    test.skip(await paymentsOn(), "payments are on; covered by the modal test and the live flow");
    await page.goto("/demo-store");
    await page.locator("[data-paisalink-button]").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await shot(page, info, "demo-store-payments-off");
  });

  // TEST-ONLY FAKE: the invoice-create response is stubbed so the modal can be exercised before the contract exists.
  // The iframe then loads the real /pay/:id route, which correctly answers "not found" for the fake id.
  test("click opens the checkout modal (invoice create stubbed)", async ({ page }, info) => {
    await page.route("**/invoices", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ invoiceId: ZERO_ID, amountUsdt: "49", merchant: "0xC038827b4E362B0de1Be859377508613CD028946", state: "open" }),
      });
    });
    await page.goto("/demo-store");
    await page.locator("[data-paisalink-button]").click();
    const dialog = page.getByRole("dialog", { name: "PaisaLink checkout" });
    await expect(dialog).toBeVisible();
    const frame = page.frameLocator('iframe[title="PaisaLink checkout"]');
    await expect(frame.getByText("Payment link not found")).toBeVisible();
    await shot(page, info, "demo-store-modal");
    await page.getByRole("button", { name: "Close checkout" }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("receipt page with data", () => {
  // Uses the newest paid invoice if one exists in Arkiv; skipped on an empty store.
  test("renders a real receipt", async ({ page, request }, info) => {
    const demoMerchant = process.env.E2E_MERCHANT || "0xC038827b4E362B0de1Be859377508613CD028946";
    const list = await apiGet<Array<{ invoiceId: string; state: string }>>(`/merchants/${demoMerchant}/invoices`).catch(() => null);
    const paid = Array.isArray(list?.body) ? list!.body.find((i) => i.state !== "open") : undefined;
    test.skip(!paid, "no paid invoice for the demo merchant yet (needs the live flow)");
    await page.goto(`/r/${paid!.invoiceId}`);
    await expect(page.getByTestId("receipt")).toBeVisible();
    await expect(page.getByText("Payment receipt")).toBeVisible();
    await shot(page, info, "receipt");
    void request;
  });
});
