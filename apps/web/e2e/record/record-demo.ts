// Records the demo-video footage, one clip per chapter of docs/demo-script.md, live on Whitechain testnet.
// Run from apps/web (needs the verified demo merchant key from .env.local; it is never printed):
//   bun --env-file=../../.env.local e2e/record/record-demo.ts            # all chapters
//   bun --env-file=../../.env.local e2e/record/record-demo.ts ch10 ch05  # only these (no-spend chapters)
// Output (REC_OUT, default ../../recordings/v2-src): chNN.mp4 (H.264 1080p30), raw/<part>.webm, marks.json (event
// times per part, for scripts/cut-v2.sh), run-log.json (tx + entity links). Never record a trace here: it would
// capture the merchant key from addInitScript.
// Target app: E2E_BASE_URL (default the hosted https://paisalink.tailcdec7a.ts.net), API = E2E_API_URL or <base>/api.
// Budget (test USDT from the demo faucet): payer A 1.00 + investor 0.45 + payer B 0.50 = 1.95.
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { mkdir, writeFile, rename, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

const BASE = (process.env.E2E_BASE_URL || "https://paisalink.tailcdec7a.ts.net").replace(/\/+$/, "");
const API = (process.env.E2E_API_URL || `${BASE}/api`).replace(/\/+$/, "");
const OUT = resolve(process.env.REC_OUT || resolve(import.meta.dir, "../../../../recordings/v2-src"));
const RAW = join(OUT, "raw");
const DEMO_MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946";
const MERCHANT_SLOT = "paisalink.demo-wallet.merchant";
const AMOUNT_A = "1.00", REFUND_A = "0.20", FACE_B = "0.50", PRICE_B = "0.45";
const DESK = { width: 1440, height: 810 };   // upscaled to 1920x1080 by ffmpeg (bigger, readable text)
const PHONE = { width: 390, height: 844 };
const run = Date.now().toString(36);
const memoA = "Logo design, 2 revisions";
const memoB = "Brand guide for Chhaap & Co.";

const only = process.argv.slice(2);
const want = (ch: string) => (only.length === 0 && !ch.includes("-")) || only.includes(ch); // "-tail" chapters: only on request
const log = (...a: unknown[]) => console.log(`[rec ${new Date().toISOString().slice(11, 19)}]`, ...a);
const pause = (p: Page, ms = 1800) => p.waitForTimeout(ms);

// Event marks: seconds since the page (and its video) started. finish() files them under the part name, with the
// wall-clock length, so the cut step can line them up with the webm (aligned at the end of the video).
const pageStart = new WeakMap<Page, number>();
const pending = new WeakMap<Page, { label: string; t: number }[]>();
const marks: Record<string, { mobile: boolean; wallSec: number; marks: { label: string; t: number }[] }> = {};
function mark(p: Page, label: string) {
  const t = (Date.now() - (pageStart.get(p) ?? Date.now())) / 1000;
  pending.get(p)?.push({ label, t });
  log(`  mark ${label} @ ${t.toFixed(2)} s`);
}

type Found = { chapter: string; label: string; href: string };
const found: Found[] = [];
const state: Record<string, string | number> = {};

function merchantKey(): `0x${string}` {
  const raw = process.env.DEMO_MERCHANT_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("DEMO_MERCHANT_PRIVATE_KEY missing (run with bun --env-file=../../.env.local)");
  const k = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k) || privateKeyToAccount(k).address !== DEMO_MERCHANT) throw new Error("DEMO_MERCHANT_PRIVATE_KEY is not the demo merchant");
  return k;
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

/** Every tx / Arkiv entity link visible on the page, logged with the chapter. */
async function harvest(page: Page, chapter: string) {
  const links = await page.$$eval("a[href]", (as) => as.map((a) => ({ label: (a.textContent || "").trim().slice(0, 60), href: (a as HTMLAnchorElement).href })))
    .catch(() => [] as { label: string; href: string }[]);
  for (const l of links) {
    if (!/\/tx\/0x[0-9a-fA-F]{64}|\/entity\/0x[0-9a-fA-F]{64}/.test(l.href)) continue;
    if (found.some((f) => f.href === l.href)) continue;
    found.push({ chapter, ...l });
    log(`  ${chapter}: ${l.label} -> ${l.href}`);
  }
}

type Clip = { ctx: BrowserContext; page: Page; parts: { file: string; mobile: boolean }[] };
async function context(browser: Browser, opts: { mobile?: boolean; merchant?: boolean; storage?: any } = {}) {
  const size = opts.mobile ? PHONE : DESK;
  const ctx = await browser.newContext({
    baseURL: BASE, viewport: size, deviceScaleFactor: 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile,
    recordVideo: { dir: RAW, size }, storageState: opts.storage, acceptDownloads: true,
  });
  if (opts.merchant) {
    // TEST-ONLY: the verified demo merchant's key into the app's "testnet demo wallet" slot (same as e2e/live.spec.ts).
    await ctx.addInitScript(([slot, key]) => { window.localStorage.setItem(slot, key); }, [MERCHANT_SLOT, merchantKey()] as const);
  }
  const t0 = Date.now();
  const page = await ctx.newPage();
  pageStart.set(page, t0); pending.set(page, []);
  return { ctx, page };
}
/** Close the context (flushes the video) and move the webm to raw/<name>.webm. */
async function finish(c: { ctx: BrowserContext; page: Page }, name: string) {
  const v = c.page.video();
  const vp = c.page.viewportSize();
  marks[name] = { mobile: (vp?.width ?? 1000) < 600, wallSec: (Date.now() - (pageStart.get(c.page) ?? Date.now())) / 1000, marks: pending.get(c.page) ?? [] };
  await c.ctx.close();
  const dst = join(RAW, `${name}.webm`);
  if (v) await rename(await v.path(), dst);
  log(`saved ${name}.webm`);
  return dst;
}

/** webm -> 1080p30 H.264. Desktop: upscale. Phone: scale to 1040 px high and pad on a dark background. */
async function encode(parts: { file: string; mobile: boolean }[], out: string) {
  const tmp: string[] = [];
  for (const [i, p] of parts.entries()) {
    const t = join(RAW, `_${i}_${Date.now()}.mp4`);
    const vf = p.mobile
      ? "scale=-2:1040:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,fps=30,format=yuv420p"
      : "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p";
    await $`ffmpeg -v error -y -i ${p.file} -vf ${vf} -c:v libx264 -preset veryfast -crf 18 -r 30 -an ${t}`;
    tmp.push(t);
  }
  if (tmp.length === 1) await rename(tmp[0], out);
  else {
    const list = join(RAW, `_list_${Date.now()}.txt`);
    await writeFile(list, tmp.map((t) => `file '${t}'`).join("\n"));
    await $`ffmpeg -v error -y -f concat -safe 0 -i ${list} -c copy ${out}`;
    for (const t of [...tmp, list]) await rm(t, { force: true });
  }
  log(`wrote ${out}`);
}

async function createInvoice(page: Page, amount: string, memo: string) {
  await page.goto("/merchant");
  await expect(page.getByLabel("Amount in USDT")).toBeVisible({ timeout: 30_000 });
  mark(page, "ready");
  await pause(page, 1500);
  await page.getByLabel("Amount in USDT").fill(amount);
  await page.getByPlaceholder("Logo design, 2 revisions").fill(memo);
  mark(page, "filled");
  await pause(page, 800);
  await page.getByRole("button", { name: "Create payment link" }).click();
  mark(page, "createClick");
  const link = page.getByTestId("pay-link");
  await expect(link).toBeVisible({ timeout: 90_000 });
  mark(page, "link");
  const url = (await link.textContent())!.trim();
  await link.scrollIntoViewIfNeeded();
  return { url, id: url.split("/pay/")[1] };
}

async function payOnPhone(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("amount")).toBeVisible({ timeout: 30_000 });
  mark(page, "page");
  await expect(page.getByText(/Balance: \d/)).toBeVisible({ timeout: 60_000 });
  mark(page, "balance");
  await pause(page, 1500);
  const get = page.getByRole("button", { name: "Get test USDT" });
  if (await get.isVisible()) {
    await get.click();
    mark(page, "fundClick");
    await expect(page.getByTestId("pay-button")).toBeEnabled({ timeout: 90_000 });
    mark(page, "funded");
    await pause(page, 1500);
  }
  await page.getByTestId("pay-button").click();
  mark(page, "payClick");
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 120_000 });
  mark(page, "paid");
  await pause(page, 3500);
}

function noteCard(page: Page, noteId: number) {
  return page.locator("div").filter({ hasText: new RegExp(`Note #${noteId}(?!\\d)`) }).filter({ hasText: "Escrow for settlement" }).last();
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const prev = await readFile(join(OUT, "run-state.json"), "utf8").then(JSON.parse).catch(() => ({}));
  Object.assign(state, prev);
  Object.assign(marks, await readFile(join(OUT, "marks.json"), "utf8").then(JSON.parse).catch(() => ({}))); // re-runs keep other parts
  const h = await api("GET", "/health");
  log("faucet USDT before:", h.body?.demoFaucet?.balanceUsdt, "api ok:", h.body?.ok);
  merchantKey();
  const browser = await chromium.launch({ channel: "chromium", slowMo: 150, args: ["--no-sandbox"] });
  const clips: Record<string, { file: string; mobile: boolean }[]> = {};
  const save = async () => {
    await writeFile(join(OUT, "run-state.json"), JSON.stringify(state, null, 2));
    await writeFile(join(OUT, "run-log.json"), JSON.stringify({ run, base: BASE, state, found }, null, 2));
    await writeFile(join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
  };
  const chapter = async (name: string, fn: () => Promise<void>) => {
    if (!want(name)) return;
    log(`=== ${name}`);
    const t0 = Date.now();
    try { await fn(); log(`=== ${name} done in ${Math.round((Date.now() - t0) / 1000)} s`); }
    catch (e) { log(`!!! ${name} FAILED:`, String(e).slice(0, 600)); state[`${name}_failed`] = String(e).slice(0, 300); }
    await save();
    if (clips[name]?.length) await encode(clips[name], join(OUT, `${name}.mp4`)).catch((e) => log("encode failed", name, String(e)));
  };

  try {
    await chapter("ch02", async () => {
      const c = await context(browser, { merchant: true });
      try {
        const r = await createInvoice(c.page, AMOUNT_A, memoA);
        state.payUrlA = r.url; state.invoiceA = r.id;
        log("invoice A", r.id);
        await pause(c.page, 2500);
      } finally { clips.ch02 = [{ file: await finish(c, "ch02"), mobile: false }]; }
    });

    await chapter("ch03", async () => {
      const c = await context(browser, { mobile: true });
      try { await payOnPhone(c.page, String(state.payUrlA)); await harvest(c.page, "ch03"); }
      finally { clips.ch03 = [{ file: await finish(c, "ch03a"), mobile: true }]; }
      const inv = await api("GET", `/invoices/${state.invoiceA}`);
      state.payTxA = inv.body?.payTx;
      log("pay tx A", state.payTxA);
      const d = await context(browser);
      try {
        await d.page.goto(`https://explorer.testnet.whitechain.io/tx/${state.payTxA}`, { timeout: 60_000 });
        await d.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
        mark(d.page, "explorer");
        await pause(d.page, 4000);
        await d.page.mouse.wheel(0, 350);
        await pause(d.page, 4000);
      } finally { clips.ch03.push({ file: await finish(d, "ch03b"), mobile: false }); }
    });

    await chapter("ch04", async () => {
      const c = await context(browser, { merchant: true });
      try {
        await c.page.goto("/merchant");
        const row = c.page.getByTestId("invoice-row").filter({ hasText: memoA });
        await expect(row).toHaveAttribute("data-state", "paid", { timeout: 60_000 });
        await row.scrollIntoViewIfNeeded();
        mark(c.page, "paidRow");
        await pause(c.page, 2500);
        await row.getByRole("button", { name: "Refund", exact: true }).click();
        await row.getByLabel("Refund amount").fill(REFUND_A);
        mark(c.page, "refundOpen");
        await pause(c.page, 800);
        await row.getByRole("button", { name: /^Refund 0\.2/ }).click();
        mark(c.page, "refundClick");
        await expect(row.getByText(/Refunded/)).toBeVisible({ timeout: 90_000 });
        mark(c.page, "refunded");
        const rl = row.getByRole("link", { name: "Refund transaction" });
        await expect(rl).toBeVisible();
        await rl.hover();
        await pause(c.page, 3000);
        state.refundTxA = String(await rl.getAttribute("href"));
        await harvest(c.page, "ch04");
      } finally { clips.ch04 = [{ file: await finish(c, "ch04"), mobile: false }]; }
    });

    await chapter("ch05", async () => {
      let csvPart: { file: string; mobile: boolean } | null = null;
      const c = await context(browser, { merchant: true });
      try {
        await c.page.goto("/merchant");
        await expect(c.page.getByTestId("invoice-row").first()).toBeVisible({ timeout: 60_000 });
        await pause(c.page, 1500);
        const exp = c.page.getByRole("link", { name: "Export CSV" });
        await exp.hover();
        await pause(c.page, 800);
        mark(c.page, "exportHover");
        const [dl] = await Promise.all([c.page.waitForEvent("download"), exp.click()]);
        mark(c.page, "exportClick");
        const text = (await readFile((await dl.path())!, "utf8")).replace(/^﻿/, "");
        const name = dl.suggestedFilename();
        await pause(c.page, 1200);
        // Show the downloaded file itself (the real CSV bytes, rendered as a table), like opening it in a spreadsheet.
        const rows = text.trim().split("\n").map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')).filter((_, i, a) => i < a.length - 1 || a[i] !== ""));
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const csvHtml = (`<html><body style="margin:0;font:13px system-ui,sans-serif;background:#f8fafc">
          <div style="padding:10px 16px;background:#1e293b;color:#e2e8f0;font-weight:600">${esc(name)} &mdash; downloaded from Export CSV</div>
          <div style="overflow:auto;padding:12px"><table style="border-collapse:collapse;background:white">${rows.map((r, i) => `<tr>${r.map((cell) => `<${i ? "td" : "th"} style="border:1px solid #cbd5e1;padding:4px 8px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;${i ? "" : "background:#e2e8f0"}">${esc(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div></body></html>`);
        // After the same-origin download, this page's video did not repaint anything until the next app navigation,
        // so the CSV is shown in its own short clip (part ch05csv), rendered from the downloaded bytes.
        const v = await context(browser);
        try {
          await v.page.setContent(csvHtml);
          mark(v.page, "csv");
          await pause(v.page, 5000);
        } finally { csvPart = { file: await finish(v, "ch05csv"), mobile: false }; }
        await c.page.goto("/demo-store");
        await expect(c.page.getByText("The whole integration")).toBeVisible({ timeout: 30_000 });
        mark(c.page, "store");
        await pause(c.page, 2500);
        await c.page.locator("pre").first().hover();
        mark(c.page, "code");
        await pause(c.page, 4000);
      } finally {
        const main = await finish(c, "ch05");
        clips.ch05 = csvPart ? [{ file: main, mobile: false }, csvPart] : [{ file: main, mobile: false }];
      }
    });

    let storage: any = null;
    await chapter("ch06", async () => {
      const c = await context(browser, { merchant: true });
      try {
        const r = await createInvoice(c.page, FACE_B, memoB);
        state.payUrlB = r.url; state.invoiceB = r.id;
        log("invoice B", r.id);
        await pause(c.page, 1500);
        const row = c.page.getByTestId("invoice-row").filter({ hasText: memoB });
        await expect(row).toBeVisible({ timeout: 60_000 });
        await row.scrollIntoViewIfNeeded();
        await pause(c.page, 1000);
        mark(c.page, "rowB");
        await row.getByRole("link", { name: "Sell this invoice" }).click();
        await expect(c.page.getByTestId("sell-summary")).toBeVisible({ timeout: 30_000 });
        mark(c.page, "sellPage");
        await c.page.locator("select").selectOption({ label: "5 minutes (testnet)" });
        await c.page.getByLabel("Face value (USDT)").fill(FACE_B);
        await c.page.getByLabel("Price (USDT)").fill(PRICE_B);
        await expect(c.page.getByTestId("sell-summary")).toContainText("price $0.45");
        mark(c.page, "sellForm");
        await pause(c.page, 1500);
        await c.page.getByRole("button", { name: "Sell for 0.45 USDT" }).click();
        mark(c.page, "sellClick");
        const listed = c.page.getByText(/Listed as note #\d+/);
        await expect(listed).toBeVisible({ timeout: 120_000 });
        mark(c.page, "listed");
        state.noteId = Number((await listed.textContent())!.match(/note #(\d+)/)![1]);
        state.listedAt = Date.now();
        log("note", state.noteId);
        await pause(c.page, 3000);
        await harvest(c.page, "ch06");
      } finally { clips.ch06 = [{ file: await finish(c, "ch06a"), mobile: false }]; }

      const inv = await context(browser);
      try {
        await inv.page.goto("/invest");
        const card = noteCard(inv.page, Number(state.noteId));
        await expect(card).toBeVisible({ timeout: 60_000 });
        await expect(card.getByRole("button", { name: "Fund for 0.45 USDT" })).toBeVisible();
        mark(inv.page, "notes");
        await pause(inv.page, 2000);
        await inv.page.getByRole("button", { name: /Set up investor/i }).click();
        mark(inv.page, "setupClick");
        await expect(inv.page.getByText(/0\.45 test USDT/)).toBeVisible({ timeout: 120_000 });
        mark(inv.page, "setupDone");
        await pause(inv.page, 2000);
        const fund = card.getByRole("button", { name: "Fund for 0.45 USDT" });
        await expect(fund).toBeEnabled({ timeout: 30_000 });
        await fund.scrollIntoViewIfNeeded();
        await fund.click();
        mark(inv.page, "fundClick");
        await expect(card.getByText("Funded the note")).toBeVisible({ timeout: 120_000 });
        await card.getByText("Funded the note").evaluate((el) => el.scrollIntoView({ block: "center" }));
        mark(inv.page, "funded");
        await pause(inv.page, 3500);
        await harvest(inv.page, "ch06");
        storage = await inv.ctx.storageState(); // in memory only: holds the fresh investor demo wallet
      } finally { clips.ch06.push({ file: await finish(inv, "ch06b"), mobile: false }); }

      // the customer pays invoice B: the money goes to the note escrow
      const p = await context(browser, { mobile: true });
      try { await payOnPhone(p.page, String(state.payUrlB)); await harvest(p.page, "ch06"); }
      finally { clips.ch06.push({ file: await finish(p, "ch06c"), mobile: true }); }
      const ib = await api("GET", `/invoices/${state.invoiceB}`);
      state.payTxB = ib.body?.payTx;
      log("pay tx B (escrow)", state.payTxB);
    });

    // While the 5-minute maturity runs: Swarm receipt and World ID chapters (no USDT spent).
    await chapter("ch09", async () => {
      const c = await context(browser, { merchant: true });
      try {
        const invoiceA = String(state.invoiceA);
        await c.page.goto("/merchant");
        const row = c.page.getByTestId("invoice-row").filter({ hasText: memoA });
        await expect(row).toBeVisible({ timeout: 60_000 });
        await row.scrollIntoViewIfNeeded();
        const pub = row.getByRole("button", { name: "Publish PDF to Swarm" });
        mark(c.page, "row");
        if (await pub.isVisible().catch(() => false)) {
          await pause(c.page, 1000);
          await pub.click();
          mark(c.page, "publishClick");
          await expect(row.getByTestId("swarm-link")).toBeVisible({ timeout: 150_000 });
          mark(c.page, "published");
          await pause(c.page, 2000);
        }
        await harvest(c.page, "ch09");
        const arkiv: string | null = (await api("GET", `/invoices/${invoiceA}`)).body?.arkivUrl ?? null;
        state.arkivA = String(arkiv);
        await c.page.goto(`/r/${invoiceA}`);
        const open = c.page.getByRole("link", { name: "Open PDF on Swarm" });
        await expect(open).toBeVisible({ timeout: 60_000 });
        mark(c.page, "receipt");
        await pause(c.page, 2500);
        await open.hover();
        await pause(c.page, 800);
        const href = (await open.getAttribute("href"))!;
        state.swarmUrlA = href;
        await harvest(c.page, "ch09");
        await c.page.goto(href, { timeout: 90_000 }); // same tab, so one clip (Chromium's PDF viewer)
        mark(c.page, "pdf");
        await pause(c.page, 5000);
        if (arkiv) {
          await c.page.goto(arkiv, { timeout: 60_000 });
          await c.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          mark(c.page, "arkiv");
          await pause(c.page, 3500);
          await c.page.mouse.wheel(0, 400);
          await pause(c.page, 4000);
        }
      } finally { clips.ch09 = [{ file: await finish(c, "ch09"), mobile: false }]; }
    });

    await chapter("ch10", async () => {
      const c = await context(browser);
      try {
        await c.page.goto(`/onboard?wallet=${DEMO_MERCHANT}`, { waitUntil: "networkidle" });
        await expect(c.page.getByTestId("verified")).toBeVisible({ timeout: 30_000 });
        await c.page.getByTestId("verified").scrollIntoViewIfNeeded();
        mark(c.page, "verified");
        await pause(c.page, 4000);
        // a fresh, unverified merchant (new wallet, real Arkiv merchant record)
        const wallet = privateKeyToAccount(generatePrivateKey()).address;
        let m = { status: 0 } as { status: number };
        for (const handle of ["meera.studio", "kavya.crafts", "rohan.films", "anika.writes", "dev.illustrates"]) {
          m = await api("POST", "/merchants", { wallet, handle });
          if (m.status >= 200 && m.status < 300) break;
        }
        log("fresh merchant", wallet, m.status);
        state.freshMerchant = wallet;
        await c.page.goto(`/onboard?wallet=${wallet}`, { waitUntil: "networkidle" });
        mark(c.page, "freshPage");
        await pause(c.page, 2000);
        await c.page.getByTestId("verify-button").click();
        mark(c.page, "verifyClick");
        await c.page.getByRole("link", { name: "Use the simulator" }).waitFor({ timeout: 60_000 });
        mark(c.page, "idkit");
        await pause(c.page, 3000);
        await c.page.getByRole("dialog").getByRole("button").first().click();
        await expect(c.page.getByTestId("locked")).toBeVisible({ timeout: 30_000 });
        await c.page.getByTestId("locked").scrollIntoViewIfNeeded();
        mark(c.page, "locked");
        await pause(c.page, 4500);
        // the relayer refuses a gasless payment for this unverified merchant
        const inv = await api("POST", "/invoices", { merchant: wallet, amountUsdt: "1", dueAt: Math.floor(Date.now() / 1000) + 7 * 86400, memo: "Wedding invitation design" });
        const router = (await api("GET", "/config")).body.paymentRouter;
        const relay = await api("POST", "/relay", {
          invoiceId: inv.body?.invoiceId,
          authorization: { from: privateKeyToAccount(generatePrivateKey()).address, to: router, value: "1000000", validAfter: 0, validBefore: Math.floor(Date.now() / 1000) + 300, nonce: "0x" + "00".repeat(32) },
          signature: "0x" + "11".repeat(65),
        });
        state.relayUnverified = `${relay.status} ${JSON.stringify(relay.body)}`;
        log("relay for unverified merchant ->", state.relayUnverified);
        await c.page.setContent(`<html><body style="margin:0;background:#0f172a;color:#e2e8f0;font:22px ui-monospace,monospace;padding:60px">
          <div style="color:#94a3b8">$ curl -X POST ${API}/relay  # unverified merchant</div>
          <div style="margin-top:24px">HTTP ${relay.status}</div>
          <pre style="white-space:pre-wrap;color:#fda4af">${JSON.stringify(relay.body, null, 2).replace(/</g, "&lt;")}</pre></body></html>`);
        mark(c.page, "relay");
        await pause(c.page, 5000);
      } finally { clips.ch10 = [{ file: await finish(c, "ch10"), mobile: false }]; }
    });

    // ch07 + ch08 after maturity (investor wallet reloaded from the in-memory storage state)
    await chapter("ch07", async () => {
      if (!storage) throw new Error("no investor session (ch06 did not finish)");
      const n = await api("GET", "/notes");
      const row = n.body?.notes?.find((x: any) => x.noteId === state.noteId);
      const maturity = row?.onchain?.maturity ?? row?.maturity;
      const chainNow = n.body?.chainTime ?? Math.floor(Date.now() / 1000);
      const wait = Math.max(0, (maturity - chainNow + 8) * 1000);
      log(`waiting ${Math.round(wait / 1000)} s for maturity (not recorded)`);
      await new Promise((r) => setTimeout(r, wait));
      const c = await context(browser, { storage });
      try {
        await c.page.goto("/invest");
        const card = noteCard(c.page, Number(state.noteId));
        await expect(card).toBeVisible({ timeout: 60_000 });
        const btn = card.getByRole("button", { name: "Try a transfer after maturity" });
        await expect(btn).toBeEnabled({ timeout: 90_000 });
        await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
        mark(c.page, "card");
        await pause(c.page, 2000);
        await btn.click();
        mark(c.page, "tryClick");
        await expect(card.getByTestId("revert")).toContainText(/Reverted:/, { timeout: 60_000 });
        state.revert = (await card.getByTestId("revert").textContent()) ?? "";
        log("revert:", state.revert);
        await card.getByTestId("revert").evaluate((el) => el.scrollIntoView({ block: "center" }));
        mark(c.page, "revert");
        await pause(c.page, 6000);
      } finally { clips.ch07 = [{ file: await finish(c, "ch07"), mobile: false }]; }
    });

    await chapter("ch08", async () => {
      if (!storage) throw new Error("no investor session (ch06 did not finish)");
      const c = await context(browser, { storage });
      try {
        await c.page.goto("/invest");
        const card = noteCard(c.page, Number(state.noteId));
        await expect(card).toBeVisible({ timeout: 60_000 });
        const settle = card.getByRole("button", { name: /^Settle: pay/ });
        await expect(settle).toBeEnabled({ timeout: 120_000 });
        await settle.evaluate((el) => el.scrollIntoView({ block: "center" }));
        mark(c.page, "card");
        await pause(c.page, 2000);
        await settle.click();
        mark(c.page, "settleClick");
        // scoped to this note's card: older settled notes on the page show the same text (run 4 matched one)
        await expect(card.getByText("Settled in USDT").first()).toBeVisible({ timeout: 120_000 });
        mark(c.page, "settled");
        await pause(c.page, 2000);
        await harvest(c.page, "ch08");
        // the settled note card (it moves to the end of the list), then the settle tx on the explorer
        const done = c.page.locator("div").filter({ hasText: new RegExp(`Note #${state.noteId}(?!\\d)`) }).filter({ hasText: "Escrow for settlement" }).filter({ hasText: "Settled in USDT" }).last();
        await done.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
        mark(c.page, "settledCard");
        await pause(c.page, 3500);
        const settleTx = found.filter((f) => f.chapter === "ch08" && /\/tx\//.test(f.href)).pop()?.href;
        if (settleTx) {
          state.settleTx = settleTx;
          await c.page.goto(settleTx, { timeout: 60_000 });
          await c.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          mark(c.page, "explorer");
          await pause(c.page, 6000);
        }
      } finally { clips.ch08 = [{ file: await finish(c, "ch08"), mobile: false }]; }
    });
    // Short no-spend pick-up shots, appended to ch08 / ch09 by hand (ffmpeg concat) after run 3:
    // ch08-tail: the settled note card and the settle tx on the explorer; ch09-tail: invoice A's Arkiv entity page.
    await chapter("ch08-tail", async () => {
      const c = await context(browser);
      try {
        await c.page.goto("/invest");
        const card = c.page.locator("div").filter({ hasText: new RegExp(`Note #${state.noteId}(?!\\d)`) }).filter({ hasText: "Escrow for settlement" }).filter({ hasText: "Settled in USDT" }).last();
        await expect(card).toBeVisible({ timeout: 60_000 });
        await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
        mark(c.page, "settledCard");
        await pause(c.page, 4500);
        await harvest(c.page, "ch08");
        const settle = found.find((f) => f.chapter === "ch08" && /\/tx\//.test(f.href) && /settled/i.test(f.label)) ?? found.filter((f) => f.chapter === "ch08" && /\/tx\//.test(f.href)).pop();
        const settleHref = settle?.href ?? (state.settleTx ? String(state.settleTx) : null); // run 3: set from the ch08 log
        if (settleHref) {
          state.settleTx = settleHref;
          await c.page.goto(settleHref, { timeout: 60_000 });
          await c.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          mark(c.page, "explorer");
          await pause(c.page, 6000);
        }
      } finally { clips["ch08-tail"] = [{ file: await finish(c, "ch08-tail"), mobile: false }]; }
    });

    await chapter("ch09-tail", async () => {
      const c = await context(browser);
      try {
        const arkiv = (await api("GET", `/invoices/${state.invoiceA}`)).body?.arkivUrl;
        if (!arkiv) throw new Error("no arkivUrl for invoice A");
        state.arkivA = arkiv;
        await c.page.goto(arkiv, { timeout: 60_000 });
        await c.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
        await pause(c.page, 4000);
        await c.page.mouse.wheel(0, 400);
        await pause(c.page, 4000);
        await c.page.mouse.wheel(0, 400);
        await pause(c.page, 3000);
      } finally { clips["ch09-tail"] = [{ file: await finish(c, "ch09-tail"), mobile: false }]; }
    });
  } finally {
    await browser.close();
    await save();
    const h2 = await api("GET", "/health");
    log("faucet USDT after:", h2.body?.demoFaucet?.balanceUsdt);
  }
}

await main();
