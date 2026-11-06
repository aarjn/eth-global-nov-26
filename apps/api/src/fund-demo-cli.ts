// TESTNET-ONLY demo faucet (CLI). Sends test USDT on Whitechain testnet (chain id 1874) from the deployer wallet
// to a demo wallet, so a judge can try the gasless checkout. Same thing POST /demo/fund does in the API.
//
//   bun --env-file=.env.local scripts/fund-demo.ts <address> [amountUsdt=60]
//   bun --env-file=.env.local scripts/fund-demo.ts payer        # the demo payer from PLAN (0x32c8…4c52)
//   bun --env-file=.env.local scripts/fund-demo.ts --balances   # print WBT/USDT balances of the project wallets
//
// Prints addresses and tx hashes only; never prints a key.
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, getAddress, http, isAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, USDT_DECIMALS, whitechainTestnet, explorerTx } from "@paisalink/shared";

const WALLETS: Record<string, Address> = {
  deployer: "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb",
  relayer: "0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F",
  merchant: "0xC038827b4E362B0de1Be859377508613CD028946",
  payer: "0x32c84603C9848FFa470FB07C9bCe820944D04c52",
  investor: "0xe7CfE30ED69450427FFf6bbBe143E5da71E4AF87",
};

const rpc = process.env.WC_RPC_URL || "https://rpc.testnet.whitechain.io";
const chainId = Number(process.env.WC_CHAIN_ID || 1874);
if (chainId !== 1874) { console.error("refusing: the demo faucet only runs on Whitechain testnet (1874)"); process.exit(1); }
const pub = createPublicClient({ chain: whitechainTestnet, transport: http(rpc) });
const usdt = (getAddress(process.env.USDT_ADDRESS || USDT_ADDRESS)) as Address;

const arg = process.argv[2];
if (!arg || arg === "-h" || arg === "--help") {
  console.log("usage: bun --env-file=.env.local scripts/fund-demo.ts <address|deployer|relayer|merchant|payer|investor> [amountUsdt=60] | --balances");
  process.exit(arg ? 0 : 1);
}

if (arg === "--balances") {
  for (const [name, a] of Object.entries(WALLETS)) {
    const [wbt, u] = await Promise.all([pub.getBalance({ address: a }), pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [a] })]);
    console.log(`${name.padEnd(9)} ${a}  WBT ${formatEther(wbt).padEnd(22)} USDT ${formatUnits(u, USDT_DECIMALS)}`);
  }
  process.exit(0);
}

const to = WALLETS[arg] ?? (isAddress(arg) ? getAddress(arg) : null);
if (!to) { console.error(`not an address: ${arg}`); process.exit(1); }
const amount = parseUnits(process.argv[3] || "60", USDT_DECIMALS);
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) { console.error("DEPLOYER_PRIVATE_KEY missing (run: bun run env, then pass --env-file=.env.local)"); process.exit(1); }
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
const wallet = createWalletClient({ account, chain: whitechainTestnet, transport: http(rpc) });

const have = await pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const gas = await pub.getBalance({ address: account.address });
console.log(`[demo faucet] from ${account.address} (USDT ${formatUnits(have, USDT_DECIMALS)}, WBT ${formatEther(gas)}) -> ${to}: ${formatUnits(amount, USDT_DECIMALS)} test USDT`);
if (have < amount) { console.error("[demo faucet] deployer does not hold enough test USDT"); process.exit(2); }
if (gas === 0n) { console.error("[demo faucet] deployer has no WBT for gas"); process.exit(2); }

const { request } = await pub.simulateContract({ address: usdt, abi: erc20Abi, functionName: "transfer", args: [to, amount], account });
const hash = await wallet.writeContract(request);
console.log(`[demo faucet] sent ${hash}`);
const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
console.log(`[demo faucet] ${r.status} in block ${r.blockNumber}: ${explorerTx(hash)}`);
process.exit(r.status === "success" ? 0 : 3);
