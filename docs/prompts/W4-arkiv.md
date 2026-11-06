# W4: Arkiv data layer (Opus)

**Own:** `packages/arkiv/**`, `apps/api/src/routes/merchants.ts`, `scripts/query.ts`, `arkiv/schema.md` (draft), `scripts/arkiv-setup.ts`.

Implement `PaisaStore` (in `@paisalink/shared` `types.ts`) as `createArkivStore(env)` in `packages/arkiv`, with Arkiv as the ONLY database (PLAN.md section 2 "Arkiv: the only database": schemas `paisalink.merchants`, `paisalink.invoices`, `paisalink.payments`, `paisalink.notes`, attributes, TTLs/expiry, `predictEntityKey` idempotent keys, read-after-write wait, `ownedBy(WRITER)`, `watchEntityEvents` over WebSocket for `watchMerchant`).

- SDK: `@arkiv-network/sdk@1.0.1` (+ viem). Read its `.d.ts` first; v1 changed a lot (typed schemas, access keys). Network: Rabdi, chain id 7794095, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, explorer `https://rabdi.explorer.arkiv.network`.
- Writer wallet = `ARKIV_PRIVATE_KEY` (the deployer, `0xf4a0…fDeb`). Access key `ARKIV_ACCESS_KEY` may be empty at start. **First task:** check whether the hub (`https://hub.arkiv.network/faucet`, `https://hub.arkiv.network/access-keys`) supports getting tGLM and creating an access key programmatically with a wallet signature (SIWE-style) using the writer key. If yes, do it and store the key with `printf %s "$KEY" | lechu-secret set hackathon ARKIV_ACCESS_KEY` (never print it), then re-run `bash scripts/load-env.sh`. If it needs a browser/captcha, report that the human must do it, and meanwhile avoid anonymous writes that trigger the 429 `ANON_COST_LIMITED` lockout (~27 min).
- **Checkpoint 11:30 IST:** first real entity visible on the Rabdi explorer (link in your report).
- `apps/api/src/routes/merchants.ts`: a Hono sub-router for `POST /merchants` and `GET /merchants/:wallet/invoices` that W2's app mounts (export `merchantsRoutes(store)`).
- `scripts/query.ts`: a runnable query that prints a merchant's invoices (the README shows it).
- `arkiv/schema.md`: draft of the schema doc (entities, attributes, why each is indexed, expiry choices, what is kept off Arkiv and why).
- Tests: unit tests for mapping (domain object ↔ attributes) and an opt-in live test (`ARKIV_LIVE=1`).
- Keep a running list of SDK friction (confusing docs, errors, workarounds) in your final report: it feeds `arkiv/friction.md`, which is 25% of the score.
