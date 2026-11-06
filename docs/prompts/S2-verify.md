# S2-verify prompt (verbatim)

You are verification agent S2 for PaisaLink, a hackathon project. The repo is /home/lechuuu/hackathons/ethglobal-nov26.

First read `docs/prompts/common.md` in full. Its rules apply to you: no git commands, never print or write secrets, bun only, install with `flock /tmp/paisalink-bun.lock`. Then read PLAN.md sections 3, 7 and 8, and `docs/handoffs.md`.

You own `scripts/verify-submission.ts`, `scripts/verify-*.ts`, `docs/verification.md` and `apps/web/e2e/**`, plus a Playwright config inside `apps/web/e2e/`. Don't edit source files. Write bugs you find into `docs/handoffs.md` under "S2 findings".

The dev servers are already running: API at http://100.125.124.63:8787, web at http://100.125.124.63:5173 (also localhost). Don't kill them. The contracts aren't deployed and the wallets aren't funded yet, so payments are switched off in the UI.

Build:
1. **Playwright e2e** (Chromium is installed at ~/.cache/ms-playwright; pin the `@playwright/test` version that matches chromium-1248, check with `bun pm ls` or try 1.5x). Use mobile and desktop viewports.
   - Tests that work now: each page renders, the "not switched on yet" states, the onboard page's World not-configured state, the demo-store widget opening the pay modal, and the receipt page.
   - The full live flow, gated behind `E2E_LIVE=1`: create invoice → get test USDT → pay gaslessly → dashboard shows Paid → refund → CSV download → publish PDF → finance a note → a rule-refusal button shows a revert reason → settle after maturity.
   - Save screenshots to `apps/web/e2e/screenshots/`.
2. **`scripts/verify-submission.ts`**, which exits non-zero on any failure. It checks:
   - Every link and explorer URL in README.md returns 200.
   - Every tx hash in the README exists on Whitechain testnet (via RPC `eth_getTransactionReceipt` at https://rpc.testnet.whitechain.io) with status success.
   - The contract addresses in `contracts/deployments/1874.json` have code and are verified on Blockscout (`https://explorer.testnet.whitechain.io/api?module=contract&action=getsourcecode&address=`).
   - At least one USDT `Transfer` involving the PaymentRouter exists.
   - The required files exist and aren't placeholders: README.md, AI_USAGE.md, WHITECHAIN_FEEDBACK.md, LICENSE, the `arkiv/*.md` files Arkiv requires (find the list in `research/tracks.md`, read-only), docs/WORLD_DEBRIEF.md, docs/submission.md and docs/demo-script.md.
   - It reports any `TODO(live)` left anywhere.
   - No secrets in the repo: grep tracked files for 64-hex private-key patterns next to words like "key" or "private", and for `.env.local` content.
   - `.env.local` and `research/` aren't tracked (use `git ls-files` only through a read-only `Bun.spawn(['git','ls-files'])` inside the script; that's the single allowed git read).
3. **`docs/verification.md`**: how to run all of it, and the results so far.

Final reply, under 200 words: what passes now, what's gated on live funds, and any findings.
