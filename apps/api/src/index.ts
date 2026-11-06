// PaisaLink API + relayer. Run: bun --env-file=../../.env.local src/index.ts
// Storage is Arkiv only (createArkivStore from @paisalink/arkiv). There is no in-memory fallback.
import { createArkivStore } from "@paisalink/arkiv";
import { loadConfig, redactedConfig } from "./config";
import { createApp } from "./app";
import { createProbe, createViemFaucetChain, createViemRouterChain } from "./viem-chain";

const config = loadConfig();

const store = createArkivStore(process.env as Parameters<typeof createArkivStore>[0]);
const chain = createViemRouterChain(config);
const faucet = createViemFaucetChain(config);
const { app, mounted } = await createApp({ config, store, chain, faucet, probe: createProbe(config) });

const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 120 });
const c = redactedConfig(config);
console.log(`[api] listening on http://localhost:${server.port}`);
console.log(`[api] chain ${c.chainId} rpc ${c.rpcUrl}; router ${c.paymentRouter ?? "NOT SET"}; relayer ${chain?.relayerAddress ?? "NOT CONFIGURED"}; relayer key ${c.relayerKey}; demo faucet ${faucet ? faucet.address : "off"}`);
console.log(`[api] plugins: ${mounted.join(", ") || "none"}`);
