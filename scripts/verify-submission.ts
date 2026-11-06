#!/usr/bin/env bun
// PaisaLink submission verifier. Exits non-zero on any FAIL.
//   bun scripts/verify-submission.ts [--only=links,tx,contracts,transfer,files,todo,secrets,tracked] [--offline]
// Reads .env.local only to look for its secret VALUES inside repo files; values are never printed.
// The only git use is the read-only `git ls-files` below.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RPC = "https://rpc.testnet.whitechain.io";
const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
const EXPLORER = "https://explorer.testnet.whitechain.io";
const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_URLS = new Set([RPC, ARKIV_RPC]);

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const offline = args.includes("--offline");
const want = (name: string) => !only || only.includes(name);

type Level = "PASS" | "FAIL" | "WARN" | "SKIP";
const results: { level: Level; group: string; msg: string }[] = [];
const rec = (level: Level, group: string, msg: string) => {
  results.push({ level, group, msg });
  console.log(`${{ PASS: "[PASS]", FAIL: "[FAIL]", WARN: "[warn]", SKIP: "[skip]" }[level]} ${group}: ${msg}`);
};

// ---------------------------------------------------------------- helpers
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

async function timed<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return await Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms + 100))]);
}

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await timed(fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  const j: any = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function gitTracked(): Promise<string[] | null> {
  try {
    const p = Bun.spawn(["git", "ls-files"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return null;
    return out.split("\n").filter(Boolean);
  } catch { return null; }
}

const TEXT_EXT = /\.(md|ts|tsx|js|jsx|mjs|json|sol|toml|yml|yaml|sh|txt|css|html|env|example|lock)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "research", "dist", "build", "out", "cache", "lib", ".data", "test-results", "playwright-report", "broadcast", "coverage", "screenshots"]);

/** Files that exist on disk and are not obviously ignored: catches work that is not committed yet. */
function walk(dir = ROOT, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) && !(e.name === "lib" && !dir.includes("contracts"))) continue;
      walk(join(dir, e.name), acc);
    } else if (e.isFile()) acc.push(relative(ROOT, join(dir, e.name)));
  }
  return acc;
}
const isText = (f: string) => TEXT_EXT.test(f) || /(^|\/)(LICENSE|\.gitignore|\.env\.example)$/.test(f);
const SELF = new Set(["scripts/verify-submission.ts", "docs/verification.md"]);

// ---------------------------------------------------------------- 1. links
async function checkLinks() {
  const readme = read("README.md");
  if (!readme) return rec("FAIL", "links", "README.md missing");
  const urls = [...new Set([...readme.matchAll(/https?:\/\/[^\s)>"'`|\]]+/g)].map((m) => m[0].replace(/[.,;:*]+$/, "")))];
  rec("PASS", "links", `${urls.length} distinct URLs in README.md`);
  for (let u of urls) {
    const host = new URL(u).hostname;
    if (/^(localhost|127\.|100\.\d+\.|192\.168\.|10\.)/.test(host)) { rec("WARN", "links", `local URL, not checked (fine for setup steps): ${u}`); continue; }
    if (RPC_URLS.has(u.replace(/\/+$/, ""))) {
      try { await rpc(u, "eth_chainId", []); rec("PASS", "links", `RPC answers: ${u}`); }
      catch (e) { rec("FAIL", "links", `RPC ${u}: ${(e as Error).message}`); }
      continue;
    }
    if (offline) { rec("SKIP", "links", `offline: ${u}`); continue; }
    try {
      u = u.replace(/\.git$/, ""); // clone URL -> repo page
      let r = await timed(fetch(u, { redirect: "follow", headers: { "user-agent": "paisalink-verify/1" } }));
      if (r.status === 405 || r.status === 403) r = await timed(fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "paisalink-verify/1" } }));
      if (r.status === 200) rec("PASS", "links", `200 ${u}`);
      else rec("FAIL", "links", `${r.status} ${u}`);
    } catch (e) { rec("FAIL", "links", `${u}: ${(e as Error).message}`); }
  }
}

// ---------------------------------------------------------------- 2. tx hashes
async function checkTx() {
  const readme = read("README.md");
  if (!readme) return rec("FAIL", "tx", "README.md missing");
  const found = new Map<string, "whitechain" | "arkiv" | "unknown">();
  for (const m of readme.matchAll(/(https?:\/\/[^\s)>"'`|]+)?\/tx\/(0x[0-9a-fA-F]{64})/g)) {
    const host = m[1] ?? "";
    found.set(m[2].toLowerCase(), host.startsWith(ARKIV_EXPLORER) ? "arkiv" : host.startsWith(EXPLORER) ? "whitechain" : "unknown");
  }
  for (const m of readme.matchAll(/0x[0-9a-fA-F]{64}/g)) if (!found.has(m[0].toLowerCase())) found.set(m[0].toLowerCase(), "unknown");
  if (found.size === 0) return rec("FAIL", "tx", "no transaction hashes in README.md (the USDT payment tx table is empty)");
  for (const [hash, kind] of found) {
    const order = kind === "arkiv" ? [ARKIV_RPC, RPC] : [RPC, ARKIV_RPC];
    let done = false;
    for (const url of order) {
      let rcpt: any;
      try { rcpt = await rpc(url, "eth_getTransactionReceipt", [hash]); } catch { continue; }
      if (!rcpt) continue;
      const where = url === RPC ? "Whitechain" : "Arkiv Rabdi";
      if (kind === "whitechain" && url !== RPC) continue;
      if (rcpt.status === "0x1") rec("PASS", "tx", `${hash} success on ${where} (block ${parseInt(rcpt.blockNumber, 16)})`);
      else rec("FAIL", "tx", `${hash} found on ${where} but status=${rcpt.status}`);
      done = true; break;
    }
    if (!done) rec("FAIL", "tx", `${hash} has no receipt on Whitechain testnet${kind === "whitechain" ? "" : " or Arkiv Rabdi"}`);
  }
}

// ---------------------------------------------------------------- 3. contracts
let routerAddr: string | null = null;
let deployBlock = 0;
async function checkContracts() {
  const raw = read("contracts/deployments/1874.json");
  if (!raw) return rec("FAIL", "contracts", "contracts/deployments/1874.json missing");
  const d = JSON.parse(raw);
  if (!d.deployed) return rec("FAIL", "contracts", "deployments/1874.json says deployed:false (contracts not on Whitechain yet)");
  routerAddr = d.paymentRouter; deployBlock = Number(d.deployBlock ?? 0);
  for (const [name, addr] of [["PaymentRouter", d.paymentRouter], ["InvoiceNote", d.invoiceNote]] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr ?? "")) { rec("FAIL", "contracts", `${name} address missing in deployments file`); continue; }
    try {
      const code = await rpc(RPC, "eth_getCode", [addr, "latest"]);
      if (!code || code === "0x") { rec("FAIL", "contracts", `${name} ${addr} has no code`); continue; }
      rec("PASS", "contracts", `${name} ${addr} has code (${(code.length - 2) / 2} bytes)`);
    } catch (e) { rec("FAIL", "contracts", `${name} eth_getCode: ${(e as Error).message}`); continue; }
    if (offline) { rec("SKIP", "contracts", `offline: Blockscout verification of ${name}`); continue; }
    try {
      const r = await timed(fetch(`${EXPLORER}/api?module=contract&action=getsourcecode&address=${addr}`));
      const j: any = await r.json();
      const c = Array.isArray(j.result) ? j.result[0] : j.result;
      const verified = c && c.SourceCode && c.SourceCode.length > 0 && !/not verified/i.test(String(c.ABI));
      if (verified) rec("PASS", "contracts", `${name} verified on Blockscout (${c.ContractName ?? "?"}, ${c.CompilerVersion ?? "?"})`);
      else rec("FAIL", "contracts", `${name} ${addr} is NOT verified on Blockscout`);
    } catch (e) { rec("FAIL", "contracts", `${name} Blockscout: ${(e as Error).message}`); }
  }
}

// ---------------------------------------------------------------- 4. USDT Transfer involving the router
async function checkTransfer() {
  if (!routerAddr) {
    const d = JSON.parse(read("contracts/deployments/1874.json") ?? "{}");
    routerAddr = d.paymentRouter ?? null; deployBlock = Number(d.deployBlock ?? 0);
  }
  if (!routerAddr) return rec("FAIL", "transfer", "PaymentRouter not deployed, no USDT Transfer to look for");
  const pad = "0x" + routerAddr.slice(2).toLowerCase().padStart(64, "0");
  const latest = parseInt(await rpc(RPC, "eth_blockNumber", []), 16);
  let from = deployBlock > 0 ? deployBlock - 1 : Math.max(latest - 200_000, 0), total = 0; // RPC allows 10000 blocks per getLogs
  const side: Record<string, number> = { to: 0, from: 0 };
  try {
    for (let s = from; s <= latest && total === 0; s += 10_000) {
      const e = Math.min(s + 9_999, latest);
      for (const [label, topics] of [["to", [TRANSFER_TOPIC, null, pad]], ["from", [TRANSFER_TOPIC, pad]]] as const) {
        const logs = await rpc(RPC, "eth_getLogs", [{ address: USDT, fromBlock: "0x" + s.toString(16), toBlock: "0x" + e.toString(16), topics }]);
        side[label] += logs.length; total += logs.length;
      }
    }
  } catch (e) { return rec("FAIL", "transfer", `eth_getLogs: ${(e as Error).message}`); }
  if (total > 0) rec("PASS", "transfer", `USDT Transfer involving the router found (to router: ${side.to}, from router: ${side.from}, scanned from block ${from})`);
  else rec("FAIL", "transfer", `no USDT Transfer to/from ${routerAddr} since block ${from}`);
}

// ---------------------------------------------------------------- 5. required files
const PLACEHOLDER = /\b(lorem ipsum|TBD|FIXME|coming soon|to be written|fill me in|your text here)\b|\bPLACEHOLDER\b/;
function checkFiles() {
  // Arkiv "new app whose data lives in Arkiv" track (research/tracks.md): schema + friction always, one file per
  // judging criterion (reach, why-arkiv, how-you-use-arkiv), swarm.md because the Arkiv + Swarm bonus is attempted.
  const files: [string, number][] = [
    ["README.md", 3000], ["AI_USAGE.md", 600], ["WHITECHAIN_FEEDBACK.md", 300], ["LICENSE", 500],
    ["arkiv/schema.md", 800], ["arkiv/friction.md", 600], ["arkiv/reach.md", 400], ["arkiv/why-arkiv.md", 400],
    ["arkiv/how-you-use-arkiv.md", 400], ["arkiv/swarm.md", 800],
    ["docs/WORLD_DEBRIEF.md", 1500], ["docs/submission.md", 1500], ["docs/demo-script.md", 800],
  ];
  for (const [f, min] of files) {
    const t = read(f);
    if (t === null) { rec("FAIL", "files", `${f} missing`); continue; }
    const problems: string[] = [];
    if (t.trim().length < min) problems.push(`only ${t.trim().length} chars (expected >= ${min})`);
    const ph = t.match(PLACEHOLDER); if (ph) problems.push(`placeholder word "${ph[0]}"`);
    if (f === "LICENSE" && !/MIT License/i.test(t)) problems.push("not an MIT license text");
    if (f === "README.md" && !/0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb/i.test(t)) problems.push("Arkiv writer wallet address missing");
    if (f === "README.md" && !/query\.ts|runnable query|bun run scripts\/query/i.test(t)) problems.push("no runnable Arkiv query line");
    if (problems.length) rec("FAIL", "files", `${f}: ${problems.join("; ")}`);
    else rec("PASS", "files", `${f} present (${t.trim().length} chars)`);
  }
}

// ---------------------------------------------------------------- 6. TODO(live)
function checkTodos(files: string[]) {
  let live = 0, owner = 0;
  for (const f of files) {
    if (SELF.has(f) || f.startsWith("docs/prompts/") || f === "docs/handoffs.md" || f === "PLAN.md" || !isText(f)) continue;
    let t: string; try { t = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    t.split("\n").forEach((line, i) => {
      if (line.includes("TODO(live)")) { live++; rec("FAIL", "todo", `TODO(live) ${f}:${i + 1}: ${line.trim().slice(0, 110)}`); }
      else if (line.includes("TODO(owner)")) { owner++; rec("WARN", "todo", `TODO(owner) ${f}:${i + 1}`); }
    });
  }
  if (!live) rec("PASS", "todo", "no TODO(live) left");
  rec(live ? "FAIL" : "PASS", "todo", `${live} TODO(live), ${owner} TODO(owner)`);
}

// ---------------------------------------------------------------- 7. secrets
function envSecretValues(): string[] {
  const t = read(".env.local"); if (!t) return [];
  const vals: string[] = [];
  for (const line of t.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^['"]|['"]$/g, "");
    if (/(KEY|TOKEN|SECRET|PK|PRIVATE|PASSWORD|MNEMONIC)/.test(m[1]) && v.length >= 16) vals.push(v);
  }
  return vals;
}

function checkSecrets(files: string[]) {
  const secrets = envSecretValues();
  const keyLine = /(private|secret|priv[_-]?key|\bpk\b|_pk\b|signing[_-]?key|mnemonic|api[_-]?key|access[_-]?key|\bkey\b)/i;
  const benign = /(public\s*key|publickey|keccak|hash|codehash|selector|typehash|salt|topic|bytes32|invoiceid|nonce|txhash|tx hash|sha256|digest|swarm|reference|anvil)/i; // "anvil": the well-known public anvil dev keys used in tests
  let hits = 0, scanned = 0;
  for (const f of files) {
    if (SELF.has(f) || !isText(f) || f === "bun.lock") continue;
    let t: string; try { if (statSync(join(ROOT, f)).size > 2_000_000) continue; t = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    scanned++;
    t.split("\n").forEach((line, i) => {
      if (/0x[0-9a-fA-F]{64}\b|\b[0-9a-fA-F]{64}\b/.test(line) && keyLine.test(line) && !benign.test(line)) {
        hits++; rec("FAIL", "secrets", `64-hex next to a key word, ${f}:${i + 1} (value not shown)`);
      }
      for (const s of secrets) if (line.includes(s)) { hits++; rec("FAIL", "secrets", `a value from .env.local appears in ${f}:${i + 1} (value not shown)`); }
    });
  }
  rec(hits ? "FAIL" : "PASS", "secrets", `${scanned} text files scanned (tracked + uncommitted), ${secrets.length} .env.local secret values searched, ${hits} hits`);
  if (!existsSync(join(ROOT, ".env.local"))) rec("WARN", "secrets", ".env.local not present: value search skipped");
}

function checkTracked(tracked: string[] | null) {
  if (!tracked) return rec("FAIL", "tracked", "git ls-files failed (not a git repo?)");
  const bad = tracked.filter((f) => /(^|\/)\.env(\..*)?\.local$/.test(f) || /(^|\/)\.env\.local$/.test(f) || f === ".env" || f.startsWith("research/") || f === "CLAUDE.md");
  if (bad.length) bad.forEach((f) => rec("FAIL", "tracked", `${f} is tracked by git`));
  else rec("PASS", "tracked", `.env.local, research/ and CLAUDE.md are not tracked (${tracked.length} tracked files)`);
  const keyFiles = tracked.filter((f) => /\.(pem|key|p12)$/i.test(f) || /(^|\/)id_(rsa|ed25519)$/.test(f));
  if (keyFiles.length) keyFiles.forEach((f) => rec("FAIL", "tracked", `key-like file tracked: ${f}`)); else rec("PASS", "tracked", "no .pem/.key files tracked");
}

// ---------------------------------------------------------------- run
const tracked = await gitTracked();
const scanSet = [...new Set([...(tracked ?? []), ...walk()])].filter((f) => existsSync(join(ROOT, f)) && !f.startsWith("research/") && !f.startsWith("contracts/lib/") && !f.startsWith("node_modules/"));
const steps: [string, () => unknown][] = [
  ["tracked", () => checkTracked(tracked)], ["files", checkFiles], ["todo", () => checkTodos(scanSet)], ["secrets", () => checkSecrets(scanSet)],
  ["links", checkLinks], ["tx", checkTx], ["contracts", checkContracts], ["transfer", checkTransfer],
];
for (const [name, fn] of steps) {
  if (!want(name)) continue;
  console.log(`\n== ${name} ==`);
  try { await fn(); } catch (e) { rec("FAIL", name, `crashed: ${(e as Error).message}`); }
}

const count = (l: Level) => results.filter((r) => r.level === l).length;
console.log(`\nSummary: ${count("PASS")} pass, ${count("FAIL")} fail, ${count("WARN")} warn, ${count("SKIP")} skipped`);
const failedGroups = [...new Set(results.filter((r) => r.level === "FAIL").map((r) => r.group))];
if (failedGroups.length) console.log(`Failing groups: ${failedGroups.join(", ")}`);
process.exit(count("FAIL") ? 1 : 0);
