# S4: run the live testnet flow once and collect the evidence (Sonnet 5.5)

Read `docs/prompts/common.md` first; all its rules apply.

## Context
- W8 prepared everything (see its note in `docs/handoffs.md`).
- The deployer holds about 7.32 test USDT. That is enough for **exactly one** full run: a 4.90 invoice, a 0.90 refund, and a 1.00 note sold for 0.95, then settled.
- The demo faucet allows 5 grants per IP per hour, and a run uses 3.
- Do not re-run the whole spec after a failure without asking the coordinator first.

## Steps
1. Preflight, with no spending:
   - `curl http://100.125.124.63:8787/health` and `/config` respond.
   - Read the deployer's USDT balance with `cast call` and confirm it is at least 6.85.
2. Run the spec once, from `apps/web`:
   ```
   E2E_LIVE=1 E2E_BASE_URL=http://100.125.124.63:5173 E2E_API_URL=http://100.125.124.63:8787 bun --env-file=../../.env.local node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts e2e/live.spec.ts --project=desktop
   ```
3. If a step fails:
   - Collect the error, the screenshot and the last 80 lines of the API log (`/tmp/claude-1000/-home-lechuuu/d6f9ff42-eda5-4ec0-b509-c856e7d36b73/scratchpad/api.log`).
   - Check on chain how far the flow got.
   - Stop and report. Don't change app code. Don't restart servers.
4. Collect every transaction hash the run produced, from the API (`/invoices/:id`, `/notes`) or the explorer API. You need: invoice create, gasless pay, refund, note issue, fund, escrowed customer pay, rule-refusal (that one reverts in simulation, so there is no tx), and settle.
5. Verify each hash on chain: run `cast receipt <hash> --rpc-url https://rpc.testnet.whitechain.io` and check that the status is 1.
6. Find the Arkiv entity keys for the invoices and the note, and check that they read back with `bun scripts/query.ts`, or whatever the repo provides for that.
7. Write `docs/live-run.md`:
   - a table with columns step, what it shows, tx hash, explorer link (`https://explorer.testnet.whitechain.io/tx/<hash>`), status
   - the Arkiv entity links (`https://rabdi.explorer.arkiv.network/entity/<key>`)
   - the screenshot paths
   - the run time, in IST
   - the final balances

## Rules
- No git.
- Never print private keys. The spec loads the merchant key; don't turn on trace, because it would capture it.
- Make no edits outside `docs/live-run.md`, except `apps/web/e2e/screenshots/` written by the run itself.

## Report
Keep it under 250 words: pass/fail per step, the tx table, anything odd.
