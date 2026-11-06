import { expect, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

export const API_URL = process.env.E2E_API_URL || "http://localhost:8787";
export const LIVE = process.env.E2E_LIVE === "1";

/** Full-page screenshot into apps/web/e2e/screenshots/<project>-<name>.png */
export async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: join(import.meta.dir, "screenshots", `${info.project.name}-${name}.png`), fullPage: true });
}

/** Fails the test on uncaught page errors (console noise from network failures is ignored). */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}

export async function apiGet<T = any>(path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API_URL}${path}`);
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

/** Contracts deployed and API able to relay? Used to decide which "not switched on" assertions apply. */
export async function paymentsOn(): Promise<boolean> {
  const { body } = await apiGet<{ paymentRouter: string | null }>("/config");
  return !!body?.paymentRouter;
}
export async function notesOn(): Promise<boolean> {
  const { body } = await apiGet<{ invoiceNote: string | null }>("/config");
  return !!body?.invoiceNote;
}
