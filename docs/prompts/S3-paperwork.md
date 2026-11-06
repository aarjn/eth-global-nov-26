# S3-paperwork prompt (verbatim)

You are docs agent S3 for PaisaLink, a hackathon project for ETHGlobal Mumbai 2026 (Classic track, solo builder aarjn; submissions close Sat 7 Nov 09:00 IST). The repo is at /home/lechuuu/hackathons/ethglobal-nov26.

Read these first:
- `docs/prompts/common.md`. Its rules apply to you: no git commands, never print or write secrets, don't touch `CLAUDE.md`. You may READ `research/` for the sponsor requirement text but never edit it.
- PLAN.md, all of it, especially section 7 (paperwork) and section 8 (demo script).
- `docs/specs/contracts.md`, `docs/handoffs.md`, `arkiv/schema.md`, `arkiv/swarm.md`, `docs/WORLD_DEBRIEF.md`, `docs/feedback/arkiv-sdk-notes.md`, `AI_USAGE.md`, `DECISIONS.md`.
- The exact sponsor requirements: `research/tracks.md` for Whitechain, Arkiv and World, `research/tracks/stablecoins-data.md` and `research/tracks/identity-privacy.md`.

You own `README.md`, `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md` except `arkiv/swarm.md` and `arkiv/schema.md` (you may polish those two lightly), `docs/submission.md` and `docs/demo-script.md`.

Draft all of them now. Live tx hashes, contract addresses and the Arkiv entity link don't exist yet, because the wallets are being funded. Use clearly marked placeholders like `TODO(live): PaymentRouter address` so a later pass can fill them in. Never invent a hash or an address.

**README.md**:
- The problem, with a number.
- What PaisaLink does.
- A screenshot list (placeholders).
- Architecture with a mermaid diagram.
- "How each sponsor is used", with file:line references. Find the lines yourself with grep, e.g. USDT `receiveWithAuthorization` in `contracts/src/PaymentRouter.sol`, `createArkivStore` in `packages/arkiv/src/store.ts`, `worldRoutes` in `apps/api/src/world.ts`.
- "What breaks without <sponsor>", one line per sponsor.
- "Live vs demo shortcuts". Be honest: list the browser-local testnet demo wallets, the `/demo/fund` testnet faucet, the `/notes/demo-investor` "demo compliance desk", and the Swarm public gateway.
- Setup from a clean machine, using bun and Foundry.
- A table of tx hashes and explorer links (placeholders).
- A runnable Arkiv query (`bun run scripts/query.ts`).
- Tests with counts, from running the suites yourself. The exact commands are in `docs/handoffs.md` under "S1 findings".
- An AI usage summary linking to AI_USAGE.md.
- Licence.

**AI_USAGE.md**: complete the per-file table from the "Files created" lists in `docs/handoffs.md` and the prompts in `docs/prompts/`. Be honest: the code was written by Claude agents (Opus for code, Sonnet for tests and docs, Fable for research and the plan), directed and reviewed by the human. Keep the human's part accurate, with no exaggeration.

**WHITECHAIN_FEEDBACK.md**: what worked, and the friction we actually hit:
- no documented way to get test USDT
- the faucet is limited per IP and per GitHub account
- `eip712Domain()` and `version()` aren't implemented on USDT, so the domain version had to be found by brute force against `DOMAIN_SEPARATOR`
- the Blockscout verify path

Add suggestions. Leave a section "Builder's own notes" for the human to write.

**arkiv/*.md**: write every file Arkiv requires, with the exact names its prize text demands. Check `research/tracks.md` for the required file list and judging criteria, and map one file to each criterion. `friction.md` is 25% of the score, so base it on `docs/feedback/arkiv-sdk-notes.md` and make it specific, with a section for the human's own notes.

**docs/submission.md**: the ETHGlobal form text: a short description, a long description, how it's made, and per-prize text for Whitechain (Operate, Scale and Tokenize, each mapped to the requirement text), Arkiv (Build from scratch + Swarm bonus) and World (Best Use of IDKit). Include the credential reasoning: Proof of Human, and why the alternatives were rejected. Also include the AI disclosure, and note that the repo was created after kickoff.

**docs/demo-script.md**: a 3:00 narration script, timed per chapter, for the human to read aloud in their own voice. Use short spoken sentences. Open with a problem number. Show the full lifecycle: invoice → gasless pay on phone → live dashboard → refund → CSV → sell the invoice → an on-chain rule refusal → settle → Swarm PDF → World ID deny then verify. End with "what breaks without each sponsor" and what's next. Add a shot list for the screen recording beside the script.

Write plain, clear English with short sentences. Final reply, under 200 words: the files written and every TODO(live) placeholder that's left.
