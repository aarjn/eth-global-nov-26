// TESTNET-ONLY demo faucet (CLI): sends test USDT on Whitechain testnet from the deployer to a demo wallet.
//   bun --env-file=.env.local scripts/fund-demo.ts <address|payer|merchant|investor> [amountUsdt=60]
//   bun --env-file=.env.local scripts/fund-demo.ts --balances
// The implementation lives in apps/api (so it resolves viem from that workspace under bun's isolated linker).
await import("../apps/api/src/fund-demo-cli.ts");
