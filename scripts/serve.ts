// Production server: the built web app and the Hono API on ONE port (for the hosted container, see Dockerfile).
//   bun scripts/serve.ts            (PORT, default 5000; web build in apps/web/dist)
// /api/* is the API with the prefix stripped (/api/health -> API /health); everything else is the SPA.
// Secrets come from the environment only (Dokku config); nothing is read from .env files here.
import { join } from "node:path";
// Relative imports: the repo uses isolated installs, so packages resolve from their own node_modules.
import { createArkivStore } from "../packages/arkiv/src/index";
import { loadConfig, redactedConfig } from "../apps/api/src/config";
import { createApp } from "../apps/api/src/app";
import { createProbe, createViemFaucetChain, createViemRouterChain } from "../apps/api/src/viem-chain";
import { createServeFetch } from "./serve-lib";

const config = loadConfig();
const store = createArkivStore(process.env as Parameters<typeof createArkivStore>[0]);
const chain = createViemRouterChain(config);
const faucet = createViemFaucetChain(config);
const { app, mounted } = await createApp({ config, store, chain, faucet, probe: createProbe(config) });

const distDir = process.env.WEB_DIST_DIR || join(import.meta.dir, "..", "apps", "web", "dist");
const fetch = createServeFetch({ apiFetch: (req, server) => app.fetch(req, server as never), distDir });
const port = Number(process.env.PORT) || 5000;
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch, idleTimeout: 120 });

const c = redactedConfig(config);
console.log(`[serve] web ${distDir} + api /api on http://0.0.0.0:${server.port}`);
console.log(`[serve] chain ${c.chainId}; router ${c.paymentRouter ?? "NOT SET"}; relayer ${chain?.relayerAddress ?? "NOT CONFIGURED"}; relayer key ${c.relayerKey}; demo faucet ${faucet ? faucet.address : "off"}`);
console.log(`[serve] plugins: ${mounted.join(", ") || "none"}`);
