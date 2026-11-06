#!/usr/bin/env bun
// Prints a merchant's invoices straight from Arkiv (Rabdi testnet). No API server, no database.
//
//   bun run scripts/query.ts                       # the demo merchant
//   bun run scripts/query.ts 0xYourMerchantAddr    # any merchant
//
// Optional: ARKIV_ACCESS_KEY in the environment (or `bun --env-file=.env.local ...`) for higher rate
// limits. Without it the public endpoint is used, which is enough for this one read.
import { createArkivStore, explorerArkivAddress, getAddress, isAddress, WRITER_ADDRESS } from "../packages/arkiv/src/index.ts";

const DEMO_MERCHANT = "0xC038827b4E362B0de1Be859377508613CD028946";
const arg = process.argv[2] ?? DEMO_MERCHANT;
if (!isAddress(arg)) {
  console.error(`usage: bun run scripts/query.ts [merchantAddress]  (got "${arg}")`);
  process.exit(2);
}
const merchant = getAddress(arg);

// Read-only: the private key is never needed to query.
const store = createArkivStore({
  ARKIV_ACCESS_KEY: process.env.ARKIV_ACCESS_KEY ?? "",
  ARKIV_WRITER_ADDRESS: process.env.ARKIV_WRITER_ADDRESS ?? WRITER_ADDRESS,
});

console.log(`Arkiv Rabdi (chain 7794095), writer ${store.writer}  ${explorerArkivAddress(store.writer)}`);
console.log(`query: ${store.invoicesQueryString(merchant)}\n`);

const [merchantRow, invoices, payments] = await Promise.all([
  store.getMerchant(merchant),
  store.listInvoicesByMerchant(merchant),
  store.listPaymentsByMerchant(merchant),
]);

console.log(
  merchantRow
    ? `merchant @${merchantRow.handle}  ${merchantRow.wallet}  World ID verified: ${merchantRow.verified ? "yes" : "no"}`
    : `merchant ${merchant}: no merchant entity yet`,
);
if (invoices.length === 0) {
  console.log("no invoices");
} else {
  const paid = new Map(payments.map((p) => [p.invoiceId, p]));
  console.table(
    invoices.map((i) => ({
      invoice: `${i.invoiceId.slice(0, 10)}…`,
      state: i.state,
      usdt: i.amountUsdt,
      due: new Date(i.dueAt * 1000).toISOString().slice(0, 10),
      memo: i.memo,
      paid_tx: paid.get(i.invoiceId)?.txHash.slice(0, 12) ?? "",
      swarm: i.swarmRef ? "yes" : "",
    })),
  );
}
console.log(`${invoices.length} invoice(s), ${payments.length} payment(s)`);
process.exit(0);
