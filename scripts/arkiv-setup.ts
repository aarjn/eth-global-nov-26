#!/usr/bin/env bun
// Arkiv setup check and first write.
//
//   bun --env-file=.env.local scripts/arkiv-setup.ts            # status only (no writes)
//   bun --env-file=.env.local scripts/arkiv-setup.ts --write    # also upsert the demo merchant entity
//
// Prints addresses and links, never keys. Refuses to write without tGLM, and without an access key
// unless ARKIV_ALLOW_ANON_WRITES=1 (anonymous writes risk the ~27 min 429 ANON_COST_LIMITED lockout).
import { createArkivStore, explorerArkivAddress } from "../packages/arkiv/src/index.ts";

const DEMO_MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946" as const;
const DEMO_HANDLE = "priya.designs";
const write = process.argv.includes("--write");

const store = createArkivStore({
  ARKIV_PRIVATE_KEY: process.env.ARKIV_PRIVATE_KEY,
  ARKIV_ACCESS_KEY: process.env.ARKIV_ACCESS_KEY ?? "",
  ARKIV_ALLOW_ANON_WRITES: process.env.ARKIV_ALLOW_ANON_WRITES,
});
const h = await store.health();
const tglm = Number(BigInt(h.writerBalanceWei) / 10n ** 14n) / 1e4;
console.log(`network      Rabdi, chain ${h.chainId}, block ${h.block}`);
console.log(`writer       ${h.writer}  ${explorerArkivAddress(h.writer)}`);
console.log(`can sign     ${h.canWrite ? "yes (ARKIV_PRIVATE_KEY set)" : "no (ARKIV_PRIVATE_KEY missing)"}`);
console.log(`access key   ${h.accessKey ? "set" : "MISSING (public endpoint, heavily rate limited)"}`);
console.log(`tGLM balance ${tglm}`);

if (!write) process.exit(0);
if (!h.canWrite) throw new Error("cannot write: ARKIV_PRIVATE_KEY is not set (run `bash scripts/load-env.sh`)");
if (BigInt(h.writerBalanceWei) === 0n) {
  console.error("cannot write: the writer has 0 tGLM. Claim at https://hub.arkiv.network/faucet (see docs/handoffs.md).");
  process.exit(1);
}

const existing = await store.getMerchant(DEMO_MERCHANT);
const m = await store.upsertMerchant(
  existing ?? { wallet: DEMO_MERCHANT, handle: DEMO_HANDLE, verified: false, gasUsedWei: "0", createdAt: Math.floor(Date.now() / 1000) },
);
const w = store.writes.at(-1)!;
console.log(`\nmerchant @${m.handle} ${w.op}: ${w.explorerUrl}${w.txHash ? `\ntx ${w.txHash}` : ""}`);
const back = await store.getMerchant(DEMO_MERCHANT);
console.log(`read back    ${back ? `@${back.handle}, verified=${back.verified}` : "NOT FOUND (node lag? retry the read)"}`);
process.exit(0);
