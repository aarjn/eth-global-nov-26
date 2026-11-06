# AI usage

ETHGlobal's rules ask every team to say where and how AI tools were used. This file is kept up to date during the build.

## Short version

- **Team:** one human, aarjn.
- **The code was written by Claude agents.** Claude Opus wrote the application code and contracts. Claude Sonnet wrote tests and paperwork. Claude Fable did the research and wrote the plan. The agents ran in parallel, each on its own workstream and its own files.
- **The human directed and reviewed.** aarjn chose the product, the sponsors and the trade-offs (`DECISIONS.md`), approved the plan, funded the testnet wallets and made the faucet and hub sign-ins that agents can't do, tested on a phone, visited the sponsor booths, and wrote the "own notes" sections of the feedback files. The narration of the demo video is the human's own voice (no text-to-speech).
- **What the human did not do:** write the Solidity, TypeScript or tests line by line. We say this plainly so nobody has to guess.
- **Specs, prompts and plans are in the repo:** the plan is `PLAN.md`, the specs are in `docs/specs/`, and every agent's prompt is saved unchanged in `docs/prompts/`.
- **Commits** are made by the coordinator under the human's name after review. Git history shows who committed, not who wrote the code. This file shows who wrote the code.
- **Created after kickoff:** the repository was created after the hackathon began. `TODO(owner): confirm the exact repo creation time and the ETHGlobal desk's answer on AI-assisted solo projects.`

## Roles

| Role | Model | Used for |
|---|---|---|
| Research and plan | Claude Fable | Reading the sponsor prize text, comparing tracks, writing `PLAN.md` and the track research in `research/` |
| Coordinator | Claude (the session that ran the build) | Repo skeleton, briefs, merging, review, commits |
| Code agents W1 to W7 | Claude Opus 5.5, high effort | Contracts, API and relayer, web and widget, Arkiv layer, financing, World ID, Swarm PDF |
| Code agents W8 and R1 | Claude Opus 5.5, high effort | W8: live-flow prep (USDT pooling, faucet cap, live spec). R1: recording the demo footage live on testnet |
| Test agent S1, verify agent S2, paperwork agent S3, live-run agent S4, fill-in agent S5 | Claude Sonnet 5.5 | Edge tests, end-to-end checks, README and docs, the live testnet run, filling in live evidence |
| Human | aarjn | Product choices, approvals, wallets and sign-ins, phone testing, booth questions, own notes, voice narration, final submission |

## Workstreams and prompts

| ID | Prompt | Model | Scope |
|---|---|---|---|
| W1 | `docs/prompts/W1-contracts.md` | Opus | `PaymentRouter`, `InvoiceNote` skeleton, Foundry tests, deploy and verify scripts, ABIs |
| W2 | `docs/prompts/W2-api.md` | Opus | Hono API, relayer, refunds, CSV, health |
| W3 | `docs/prompts/W3-web.md` | Opus | Web app and widget |
| W4 | `docs/prompts/W4-arkiv.md` | Opus | Arkiv store, merchant routes, query script, schema draft |
| W5 | `docs/prompts/W5-financing.md` | Opus | `InvoiceNote` rules and tests, `/invest`, notes routes |
| W6 | `docs/prompts/W6-world.md` | Opus | World ID verification, `/onboard`, debrief |
| W7 | `docs/prompts/W7-swarm.md` | Opus | Invoice PDF and Swarm upload |
| S1 | no saved prompt (brief in the coordinator session) | Sonnet | Edge and fuzz tests |
| S2 | `docs/prompts/S2-verify.md` | Sonnet | `docs/verification.md`, `scripts/verify-submission.ts`, Playwright specs |
| W8 | `docs/prompts/W8-live-flow.md` | Opus | `scripts/pool-usdt.ts`, faucet amount cap (`apps/api/src/demo.ts`, `/pay` and `/invest` pages), `.env.override` values, live spec amounts |
| S4 | `docs/prompts/S4-live-run.md` | Sonnet | The live testnet run 2, `docs/live-run.md` |
| R1 | `docs/prompts/R1-record-demo.md` | Opus | `apps/web/e2e/record/*`, `scripts/mux-video.sh`, `recordings/` clips, the run 3 section of `docs/live-run.md` |
| H1 | no saved prompt | Opus 5.5 | Hosting: `Dockerfile`, `.dockerignore`, `scripts/serve.ts`, `scripts/serve-lib.ts`, `scripts/serve.test.ts`, `scripts/deploy-host.sh`, `docs/hosting-paisalink.md` |
| S7 | no saved prompt | Sonnet 5.5 | Live-link wording in `README.md`, `docs/submission.md`, `arkiv/reach.md`; this file |
| S5 | `docs/prompts/S5-fill-live.md` | Sonnet | Live evidence in `README.md` and `docs/submission.md`, `docs/demo-script.md` amounts, `docs/owner-todo.md`, this file |
| S3 | `docs/prompts/S3-paperwork.md` | Sonnet | README, this file, feedback files, `arkiv/*.md`, submission text, demo script |
| Common rules | `docs/prompts/common.md` | all | Rules every agent follows (no secrets, no git, file ownership) |

## Files and who wrote them

"Opus" means Claude Opus 5.5 under the named workstream. "Reviewed" means the coordinator ran the tests and read the diff. The human's own review is the phone testing, the demo and the final read-through, not a line-by-line audit. Files are grouped by area. Generated build output (`apps/web/dist`, `contracts/out`, `contracts/cache`) is not listed.

### Planning, root and tooling

| Path | Written by | Notes |
|---|---|---|
| `PLAN.md` | Fable (planning agent); approved by the human | Drafted from research the human asked for |
| `research/**` | Fable agents | Sponsor prize text and notes. Local only, not part of the submission |
| `DECISIONS.md` | Human | Product decisions. Agents only added the template |
| `package.json`, `bun.lock`, `.gitignore`, `.env.example`, `scripts/load-env.sh` | Coordinator | |
| `LICENSE` | Coordinator | MIT, copyright aarjn |
| `docs/specs/README.md`, `docs/specs/contracts.md` | Coordinator, from `PLAN.md` | Contract and interface spec |
| `docs/prompts/*.md` | Coordinator | The saved agent briefs |
| `docs/handoffs.md` | All agents | Requests between workstreams, plus S1 findings |
| `scripts/fund-demo.ts`, `apps/api/src/fund-demo-cli.ts` | Opus (W2) | Testnet USDT mover |
| `scripts/gen-abi.ts` | Opus (W1) | Copies ABIs from `forge` output |
| `scripts/query.ts`, `scripts/arkiv-setup.ts` | Opus (W4) | Runnable Arkiv query and Arkiv key check |

### Contracts (`contracts/`)

| Path | Written by | Notes |
|---|---|---|
| `src/PaymentRouter.sol`, `src/interfaces/IEIP3009.sol` | Opus (W1) | |
| `src/InvoiceNote.sol`, `src/interfaces/IInvoiceNoteHook.sol` | Opus (W1 skeleton, W5 full rules) | |
| `script/Deploy.s.sol`, `script/FirstPayment.s.sol`, `script/verify.sh`, `script/write-deployment.ts` | Opus (W1) | |
| `deployments/1874.json` | Opus (W1) | Updated by `write-deployment.ts` after a deploy |
| `foundry.toml`, `remappings.txt` | Opus (W1) | |
| `test/Base.t.sol`, `test/PaymentRouter.t.sol`, `test/mocks/MockEIP3009.sol` | Opus (W1) | The mock token is test-only |
| `test/InvoiceNote.t.sol` | Opus (W5) | |
| `test/Fork.t.sol` | Opus (W1, W5) | Runs against the real USDT on a fork |
| `test/Edge.t.sol` | Sonnet (S1) | 14 edge tests |
| `lib/` | Third party | OpenZeppelin v5.4.0 and forge-std v1.11.0, vendored, not AI-written |

### Shared packages (`packages/`)

| Path | Written by | Notes |
|---|---|---|
| `shared/src/types.ts`, `usdt.ts`, `chain.ts`, `index.ts` | Coordinator and Opus (W1) | Types and the USDT typed-data helper |
| `shared/src/abi/*`, `shared/src/addresses.ts` | Opus (W1) | ABIs generated from forge output |
| `shared/test/usdt.test.ts` | Opus (W1) | |
| `shared/test/vectors.test.ts` | Sonnet (S1) | Test vectors checked against `cast` |
| `arkiv/src/*` (`client.ts`, `schemas.ts`, `mapping.ts`, `store.ts`, `index.ts`) | Opus (W4) | |
| `arkiv/test/*` | Opus (W4) | |
| `widget/src/*` (`core.ts`, `index.tsx`, `embed.ts`) | Opus (W3) | |

### API (`apps/api/`)

| Path | Written by | Notes |
|---|---|---|
| `src/app.ts`, `config.ts`, `chain.ts`, `viem-chain.ts`, `relayer.ts`, `budget.ts`, `ratelimit.ts`, `queue.ts`, `senders.ts`, `typed.ts`, `errors.ts`, `csv.ts`, `demo.ts`, `index.ts`, `plugins.ts` | Opus (W2) | |
| `src/routes/merchants.ts` | Opus (W4) | |
| `src/routes/notes.ts` | Opus (W5) | Includes the demo compliance desk |
| `src/world.ts` | Opus (W6) | |
| `src/pdf.ts`, `src/swarm.ts` | Opus (W7) | |
| `test/app.test.ts`, `relayer.test.ts`, `units.test.ts`, `anvil.test.ts`, `senders.test.ts`, `fake-chain.ts`, `helpers.ts`, `memory-store.ts` | Opus (W2) | Test-only fakes live here |
| `test/notes.test.ts`, `notes-anvil.test.ts` | Opus (W5) | |
| `test/world.test.ts` | Opus (W6) | |
| `test/pdf.test.ts` | Opus (W7) | |
| `test/edge.test.ts` | Sonnet (S1) | |

### Web app (`apps/web/`)

| Path | Written by | Notes |
|---|---|---|
| `src/App.tsx`, `main.tsx`, `index.css`, `components/*`, `lib/*`, `routes/Home.tsx` | Opus (W3) | |
| `src/routes/merchant/*`, `pay/*`, `receipt/*`, `demo-store/*` | Opus (W3) | |
| `src/routes/invest/*` (including `invest.test.tsx`) | Opus (W5) | |
| `src/routes/onboard/*`, `test/onboard.test.tsx` | Opus (W6) | |
| `test/components.test.tsx`, `lib.test.ts`, `widget.test.tsx`, `swarm.test.ts`, `setup.ts` | Opus (W3, W7) | |
| `index.html`, `vite.config.ts`, `tsconfig.json`, `bunfig.toml`, `package.json`, `public/*` | Opus (W3) | |

### Paperwork

| Path | Written by | Notes |
|---|---|---|
| `README.md`, `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md` | Sonnet (S3) | Human adds the "Builder's own notes" |
| `arkiv/schema.md` | Opus (W4) draft, Sonnet (S3) polish | |
| `arkiv/swarm.md` | Opus (W7), Sonnet (S3) polish | |
| `arkiv/friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` | Sonnet (S3) | `friction.md` is based on `docs/feedback/arkiv-sdk-notes.md` and has a human section |
| `docs/WORLD_DEBRIEF.md` | Opus (W6) | Human adds the real-simulator timing |
| `docs/feedback/arkiv-sdk-notes.md` | Opus (W4) | Raw notes from the build |
| `docs/submission.md`, `docs/demo-script.md` | Sonnet (S3) | The human reads and edits the script before recording |
| `docs/verification.md`, `scripts/verify-submission.ts`, `apps/web/e2e/pages.spec.ts`, `world-live.spec.ts`, `playwright.config.ts`, `helpers.ts` | Sonnet (S2) | Verification report and the submission checker |
| `apps/web/e2e/live.spec.ts` | Sonnet (S2), amounts changed by Opus (W8) | Live testnet spec |
| `scripts/pool-usdt.ts` | Opus (W8) | Moves test USDT with signed transfers |
| `docs/live-run.md` | Sonnet (S4), run 3 section by Opus (R1) | Live run evidence: tx hashes, Arkiv entities, balances |
| `apps/web/e2e/record/*`, `scripts/mux-video.sh`, `recordings/README.txt` | Opus (R1) | Demo footage recorder and the audio/video joiner. Clips in `recordings/` are not committed |
| `apps/web/e2e/record/record-demo.ts`, `scripts/mux-video.sh`, the run 3 section of `docs/live-run.md` | Opus 5.5 (R1) | Demo recorder, audio/video joiner and run 3 evidence |
| `README.md`, `docs/submission.md`, `arkiv/reach.md`, `AI_USAGE.md` (final pass: run 3 hashes, test counts, no-public-URL wording) | Sonnet 5.5 (S6) | Test suites re-run on 7 Nov 2026; hashes checked with `cast receipt` |
| `Dockerfile`, `.dockerignore`, `scripts/serve.ts`, `scripts/serve-lib.ts`, `scripts/serve.test.ts`, `scripts/deploy-host.sh`, `docs/hosting-paisalink.md` | Opus 5.5 (H1) | Single-container hosting (Dokku + Tailscale Funnel) |
| Live-link wording in `README.md`, `docs/submission.md`, `arkiv/reach.md` | Sonnet 5.5 (S7) | Replaced the no-public-URL text with the live link |
| `docs/owner-todo.md`, the live evidence and amounts in `README.md`, `docs/submission.md`, `docs/demo-script.md` | Sonnet (S5) | Filled from `contracts/deployments/1874.json`, `docs/live-run.md` and on-chain receipts |
| `apps/web/src/components/magicui/*` (new), `apps/web/public/fonts/InterVariable.woff2`, `apps/web/e2e/ui-shots.ts`, UI polish in `apps/web/src/index.css`, `main.tsx`, `index.html`, `components/ui.tsx`, `components/Shell.tsx`, `routes/Home.tsx`, `routes/merchant/{index,InvoiceList,CreateInvoice}.tsx`, `routes/pay/index.tsx`, `routes/receipt/index.tsx`, `routes/invest/{index,NoteCard}.tsx`, README UI credits | Opus 5.5 (U1) | Warmer UI: Magic UI components (number ticker, shimmer button, blur fade, animated beam, avatars), Motion, confetti on "Paid", self-hosted Inter; no functional changes |

## Code Garage items used

- Magic UI, garage id `frontend.components.animated-component-kits` (trust: reviewed, MIT): component source copied and adapted by U1 into `apps/web/src/components/magicui/`.
- Inter variable font file taken from the garage mirror of `openapi-ts/openapi-typescript` (`docs/public/assets/InterVariable.woff2`; the font itself is SIL OFL 1.1).

`TODO(coordinator): add any other Code Garage items reused by other agents.`

## What the human contributed

- Chose PaisaLink, the three sponsors and the Classic track (`DECISIONS.md`).
- Approved the plan and each phase before agents started.
- Created and funded the testnet wallets with faucets, and did the account steps agents can't do (Arkiv hub sign-in and access key, World Developer Portal app).
- Tested the flows on a real phone.
- Asked questions at the sponsor booths.
- Wrote the "Builder's own notes" in `WHITECHAIN_FEEDBACK.md` and `arkiv/friction.md`, and will write the World debrief timing.
- Records the demo narration in their own voice.
- Fills in and submits the ETHGlobal form.

## Honest limits

- Agents sometimes got things wrong (for example, tutorials for old SDK versions). Tests and on-chain checks caught most of it. Some bugs may remain.
- AI-written code may carry subtle errors. The contracts are unaudited.
