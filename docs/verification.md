# Verification

Two tools: a Playwright e2e suite for the web app and a submission checker for the repo and the chain.

## 1. Playwright e2e (`apps/web/e2e/`)

- `@playwright/test@1.64.0` (devDependency of `apps/web`). Version 1.64.0 is the release whose Chromium is revision 1248, the build in `~/.cache/ms-playwright/chromium-1248`; no download needed.
- Config: `apps/web/e2e/playwright.config.ts`. Two projects: `desktop` (1280x800) and `mobile` (390x844, touch).
- Specs: `pages.spec.ts` (works now), `live.spec.ts` (gated by `E2E_LIVE=1`), helpers in `helpers.ts`.
- Screenshots land in `apps/web/e2e/screenshots/<project>-<name>.png`. Traces and the HTML report go to `apps/web/test-results/` and `apps/web/playwright-report/` (git-ignored).

Run (from the repo root; the dev servers must be up, defaults `http://localhost:5173` and `http://localhost:8787`):

```bash
cd apps/web
bun node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts                 # offline-safe suite
E2E_BASE_URL=http://100.125.124.63:5173 E2E_API_URL=http://100.125.124.63:8787 \
  bun node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts               # against the Tailscale URLs
E2E_LIVE=1 bun node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts --project desktop live   # live flow
```

Note: the web app reads `VITE_API_URL` (default `http://localhost:8787`); `E2E_API_URL` only tells the tests where to ask the API for `/config`. Keep both pointing at the same API.

### What `pages.spec.ts` covers (no funds, no contracts needed)

Home, merchant dashboard (with the "Payments are not switched on yet" banner while `/config.paymentRouter` is null), invest (financing-off banner), onboard (World not-configured path; bad `?wallet=` fallback), demo store, `/pay/<unknown id>` ("Payment link not found"), `/r/<unknown id>` ("Receipt not found"), unknown route. Every page is checked for uncaught page errors and horizontal scroll, and screenshotted on both viewports.

Widget: with payments off, clicking the demo-store button shows an error and no dialog (real API). A second test stubs only the `POST /invoices` response (test-only fake, labelled in the file) so the checkout modal opens, loads the real `/pay/:id` route in its iframe, and closes again. A receipt test renders a real receipt as soon as the demo merchant has a non-open invoice, otherwise it is skipped.

The "not switched on" assertions apply only while the contracts are undeployed; once `/config` shows a router they flip to asserting the live state, so the same suite stays green after the deploy.

### Live flow (`E2E_LIVE=1`, desktop only, serial, up to 8 minutes)

0. Preconditions: `/config` has `paymentRouter` and `invoiceNote`, `/health` is ok.
1. Create invoice A (5 USDT) with a fresh browser-local demo merchant.
2. Customer context (phone viewport): "Get test USDT", pay gaslessly, "No fees were charged to you".
3. Dashboard row turns `Paid` (live via SSE/poll).
4. Partial refund of 2 USDT; the refund tx link points at the explorer.
5. Export CSV (download contains the invoice id).
6. Publish PDF to Swarm; the link answers 200 with a PDF content type.
7. Invoice B (20 USDT): sell it as a note (2-minute demo maturity), set up and fund as the demo investor, customer pays into the escrow.
8. Rule refusal: "Try to settle early" shows `Reverted: <reason>` from the contract.
9. After maturity: Settle, "Settled in USDT".

Requirements for it to pass: contracts deployed and `deployments/1874.json` updated, API restarted, relayer holding WBT, deployer holding WBT and test USDT (demo faucet and investor desk), Arkiv writer funded with `ARKIV_ACCESS_KEY`, and the browser merchant World-verified (see finding 2 in `docs/handoffs.md`). The live spec has not run yet (nothing is deployed); its selectors were written against the current source and will need a shake-out on the first live run.

## 2. Submission checker (`scripts/verify-submission.ts`)

```bash
bun scripts/verify-submission.ts                 # everything, exit 1 on any FAIL
bun scripts/verify-submission.ts --offline       # skip external HTTP link checks and Blockscout
bun scripts/verify-submission.ts --only=files,todo,secrets,tracked
```

Groups (`--only` names): `tracked`, `files`, `todo`, `secrets`, `links`, `tx`, `contracts`, `transfer`.

| Group | Check |
|---|---|
| links | Every URL in README.md returns 200 (RPC URLs are checked with `eth_chainId`; localhost/LAN URLs are skipped with a warning; a `.git` clone URL is checked as the repo page). |
| tx | Every tx hash in README.md has a receipt with status success on Whitechain testnet (or Arkiv Rabdi for Rabdi-explorer links). An empty table fails. |
| contracts | `contracts/deployments/1874.json` must say `deployed:true`; PaymentRouter and InvoiceNote have code and are verified on Blockscout (`getsourcecode`). |
| transfer | At least one USDT `Transfer` to or from the PaymentRouter since `deployBlock` (chunks of 10,000 blocks, the RPC limit). |
| files | README, AI_USAGE, WHITECHAIN_FEEDBACK, LICENSE (MIT), `arkiv/{schema,friction,reach,why-arkiv,how-you-use-arkiv,swarm}.md`, `docs/{WORLD_DEBRIEF,submission,demo-script}.md` exist, meet a minimum length and contain no placeholder words; README has the Arkiv writer address and a runnable query line. |
| todo | Lists every `TODO(live)` (FAIL) and `TODO(owner)` (warning). `docs/prompts/`, `docs/handoffs.md`, `PLAN.md` and the verifier docs are excluded. |
| secrets | 64-hex strings on a line with key/private/secret words (public anvil keys are allowed), and any value from `.env.local` appearing in a repo file. Values are never printed. Scans tracked plus uncommitted files. |
| tracked | `.env.local`, `research/`, `CLAUDE.md`, `.pem`/`.key` files are not tracked (`git ls-files`, the only git call). |

The Arkiv file list comes from `research/tracks.md` (track "Build a new app whose data lives in Arkiv": schema + friction always, one file per criterion: reach, why-arkiv, how-you-use-arkiv; swarm.md for the Arkiv + Swarm bonus).

## 3. Results so far (6 Nov 2026, before the contracts exist)

Playwright, `pages.spec.ts`, both projects: **21 passed, 1 failed, 2 skipped**.
- Failed on purpose: `home` on `mobile`, 8 px horizontal overflow at 390 px (handoffs, S2 finding 1).
- Skipped: the real-receipt test (no paid invoice yet) on both projects.
- `live.spec.ts`: skipped without `E2E_LIVE=1`.

`verify-submission.ts`: passes `tracked`, `secrets`, the RPC reachability links and all existing files; fails, as expected before the live phase, on: contracts not deployed, no tx hashes in the README, no router Transfer, `TODO(live)` markers (README), five missing docs (`arkiv/reach.md`, `arkiv/why-arkiv.md`, `arkiv/how-you-use-arkiv.md`, `docs/submission.md`, `docs/demo-script.md`) and the README repo URL answering 404. Re-run it after every live step; it is the final gate before submitting.
