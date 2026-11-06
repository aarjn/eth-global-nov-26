# W2: API + relayer (Opus)

**Own:** `apps/api/**` except `src/world.ts`, `src/swarm.ts`, `src/pdf.ts`, `src/routes/merchants.ts`; plus `scripts/fund-demo.ts`.

Build the Hono-on-bun API from PLAN.md sections 2 ("Relayer with drain protection") and 3 (REST endpoints, error codes), port 8787, CORS for the web app.

- Storage: only through the `PaisaStore` interface in `@paisalink/shared`. The production implementation is `createArkivStore()` from `@paisalink/arkiv` (W4 is building it now in parallel; import it and code against the interface; until it lands, your unit tests use a test-only `MemoryStore` inside `apps/api/test/`). Never wire a memory store into the running server.
- Contracts: import ABIs/addresses from `@paisalink/shared` (`abi/`, `addresses.ts`, published by W1 around 10:15; read `docs/specs/contracts.md`). The merchant never pays gas: the relayer (operator) calls `createInvoiceFor`, `payWithAuthorization`, `refundWithSig`, `withdrawWithSig`. Endpoints that act for a merchant take a merchant EIP-712 signature produced in the browser (typed data builders: add them to `apps/api/src/typed.ts` and request W1/coordinator to move them into shared if the web needs them; or ask via handoffs).
- Relayer: simulate with `eth_call` before sending; one promise-chain tx queue for the single relayer wallet (avoid nonce races); validate the authorization (to == router, value == invoice amount, validBefore ≤ now+10 min, nonce unused, invoice open); World-ID gate (`merchant.verified`), per-merchant daily gas budget (0.02 WBT, tracked and written via `addMerchantGasUsed`), rate limits (10/payer/h, 60/IP/h, 300 global/h). Return the error codes in PLAN.md.
- After each confirmed tx, update the store (invoice state, payment record) from the receipt/event, not from assumptions.
- `GET /merchants/:wallet/export.csv` (accountant export: date, invoice id, memo, amount, payer, tx link, state, refund).
- `GET /health`: chain ids, contract addresses, relayer WBT balance, budget stats.
- `POST /demo/fund {address}`: **testnet-only demo faucet** that sends a small amount of test USDT (e.g. 60) from the deployer to a fresh browser wallet, rate-limited (1 per address, 5 per IP per hour), clearly labelled as demo in responses. `scripts/fund-demo.ts` does the same from the CLI.
- Leave mount points for W6 (`POST /world/verify` in `src/world.ts`), W7 (`src/swarm.ts`, `src/pdf.ts`), W4 (`src/routes/merchants.ts`): import them in your app if the files exist, e.g. via a small `src/plugins.ts` that you own.
- Tests with `bun test` (relayer validation, rate limits, budget, CSV). Run script: `bun --env-file=../../.env.local src/index.ts`.
