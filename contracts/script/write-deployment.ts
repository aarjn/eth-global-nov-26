// Writes contracts/deployments/1874.json from Foundry's broadcast of Deploy.s.sol (real tx hashes + block).
// Usage (from contracts/): bun script/write-deployment.ts
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const broadcast = await Bun.file(join(dir, "broadcast/Deploy.s.sol/1874/run-latest.json")).json();
const txs: Record<string, string> = {};
const addr: Record<string, string> = {};
let deployBlock: number | null = null;
const cast = `${process.env.HOME}/.foundry/bin/cast`;
const checksum = (a: string) => Bun.spawnSync([cast, "to-check-sum-address", a]).stdout.toString().trim();

broadcast.transactions.forEach((t: any, i: number) => {
  const receipt = broadcast.receipts.find((r: any) => r.transactionHash === t.hash);
  if (!receipt || receipt.status !== "0x1") throw new Error(`tx ${i} (${t.hash}) has no successful receipt`);
  const block = Number(receipt.blockNumber);
  if (t.transactionType === "CREATE") {
    const key = t.contractName === "PaymentRouter" ? "paymentRouter" : t.contractName === "InvoiceNote" ? "invoiceNote" : t.contractName;
    addr[key] = checksum(t.contractAddress);
    txs[key] = t.hash;
    if (key === "paymentRouter") deployBlock = block;
  } else {
    const fn = String(t.function ?? "call").split("(")[0];
    const label = fn === "setAllowed" ? `setAllowed:${t.arguments?.[0]}` : fn;
    txs[label] = t.hash;
  }
});

if (!addr.paymentRouter || !addr.invoiceNote) throw new Error("broadcast does not contain both CREATE txs");

const out = {
  chainId: 1874,
  deployed: true,
  usdt: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  owner: "0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb",
  operator: "0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F",
  paymentRouter: addr.paymentRouter,
  invoiceNote: addr.invoiceNote,
  deployBlock,
  txs,
  explorer: {
    paymentRouter: `https://explorer.testnet.whitechain.io/address/${addr.paymentRouter}`,
    invoiceNote: `https://explorer.testnet.whitechain.io/address/${addr.invoiceNote}`,
  },
};
await Bun.write(join(dir, "deployments/1874.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
