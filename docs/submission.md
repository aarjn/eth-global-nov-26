# ETHGlobal submission text (Mumbai 2026)

Copy each block into the form. Items marked `TODO(owner)` or `PENDING(...)` must be filled in before you submit. Sponsors to pick on the form: **Whitechain, Arkiv, World** (Arkiv's Swarm bonus is selected with Arkiv and does not use a pick). Track: **Classic**.

## Project name

PaisaLink

## Links

- Repo: <https://github.com/aarjn/eth-global-nov-26>
- Demo video: `TODO(owner): video URL` (about 3:00, 1080p, the builder's own voice)
- Live app: no public hosted URL. The app runs locally (see Setup in the README). The demo video shows the live testnet flow.
- Contracts: PaymentRouter `0x97613d5bE2c3dd747c110b460Ff2e0FC69701005` ([explorer](https://explorer.testnet.whitechain.io/address/0x97613d5bE2c3dd747c110b460Ff2e0FC69701005?tab=contract)), InvoiceNote `0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7` ([explorer](https://explorer.testnet.whitechain.io/address/0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7?tab=contract))
- Arkiv writer wallet: `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb`
- Arkiv entity example: <https://rabdi.explorer.arkiv.network/entity/0x2a687bca3e74ad2e7155e364a2bda5c7381b233df9fafd49357317c75f4ce648>

## Short description (about 100 characters)

Get paid in USDT with a link: gasless for the client, refunds, accountant CSV, and sell the invoice.

## Long description

Indian freelancers and exporters who bill clients abroad lose roughly 3 to 6 percent of each invoice to fees and currency spread, and wait days for the money. (Builder's working figure. `TODO(owner): add a source or soften.`) Stablecoins fix the cost and the wait, but they push new problems onto the client: gas tokens, networks, seed phrases.

PaisaLink lets a merchant create an invoice and get a payment link, or add a 20-line widget to a shop. The client opens the link on a phone and taps Pay. They sign a typed message for the official Whitechain testnet USDT (EIP-3009). Our relayer sends the transaction and pays the gas. The client never holds WBT and never sees a chain name.

The merchant dashboard reads Arkiv live. It shows the payment with its explorer link, a one-click partial or full refund enforced by the router, a CSV export for the accountant, and a PDF receipt stored on Swarm.

An exporter with a 30-day invoice can sell it for cash today. They tokenise it as an `InvoiceNote`. Only an allowlisted investor can fund it, at a discount, in USDT. The note can't be transferred after maturity. At maturity it settles in USDT. All of these rules are enforced in the contract and proven by Foundry tests.

Who gets gas? A merchant must pass one World ID Proof of Human check to unlock the gas-sponsored path. One human gets one gas budget. If the check is cancelled or fails, the gasless path stays locked. The client can still pay with their own wallet and cover the gas themselves.

Everything shown runs on testnets. Test shortcuts are labelled in the UI and listed in the README.

## How it's made

- **Contracts (Foundry, Solidity 0.8.28):** `PaymentRouter` takes USDT through `receiveWithAuthorization`. The signature nonce is bound to the invoice, so it can't be redirected to another invoice. `InvoiceNote` has an allowlist, a maturity lock and settlement in USDT. 79 unit and fuzz tests plus 5 fork tests against the real USDT.
- **API and relayer (Hono on bun, viem):** simulates every relay first, then applies a World ID gate, a per-merchant daily gas budget of 0.02 WBT and rate limits per payer, IP and globally.
- **Web (Vite, React 19, Tailwind v4):** merchant dashboard, payer page, public receipt, investor page and onboarding. The widget is a small React component and an `embed.js` loader.
- **Data (Arkiv, `@arkiv-network/sdk` 1.0.1):** the only database. Four entity types, per-type expiry, owner-filtered reads, atomic batches, `extendEntity` leases and `watchEntityEvents` for live updates.
- **Files (Swarm, bee-js 13.2.0, pdf-lib):** one PDF per invoice with no personal data, uploaded as a plain (unencrypted) reference. The reference is in the `swarm_ref` field of the invoice entity.
- **Identity (World IDKit 4.6.0):** Proof of Human in staging, with the proof verified on the server and the nullifier stored off-chain.
- **Hard parts:** the USDT has no `version()` or `eip712Domain()`, so we found the EIP-712 domain version by brute force against `DOMAIN_SEPARATOR`. Arkiv's hub can't be driven by a script, and a 429 lockout can last about 27 minutes, so we built a rate-limit breaker. IDKit has no server-side verify helper, so we wrote one, including a signal-binding check.
- **Built by:** one human directing Claude agents (Opus for code, Sonnet for tests and docs, Fable for research and the plan). See the AI disclosure below.

## What is live and what is a demo shortcut

Live on testnet: contract deploys, USDT payments, refunds, note lifecycle, Arkiv writes and reads, Swarm uploads, World ID verification.

Demo shortcuts (all labelled in the UI):
- Browser-local testnet demo wallets for merchant, payer and investor.
- `/demo/fund`, a testnet faucet that sends test USDT to a demo wallet.
- `/notes/demo-investor`, a "demo compliance desk" that allowlists the demo investor. In production a compliance officer would do it after KYC.
- The Swarm Foundation public gateway, with its own postage batch.
- World ID staging with the simulator.
- A 120-second note maturity so the lifecycle fits in a video.

## What breaks without each sponsor

- **Without Whitechain:** no official-USDT settlement, no gasless EIP-3009 pay, no enforced allowlist and maturity rules.
- **Without Arkiv:** the dashboard, pay page and receipt page have nothing to show. It is the only database.
- **Without Swarm:** the invoice works, but there is no permanent PDF receipt.
- **Without World:** anyone can open unlimited merchants and drain the relayer's gas.

## Per-prize text

### Whitechain: Operate (Stablecoin Payments for Business)

| Requirement text | How PaisaLink meets it | Where |
|---|---|---|
| "A drop in piece, widget, SDK, payment link API or plugin that a separate demo app adds in about 20 lines" | `<PaisaLink amount merchant onPaid />` and a payment-link API. The separate demo store uses 19 lines. | `packages/widget/src/index.tsx`, `apps/web/src/routes/demo-store/StoreCheckout.tsx` |
| Both merchant and customer views | `/merchant` dashboard and the `/pay/:id` phone checkout, plus the public `/r/:id` receipt. | `apps/web/src/routes/` |
| Extra credit for refunds, renewals, accountant export | One-click partial or full refund through the router, and a CSV export. (No renewals yet.) | `PaymentRouter.sol:202`, `apps/api/src/app.ts:176` |
| Not "a pay button that sends a plain transfer" | A full invoice lifecycle: invoice, pay, refund, withdraw, export, receipt. | |

### Whitechain: Scale (Payments Nobody Notices)

| Requirement text | How PaisaLink meets it |
|---|---|
| The payer pays "without holding WBT for gas, writing down a seed phrase or knowing what chain they are on" | The payer signs EIP-3009 typed data in the browser. The relayer sends the transaction. The page never shows a chain name. |
| How the business pays gas, how the relayer gets WBT, what stops draining | README, "Gas and drain protection": World ID gate, 0.02 WBT per merchant per day, rate limits, simulation before sending, tight authorization checks. |
| Not "flows where the payer still signs a transaction that costs them gas" | The payer signs typed data only. The self-paid `pay()` path exists as a fallback and is clearly separate. |

### Whitechain: Tokenize (Real World Finance)

| Requirement text | How PaisaLink meets it |
|---|---|
| "Real transfer rules enforced in the contract, such as allowlists, transfer restrictions, maturity or settlement conditions" | `InvoiceNote.sol`: `fund` and `transfer` need an allowlisted address, `transfer` and `fund` revert after maturity (`MaturityPassed`), `settle` reverts before maturity (`NotMatured`) and pays face value in USDT. |
| "A clear issuer/investor/business user and one full lifecycle step" | Issuer: the merchant. Investor: an allowlisted wallet. Business user: the client who pays. Full lifecycle: issue, fund, mature, settle. |
| "Financing or selling an invoice belongs in Tokenize" | That is exactly what the note does. |
| Not "a token with a mint button and no rules" | Foundry tests prove every revert (`contracts/test/InvoiceNote.t.sol`). |

### Whitechain: common requirements

- Contracts deployed and verified on Whitechain Sepolia (1874): `0x97613d5bE2c3dd747c110b460Ff2e0FC69701005`, `0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7`.
- A payment in the official USDT (`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`) in the main flow: <https://explorer.testnet.whitechain.io/tx/0x07c94ba03059287729b65b5eb35f76bd6787687d672ec4bc1b881abe1e5ac36e> (payer paid no gas; the relayer did).
- Why onchain: README, "Why onchain settlement on Whitechain".
- Feedback: `WHITECHAIN_FEEDBACK.md`.
- Video shows merchant, payer and investor.

### Arkiv: Build on Arkiv (from scratch), plus the Swarm bonus

| Criterion (25% each) | File |
|---|---|
| Arkiv feedback | `arkiv/friction.md` |
| Reach | `arkiv/reach.md` |
| Why Arkiv | `arkiv/why-arkiv.md` |
| How you use Arkiv | `arkiv/how-you-use-arkiv.md` |
| Required | `arkiv/schema.md`, README writer wallet and a runnable query (`bun run scripts/query.ts`) |

- **Writes to Arkiv's current testnet:** the API writes every merchant, invoice, payment and note as an Arkiv entity (Rabdi, 7794095). Writer: `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb`.
- **A feature users see reads Arkiv:** the merchant dashboard, the pay page and the public receipt.
- **Not "a log nothing reads":** there is no other database, so every page reads Arkiv.
- **Swarm bonus (`arkiv/swarm.md`):** the invoice PDF is on Swarm. The plain reference is in the `swarm_ref` field of the invoice entity. Entity key + reference: entity key `0x2a687bca3e74ad2e7155e364a2bda5c7381b233df9fafd49357317c75f4ce648` (<https://rabdi.explorer.arkiv.network/entity/0x2a687bca3e74ad2e7155e364a2bda5c7381b233df9fafd49357317c75f4ce648>), `swarm_ref` `333fbd9dc996418560fef47a3d255003964b1890c530d0a005a19264543a3a30` (<https://api.gateway.ethswarm.org/bzz/333fbd9dc996418560fef47a3d255003964b1890c530d0a005a19264543a3a30/>). Service: Swarm Foundation public gateway (batch not visible to us, stated in the file).
- Open-source licence: MIT. AI disclosure below.

### World: Best Use of IDKit

| Requirement text | How PaisaLink meets it |
|---|---|
| "Integrate IDKit in a functioning application" | IDKit 4.6.0 in `/onboard`. |
| "verify the result on the server" | `apps/api/src/world.ts` signs the request, checks credential, signal and nullifier, and forwards the proof to the World verify API. |
| "the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance" | See "Credential reasoning" below. |
| "a successful verification and one meaningful alternative path" | The video shows a verified merchant, then a second merchant that cancels. The relayer answers `MERCHANT_NOT_VERIFIED`, and the dashboard shows "Gas-sponsored checkout locked". |
| Integration debrief | `docs/WORLD_DEBRIEF.md` |

#### Credential reasoning

- **The trust moment:** a merchant asks PaisaLink to pay the gas for its customers. Our relayer spends WBT on every payment. If one person can open many merchant accounts, they can drain it.
- **Credential: Proof of Human (Orb).** The rule is one human, one merchant account, one gas budget. The nullifier is scoped to our app and action, so the same person can't verify a second wallet (`409 NULLIFIER_REUSED`).
- **Why not Device:** it is cheap to repeat, so it doesn't stop one person from running many accounts. It would not protect the budget.
- **Why not Passport/NFC:** it proves more than we need, such as nationality and age. Paying someone's gas doesn't depend on that.
- **Why not Selfie Check:** it is a face-match credential and a heavier privacy ask. It adds assurance about who you are, which this event doesn't need.
- **So Proof of Human is the minimum sufficient assurance.**
- **It improves the product:** verified merchants' customers pay with no gas. Unverified merchants still get paid, with the customer paying gas. The credential unlocks a subsidy. It is not a login.
- **Privacy:** Arkiv gets only `verified = 1`. Nullifiers stay on the API server. The signal is the merchant wallet, so a proof can't be replayed for another wallet.

## AI disclosure

The code in this repo was written by Claude agents: Claude Opus 5.5 for application code and contracts, Claude Sonnet 5.5 for tests and documentation, and Claude Fable for research and the build plan. They ran as parallel workstreams from saved prompts (`docs/prompts/`) and specs (`docs/specs/`, `PLAN.md`). The one human builder (aarjn) chose the product, the sponsors and the trade-offs (`DECISIONS.md`), approved the plan, did the account and faucet steps agents can't do, tested every milestone on a phone, visited the sponsor booths, wrote the "own notes" in the feedback files and records the video narration in their own voice (no text-to-speech). The per-file list is `AI_USAGE.md`.

## Repo timing

The repository was created after the hackathon started (Classic track, all code written during the event). `TODO(owner): confirm the repo creation time on GitHub and that the ETHGlobal desk accepted an AI-assisted solo project.` Commit history is in the repo; commits were made throughout the build, not as one upload at the end.

## Checklist before you press submit

- [ ] Video link works and is 2 to 4 minutes, 1080p, your own voice.
- [ ] All `TODO` and `PENDING` markers are gone from README, `arkiv/*.md`, `WHITECHAIN_FEEDBACK.md` and this file.
- [ ] Contract links open and show verified source.
- [ ] `bun run scripts/query.ts` prints invoices on a clean machine.
- [ ] Three partners picked: Whitechain, Arkiv, World. Swarm bonus selected with Arkiv.
- [ ] Builder's own notes written in `WHITECHAIN_FEEDBACK.md` and `arkiv/friction.md`.
