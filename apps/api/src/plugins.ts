// Mount points for routes owned by other workstreams. Each file is loaded only if it exists, so the API runs
// before they land. Conventions (also in docs/handoffs.md):
//   src/routes/merchants.ts (W4): export function merchantsRoutes(store: PaisaStore): Hono   (POST /merchants, GET /merchants/:wallet/invoices)
//   src/world.ts            (W6): export function worldRoutes(ctx: PluginContext): Hono       (POST /world/verify)
//   src/pdf.ts or swarm.ts  (W7): export function pdfRoutes(ctx: PluginContext): Hono         (POST /invoices/:id/pdf)
// Sub-routers declare full paths and are mounted at "/".
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { PaisaStore } from "@paisalink/shared";
import type { ApiConfig } from "./config";
import type { Relayer } from "./relayer";

export interface PluginContext {
  store: PaisaStore;
  config: ApiConfig;
  /** Lets plugins push live updates to dashboards (SSE) after their own store writes. */
  notify: (merchant: `0x${string}`, kind: "invoice" | "payment", invoiceId: `0x${string}`) => void;
  relayer: Relayer;
}

type Factory = (arg: any) => Hono<any>;
const PLUGINS: { file: string; exports: string[]; arg: "store" | "ctx" }[] = [
  { file: "routes/merchants.ts", exports: ["merchantsRoutes", "default"], arg: "store" },
  { file: "world.ts", exports: ["worldRoutes", "default"], arg: "ctx" },
  { file: "pdf.ts", exports: ["pdfRoutes", "default"], arg: "ctx" },
  { file: "swarm.ts", exports: ["pdfRoutes", "swarmRoutes"], arg: "ctx" },
];

export async function mountPlugins(app: Hono<any>, ctx: PluginContext, dir: string = import.meta.dir): Promise<string[]> {
  const mounted: string[] = [];
  for (const p of PLUGINS) {
    const path = join(dir, p.file);
    if (!existsSync(path)) continue;
    const mod = (await import(path)) as Record<string, unknown>;
    const name = p.exports.find((n) => typeof mod[n] === "function");
    if (!name) { console.warn(`[plugins] ${p.file} exists but exports none of ${p.exports.join(", ")}; skipped`); continue; }
    app.route("/", (mod[name] as Factory)(p.arg === "store" ? ctx.store : ctx));
    mounted.push(`${p.file}#${name}`);
  }
  return mounted;
}
