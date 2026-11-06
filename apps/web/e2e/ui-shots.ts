// U1 UI screenshots: /, /merchant, /pay/<paid invoice>, /invest, /r/<paid invoice> at 1440 and 390 px.
// Read-only: loads pages against an API (no transactions). The demo merchant key is put into localStorage via
// addInitScript so the dashboard shows the real demo account; it is never printed, logged or traced.
// Run from apps/web:  bun --env-file=../../.env.local e2e/ui-shots.ts   (BASE=http://localhost:5174 API=https://…/api)
import { chromium } from "@playwright/test";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:5174";
const API = process.env.API || "https://paisalink.tailcdec7a.ts.net/api";
const MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946";
const key = process.env.DEMO_MERCHANT_PRIVATE_KEY?.trim();

const list = (await (await fetch(`${API}/merchants/${MERCHANT}/invoices`)).json()) as { invoiceId: string; state: string }[];
const paid = list.find((i) => i.state === "paid") ?? list.find((i) => i.state !== "open");
const pages: [string, string][] = [["home", "/"], ["merchant", "/merchant"], ["invest", "/invest"], ["onboard", "/onboard"], ["demo-store", "/demo-store"]];
if (paid) pages.push(["pay-paid", `/pay/${paid.invoiceId}`], ["receipt", `/r/${paid.invoiceId}`]);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 });
  if (key) await ctx.addInitScript(([k]) => { localStorage.setItem("paisalink.demo-wallet.merchant", (k!.startsWith("0x") ? k : `0x${k}`)); }, [key] as const);
  for (const [name, path] of pages) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: join(import.meta.dir, "screenshots", `ui-${name}-${tag}.png`), fullPage: true });
    console.log(`ui-${name}-${tag}.png overflowX=${overflow}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
