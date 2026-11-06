#!/usr/bin/env bun
// TESTNET-ONLY: pools the scarce test USDT into the deployer wallet, which is the wallet POST /demo/fund pays from
// (payer A 4.90, the demo investor 0.95, payer B 1.00 in the live flow). Every move is gasless for the source wallet:
//
//   1. Router -> demo merchant: the 1.00 USDT still held by PaymentRouter for the first real payment (W1's
//      FirstPayment invoice) is withdrawn with the merchant's EIP-712 `Withdraw` signature (withdrawWithSig).
//   2. demo payer and demo merchant -> deployer: each signs an EIP-3009 `TransferWithAuthorization` for its whole USDT
//      balance; the deployer submits it and pays the WBT gas.
//
// The deployer key submits everything. The relayer key is never used here: the API's send queue owns its nonce.
// Each step is skipped when there is nothing to move, so re-running is safe.
//
//   bun --env-file=.env.local scripts/pool-usdt.ts            # do it
//   bun --env-file=.env.local scripts/pool-usdt.ts --dry-run  # balances + what it would do, sends nothing
//
// Prints addresses, amounts and tx hashes only; never prints a key.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  USDT_ADDRESS, USDT_DECIMALS, USDT_DOMAIN, buildWithdrawTypedData, explorerTx, paymentRouterAbi, whitechainTestnet,
  ROUTER_STATUS, type Address, type Hex,
} from "../packages/shared/src/index.ts";

// viem lives in the workspaces (bun's isolated linker), not at the repo root: resolve it from apps/api.
const fromApi = (spec: string) => import(Bun.resolveSync(spec, join(import.meta.dir, "../apps/api")));
const viem: typeof import("viem") = await fromApi("viem");
const { privateKeyToAccount }: typeof import("viem/accounts") = await fromApi("viem/accounts");
const { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, hexToSignature, getAddress, toHex } = viem;

const DRY = process.argv.includes("--dry-run");
const rpc = process.env.WC_RPC_URL || "https://rpc.testnet.whitechain.io";
if (Number(process.env.WC_CHAIN_ID || 1874) !== 1874) { console.error("refusing: Whitechain testnet (1874) only"); process.exit(1); }

const WALLETS: Record<string, Address> = {
  deployer: "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb",
  relayer: "0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F",
  merchant: "0xC038827b4E362B0de1Be859377508613CD028946",
  payer: "0x32c84603C9848FFa470FB07C9bCe820944D04c52",
  investor: "0xe7CfE30ED69450427FFf6bbBe143E5da71E4AF87",
};

function account(envName: string, expected: Address) {
  const k = process.env[envName];
  if (!k) { console.error(`${envName} missing (run: bash scripts/load-env.sh, then pass --env-file=.env.local)`); process.exit(1); }
  const a = privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex);
  if (getAddress(a.address) !== getAddress(expected)) { console.error(`${envName} is not ${expected}`); process.exit(1); }
  return a;
}
const deployer = account("DEPLOYER_PRIVATE_KEY", WALLETS.deployer);
const merchant = account("DEMO_MERCHANT_PRIVATE_KEY", WALLETS.merchant);
const payer = account("DEMO_PAYER_PRIVATE_KEY", WALLETS.payer);

const deployment = JSON.parse(readFileSync(join(import.meta.dir, "../contracts/deployments/1874.json"), "utf8"));
const router = getAddress(deployment.paymentRouter) as Address;
const usdt = getAddress(process.env.USDT_ADDRESS || USDT_ADDRESS) as Address;
const pub = createPublicClient({ chain: whitechainTestnet, transport: http(rpc) });
const wallet = createWalletClient({ account: deployer, chain: whitechainTestnet, transport: http(rpc) });

// TetherTokenV2 EIP-3009 transferWithAuthorization (v, r, s form). Same domain as the receiveWithAuthorization in usdt.ts.
const transferWithAuthorizationAbi = [{
  type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable", outputs: [],
  inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
  ],
}] as const;
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

const usdtOf = (a: Address) => pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const fmt = (v: bigint) => formatUnits(v, USDT_DECIMALS);
const hashes: { step: string; hash: Hex }[] = [];

async function balances(title: string) {
  console.log(`\n${title}`);
  for (const [name, a] of Object.entries({ ...WALLETS, router })) {
    const [wbt, u] = await Promise.all([pub.getBalance({ address: a }), usdtOf(a)]);
    console.log(`  ${name.padEnd(9)} ${a}  WBT ${formatEther(wbt).padEnd(22)} USDT ${fmt(u)}`);
  }
}

/** Simulate, pad the gas (USDT writes to an empty slot cost ~20k more than the estimate can know), send, wait. */
async function send(step: string, req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  const { request } = await pub.simulateContract({ ...req, account: deployer } as Parameters<typeof pub.simulateContract>[0]);
  const gas = await pub.estimateGas({ account: deployer, to: req.address, data: viem.encodeFunctionData(req as Parameters<typeof viem.encodeFunctionData>[0]) });
  const hash = await wallet.writeContract({ ...(request as Parameters<typeof wallet.writeContract>[0]), gas: (gas * 13n) / 10n + 25_000n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  console.log(`  ${step}: ${r.status} ${explorerTx(hash)}`);
  if (r.status !== "success") process.exit(3);
  hashes.push({ step, hash });
}

await balances(`Before pooling${DRY ? " (dry run: nothing is sent)" : ""}`);
const gasLeft = await pub.getBalance({ address: deployer.address });
if (gasLeft < 10n ** 15n) { console.error("deployer has under 0.001 WBT for gas"); process.exit(2); }

// 1. withdraw the merchant's balance still held by the router for the first payment
const firstId = deployment.firstPayment?.invoiceId as Hex | undefined;
if (firstId) {
  const inv = await pub.readContract({ address: router, abi: paymentRouterAbi, functionName: "getInvoice", args: [firstId] }) as
    { merchant: Address; status: number; balance: bigint };
  const status = ROUTER_STATUS[inv.status];
  console.log(`\nRouter invoice ${firstId}: status ${status}, held ${fmt(inv.balance)} USDT for ${inv.merchant}`);
  if (inv.balance > 0n && getAddress(inv.merchant) === getAddress(merchant.address) && (status === "paid" || status === "refunded")) {
    if (DRY) console.log(`  would withdraw ${fmt(inv.balance)} USDT to the merchant (withdrawWithSig, merchant signs, deployer submits)`);
    else {
      const nonce = await pub.readContract({ address: router, abi: paymentRouterAbi, functionName: "nonces", args: [merchant.address] }) as bigint;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const typed = buildWithdrawTypedData(router, { invoiceId: firstId, nonce, deadline });
      const signature = await merchant.signTypedData(typed);
      await send("withdrawWithSig (router -> merchant)", { address: router, abi: paymentRouterAbi, functionName: "withdrawWithSig", args: [firstId, deadline, signature] });
    }
  } else console.log("  nothing to withdraw");
}

// 2. payer and merchant -> deployer, gasless for them (EIP-3009 transferWithAuthorization)
for (const [name, src] of [["payer", payer], ["merchant", merchant]] as const) {
  const value = await usdtOf(src.address);
  if (value === 0n) { console.log(`\n${name}: 0 USDT, nothing to move`); continue; }
  console.log(`\n${name}: moving ${fmt(value)} USDT -> deployer`);
  if (DRY) continue;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const message = { from: src.address, to: deployer.address, value, validAfter: 0n, validBefore, nonce };
  const sig = await src.signTypedData({ domain: USDT_DOMAIN, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message });
  const { v, r, s } = hexToSignature(sig);
  await send(`transferWithAuthorization (${name} -> deployer)`, {
    address: usdt, abi: transferWithAuthorizationAbi, functionName: "transferWithAuthorization",
    args: [message.from, message.to, value, 0n, validBefore, nonce, Number(v), r, s],
  });
}

await balances("After pooling");
if (hashes.length) {
  console.log("\nTransactions:");
  for (const h of hashes) console.log(`  ${h.step}: ${h.hash}`);
}
process.exit(0);
