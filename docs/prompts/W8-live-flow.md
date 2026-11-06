# W8: get the live flow ready to run on small amounts (Opus 5.5, high effort)

Read `docs/prompts/common.md` first; all its rules apply. Coordinator time: Fri 6 Nov, ~10:50 IST.

## Situation
- Everything is live on Whitechain testnet 1874:
  - PaymentRouter `0x97613d5bE2c3dd747c110b460Ff2e0FC69701005` and InvoiceNote `0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7`, both verified. The relayer is the router operator.
  - Arkiv writes work. World ID works on staging.
  - API on :8787 and web on :5173 at http://100.125.124.63, env from `.env.local` and `.env.override`.
- **Test USDT is scarce.** About 6.32 USDT exists in total:
  - deployer: 1.32
  - demo payer `0x32c8…4c52`: 5.00, with 0 WBT
  - the router holds 1.00 from the first payment, owed to demo merchant `0xC038…8946`
- **The owner's decision: the demo uses small amounts:**
  - invoice A: 4.90 USDT
  - partial refund: 0.90
  - note on invoice B: face value **1.00**, sold for **0.95**, maturity "2 minutes (demo)"
- **Only the demo merchant `0xC038827b4E362B0de1Be859377508613CD028946` is World-verified.** The staging simulator gives a single nullifier per action, so a fresh browser merchant cannot verify, and the gasless relay refuses an unverified merchant with `MERCHANT_NOT_VERIFIED`. The live run must use the demo merchant key (`DEMO_MERCHANT_PRIVATE_KEY`) as the browser's merchant wallet.

## Tasks
1. **Pool the USDT.** Move the demo payer's USDT to where the flow needs it, gaslessly.
   - The payer has no WBT. Sign EIP-3009 `transferWithAuthorization` with the payer key and submit it from the deployer key. Don't use the relayer key: the API's send queue owns the relayer nonce.
   - Decide the split from how `/demo/fund` and the investor desk actually work. Read `apps/api/src/demo.ts` and `apps/api/src/routes/notes.ts`.
   - Put the commands in a script, `scripts/pool-usdt.ts`. Report the tx hashes.
2. **Make the faucet drip fit the budget.** `DEMO_FUND_USDT` defaults to 60. Set the values in `.env.override`, which is git-ignored and applied last by `scripts/load-env.sh`, so the whole lifecycle fits in the pooled USDT. Check the investor desk's USDT drip too. If it is hard-coded, make it configurable in the API with the current value as default, and add a test.
3. **Point the live spec at the verified merchant, with the small amounts.** Edit `apps/web/e2e/live.spec.ts`:
   - Invoice A is 4.90 and the refund is 0.90.
   - Invoice B is 1.00 and is sold for 0.95. If the sell UI takes a discount rather than a price, set it so the price is 0.95.
   - The merchant context loads `DEMO_MERCHANT_PRIVATE_KEY` into the browser wallet through a test-only `addInitScript`. Find the localStorage key in `apps/web/src/lib/wallet.ts`. Change no app code for this.
   - Read the key from `process.env` and never print it.
   - Payer and investor contexts stay fresh.
4. **Fix only real bugs** you hit in app code, and keep their tests green: `bun test` in apps/api, apps/web and packages, plus `bun run test:contracts`.
5. **Restart the API so it picks up the new env.**
   - Run `bash scripts/load-env.sh`.
   - Find the pid with `ss -ltnp | grep :8787` and kill only that pid. `pkill -f` and `pgrep -f` match your own shell, so don't use them.
   - From `apps/api`, run `nohup bun --env-file=../../.env.local src/index.ts > <scratchpad>/api.log 2>&1 &`. The scratchpad is `/tmp/claude-1000/-home-lechuuu/d6f9ff42-eda5-4ec0-b509-c856e7d36b73/scratchpad`.
   - Confirm `/health` and `/config` respond.
6. **Do not run the full live spec.** A separate Sonnet agent runs it after you finish. A dry check is fine: `0. preconditions`, plus one `createInvoice` call through the API.

## Out of scope
- No git. Don't touch the contracts. Don't create World actions.
- Don't spend USDT on anything except the pooling transfers.

## Report
Follow the common format, and add:
- the USDT and WBT balances of every wallet after pooling
- the exact command the Sonnet agent should run for the live spec
