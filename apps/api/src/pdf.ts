// W7: invoice PDF on Swarm, reference on Arkiv (Arkiv + Swarm bonus).
//
//   GET  /invoices/:id/pdf            render the invoice PDF (preview/download, nothing uploaded)
//   POST /invoices/:id/pdf[?force=1]  render, upload to Swarm, store the plain reference as `swarmRef` on the invoice
//                                     (Arkiv attribute `swarm_ref`), notify dashboards. An invoice that already has a
//                                     reference returns it without a new upload unless force=1.
//
// The PDF holds no personal data: invoice id, merchant handle and wallet, amount, due date, memo, a pay link + QR,
// PaisaLink branding. No payer address, no names, no emails. The bytes are deterministic (no timestamps in the file),
// so the same invoice always gives the same Swarm reference and a forced re-upload is an Arkiv no-op.
//
// Swarm unavailable -> 503 SWARM_NOT_CONFIGURED; upload error -> 502 SWARM_UPLOAD_FAILED. Uploads are never faked.
// Pay link base: PUBLIC_APP_URL (or VITE_PUBLIC_APP_URL). Unset -> the PDF prints the invoice id only (no localhost link).
import { Hono, type Context } from "hono";
import qrcode from "qrcode-generator";
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Invoice } from "@paisalink/shared";
import { ApiError } from "./errors";
import { parseBytes32 } from "./relayer";
import { SlidingWindowLimiter, consumeAll } from "./ratelimit";
import type { PluginContext } from "./plugins";
import { createSwarmClient, loadSwarmConfig, safeUrl, swarmLink, type SwarmClient } from "./swarm";

// ---------------------------------------------------------------- rendering

export interface InvoicePdfInput {
  invoice: Invoice;
  merchantHandle: string | null;
  /** Public payment link; omitted from the PDF when null. */
  payUrl: string | null;
}

/** "49.5" -> "49.50", "1000" -> "1,000.00", keeps up to 6 decimals. */
export function formatUsdt(amount: string): string {
  const [int = "0", frac = ""] = amount.trim().split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac.replace(/0+$/, "").padEnd(2, "0").slice(0, 6)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Unix seconds -> "7 Nov 2026" (UTC, so the bytes do not depend on the server's time zone). */
export function formatDueDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Standard PDF fonts only encode WinAnsi. Map what we can, replace the rest with "?" (memo may hold any Unicode). */
export function toWinAnsi(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    if (ch === "\n") { out += ch; continue; }
    const mapped = ch === "₹" ? "Rs " : ch;
    try { font.widthOfTextAtSize(mapped, 10); out += mapped; } catch { out += "?"; }
  }
  return out;
}

/** Greedy word wrap by measured width; long words are broken by characters. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.52);
const BRAND = rgb(0.05, 0.55, 0.42);
const LINE = rgb(0.86, 0.88, 0.91);
const WHITE = rgb(1, 1, 1);

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
  for (let r = 0; r < n; r++) {
    // Merge horizontal runs of dark modules into one rectangle each (smaller content stream).
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let end = c;
      while (end + 1 < n && qr.isDark(r, end + 1)) end++;
      page.drawRectangle({ x: x + (quiet + c) * cell, y: y + size - (quiet + r + 1) * cell, width: (end - c + 1) * cell, height: cell, color: INK });
      c = end;
    }
  }
}

function addLink(doc: PDFDocument, page: PDFPage, url: string, rect: [number, number, number, number]) {
  const annot = doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  page.node.addAnnot(doc.context.register(annot));
}

/** Renders a one-page A4 invoice. Deterministic: same input, same bytes. */
export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const { invoice: inv, merchantHandle, payUrl } = input;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  doc.setTitle(`PaisaLink invoice ${inv.invoiceId.slice(0, 10)}`);
  doc.setSubject("Invoice (no personal data). Stored on Swarm, indexed on Arkiv.");
  doc.setProducer("PaisaLink (pdf-lib)");
  doc.setCreator("PaisaLink");

  const W = 595.28, H = 841.89, M = 48;
  const page = doc.addPage([W, H]);

  // Header band
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: INK });
  page.drawText("Paisa", { x: M, y: H - 58, size: 26, font: bold, color: WHITE });
  page.drawText("Link", { x: M + bold.widthOfTextAtSize("Paisa", 26), y: H - 58, size: 26, font: bold, color: rgb(0.35, 0.85, 0.66) });
  page.drawText("Stablecoin invoices with gasless checkout", { x: M, y: H - 78, size: 9.5, font: helv, color: rgb(0.75, 0.78, 0.84) });
  const title = "INVOICE";
  page.drawText(title, { x: W - M - bold.widthOfTextAtSize(title, 20), y: H - 60, size: 20, font: bold, color: WHITE });

  let y = H - 140;
  const label = (t: string, x: number, yy: number) => page.drawText(t.toUpperCase(), { x, y: yy, size: 8, font: bold, color: MUTED });

  // From / due
  const handle = merchantHandle ? `@${toWinAnsi(merchantHandle, bold)}` : "PaisaLink merchant";
  label("From", M, y);
  page.drawText(handle, { x: M, y: y - 20, size: 16, font: bold, color: INK });
  page.drawText(inv.merchant, { x: M, y: y - 36, size: 8.5, font: mono, color: MUTED });
  const dueX = W - M - 170;
  label("Due date", dueX, y);
  page.drawText(formatDueDate(inv.dueAt), { x: dueX, y: y - 20, size: 16, font: bold, color: INK });
  page.drawText("UTC", { x: dueX, y: y - 36, size: 8.5, font: helv, color: MUTED });

  // Invoice id
  y -= 72;
  label("Invoice ID", M, y);
  page.drawText(inv.invoiceId, { x: M, y: y - 16, size: 9.5, font: mono, color: INK });

  // Amount box
  y -= 44;
  page.drawRectangle({ x: M, y: y - 78, width: W - 2 * M, height: 78, color: rgb(0.95, 0.98, 0.96), borderColor: rgb(0.78, 0.9, 0.84), borderWidth: 1 });
  label("Amount due", M + 18, y - 22);
  const amount = formatUsdt(inv.amountUsdt);
  page.drawText(amount, { x: M + 18, y: y - 60, size: 30, font: bold, color: INK });
  page.drawText("USDT", { x: M + 24 + bold.widthOfTextAtSize(amount, 30), y: y - 60, size: 14, font: bold, color: BRAND });

  // Memo
  y -= 112;
  label("Memo", M, y);
  const memo = toWinAnsi(inv.memo || "-", helv);
  const memoLines = wrapText(memo, helv, 11, W - 2 * M).slice(0, 8);
  memoLines.forEach((l, i) => page.drawText(l, { x: M, y: y - 18 - i * 15, size: 11, font: helv, color: INK }));
  y -= 18 + memoLines.length * 15 + 18;

  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE });
  y -= 30;

  // How to pay
  label("How to pay", M, y);
  if (payUrl) {
    const qrSize = 132;
    drawQr(page, payUrl, W - M - qrSize, y - qrSize + 8, qrSize);
    const textW = W - 2 * M - qrSize - 24;
    const steps = [
      "Scan the code or open the link on your phone.",
      "Tap Pay and approve with your wallet. You sign a message only;",
      "PaisaLink pays the network fee for verified merchants.",
    ];
    steps.forEach((s, i) => page.drawText(s, { x: M, y: y - 20 - i * 15, size: 10.5, font: helv, color: INK }));
    const linkLines = wrapText(payUrl, mono, 9, textW);
    const ly = y - 20 - steps.length * 15 - 10;
    linkLines.forEach((l, i) => page.drawText(l, { x: M, y: ly - i * 12, size: 9, font: mono, color: BRAND }));
    addLink(doc, page, payUrl, [M, ly - (linkLines.length - 1) * 12 - 3, M + textW, ly + 10]);
  } else {
    page.drawText("Open the payment link the merchant sent you, or quote the invoice ID above.", { x: M, y: y - 20, size: 10.5, font: helv, color: INK });
  }

  // Footer
  const foot = [
    "This document holds no personal data. Its bytes are stored on Swarm; the Swarm reference is kept on the",
    "invoice record in Arkiv (attribute swarm_ref), and payment settles in USDT on Whitechain.",
    "Testnet demo: test USDT, no real value.",
  ];
  page.drawLine({ start: { x: M, y: 86 }, end: { x: W - M, y: 86 }, thickness: 1, color: LINE });
  foot.forEach((l, i) => page.drawText(l, { x: M, y: 70 - i * 12, size: 8, font: helv, color: MUTED }));

  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- routes

export interface PdfRouteOptions {
  /** null = Swarm off (503). Default: from env (src/swarm.ts). */
  swarm?: SwarmClient | null;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

const appBase = (env: Record<string, string | undefined>) => (env.PUBLIC_APP_URL || env.VITE_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "") || null;

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) { const xff = c.req.header("x-forwarded-for"); if (xff) return xff.split(",")[0]!.trim(); }
  const server = c.env as { requestIP?: (r: Request) => { address: string } | null } | undefined;
  try { return server?.requestIP?.(c.req.raw)?.address ?? "unknown"; } catch { return "unknown"; }
}

export function pdfRoutes(ctx: PluginContext, opts: PdfRouteOptions = {}): Hono {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  let swarm: SwarmClient | null;
  if (opts.swarm !== undefined) swarm = opts.swarm;
  else {
    try { const cfg = loadSwarmConfig(env); swarm = cfg ? createSwarmClient(cfg) : null; }
    catch (e) { console.warn(`[pdf] Swarm off: ${(e as Error).message}`); swarm = null; }
  }
  const base = appBase(env);
  const limits = {
    ip: new SlidingWindowLimiter(Number(env.RL_PDF_IP_PER_HOUR) || 20, 3_600_000, now),
    invoice: new SlidingWindowLimiter(3, 3_600_000, now),
    global: new SlidingWindowLimiter(Number(env.RL_PDF_GLOBAL_PER_HOUR) || 200, 3_600_000, now),
  };

  const load = async (c: Context) => {
    const id = parseBytes32(c.req.param("id"), "invoice id");
    const inv = await ctx.store.getInvoice(id);
    if (!inv) throw new ApiError("INVOICE_NOT_FOUND", "invoice not found");
    const m = await ctx.store.getMerchant(inv.merchant);
    return { inv, input: { invoice: inv, merchantHandle: m?.handle ?? null, payUrl: base ? `${base}/pay/${inv.invoiceId}` : null } satisfies InvoicePdfInput };
  };
  const fileName = (inv: Invoice) => `paisalink-invoice-${inv.invoiceId.slice(2, 10)}.pdf`;

  const app = new Hono();

  app.get("/invoices/:id/pdf", async (c) => {
    const { inv, input } = await load(c);
    const bytes = await renderInvoicePdf(input);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName(inv)}"`,
      "Cache-Control": "no-store",
    });
  });

  app.post("/invoices/:id/pdf", async (c) => {
    if (!swarm) {
      return c.json({ error: "Swarm is not configured on this server (set BEE_URL + BEE_BATCH_ID, or unset SWARM_DISABLED for the public gateway)", code: "SWARM_NOT_CONFIGURED" }, 503);
    }
    const { inv, input } = await load(c);
    const force = c.req.query("force") === "1";
    if (inv.swarmRef && !force) {
      return c.json({ invoiceId: inv.invoiceId, swarmRef: inv.swarmRef, url: swarmLink(swarm.config, inv.swarmRef), cached: true });
    }
    const blocked = consumeAll([
      { limiter: limits.global, key: "global", name: "global" },
      { limiter: limits.ip, key: clientIp(c, ctx.config.trustProxy), name: "ip" },
      { limiter: limits.invoice, key: inv.invoiceId, name: "invoice" },
    ]);
    if (blocked) throw new ApiError("RATE_LIMITED", `too many PDF uploads (${blocked.name} limit)`, { retryAfterSec: blocked.retryAfterSec });

    const bytes = await renderInvoicePdf(input);
    let up;
    try {
      up = await swarm.upload(bytes, fileName(inv), "application/pdf");
    } catch (e) {
      console.warn(`[pdf] ${(e as Error).message}`);
      return c.json({ error: (e as Error).message, code: "SWARM_UPLOAD_FAILED" }, 502);
    }
    // Re-read right before the write so a payment that landed meanwhile is not overwritten; change only swarmRef.
    const fresh = (await ctx.store.getInvoice(inv.invoiceId)) ?? inv;
    const changed = fresh.swarmRef !== up.reference;
    if (changed) {
      await ctx.store.upsertInvoice({ ...fresh, swarmRef: up.reference });
      ctx.notify(fresh.merchant, "invoice", fresh.invoiceId);
    }
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return c.json({
      invoiceId: inv.invoiceId, swarmRef: up.reference, url: up.url, bytes: up.bytes, sha256,
      service: safeUrl(swarm.config.beeUrl), stored: changed, cached: false,
    }, changed ? 201 : 200);
  });

  return app;
}
