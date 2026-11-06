# PLAN-planner prompt (verbatim)

You are the planning lead for a SOLO hacker at ETHGlobal Mumbai 2026 (Classic track). The owner chose **PaisaLink**. Write the build plan. HARD TIME BOX: write the file by **08:10 IST on 6 Nov** (check with `TZ=Asia/Kolkata date`; it is about 07:42 now). Submissions close **Sat 7 Nov 09:00 IST**.

READ FIRST, in `/home/lechuuu/hackathons/ethglobal-nov26/research/`:
- `ideas.md` §"Idea 3. PaisaLink", Part 1 insights and "Shared execution rules"
- `REPORT.md`
- `VERIFY.md`
- `tracks.md` and `tracks.json`: the Whitechain, Arkiv and World entries, verbatim requirements and "won't place" lists
- `tracks/stablecoins-data.md`: Whitechain and Arkiv implementation details, chain ids, USDT EIP-3009, faucets, SDK versions
- `tracks/identity-privacy.md`: World IDKit
- `past-winner-patterns.md`: video and pitch structure

Use the Mumbai rules in tracks.md §2 (AI attribution, commit history, video rules: own voice, no TTS).

THE DECISIONS (owner, final):
- Product: PaisaLink. Sponsors: Whitechain (Operate, Scale and Tokenize), Arkiv (Build from scratch, plus the Swarm bonus) and World (IDKit).
- Team: 1 person (the owner). All code is written by parallel Claude Opus 5.5 subagents (high effort). Tests, verification and docs/paperwork are written by Sonnet 5.5 subagents. A coordinator Claude reviews, integrates and commits.
- Classic track: an empty repo at kickoff, and no project-specific code from before. Third-party libraries, templates and the owner's Code Garage items are fine with their licences.
- Repo: `/home/lechuuu/hackathons/ethglobal-nov26`. Its remote is `aarjn/eth-global-nov-26`, created 2026-11-06 01:01 IST, after kickoff; it holds only a README. Commits are authored ONLY as `aarjn <50370450+aarjn@users.noreply.github.com>`, with no Co-Authored-By or AI trailers. Only the coordinator commits and pushes. Commit small and often. The local `CLAUDE.md` and `research/` are git-excluded and must never be committed.
- Demo video: the coordinator records the screen (Playwright, which has Chromium installed, plus ffmpeg 8). It writes a timed narration script, the owner reads it into a mic, and ffmpeg muxes the audio. Requirements: about 3 min, 1080p, the owner's real voice.
- The owner must make a meaningful human contribution, to satisfy the rule "AI should assist, not create the entire project". Plan concrete owner tasks: product decisions recorded in `DECISIONS.md`, a phone test of each milestone, the feedback files written from the owner's own experience, booth visits. Every prompt, spec and plan goes in the repo, for example `docs/specs/` and `docs/prompts/`, and `AI_USAGE.md` lists the AI-generated files.
- Server tooling: bun 1.4.3 is installed. node, npm, pnpm and Foundry (forge/cast) are MISSING. Plan their install in hour 0, for example nvm/Node 22 LTS and foundryup, or decide to use bun everywhere plus Foundry for contracts. Chromium for Playwright is installed.
- Code Garage: before planning any component, search the owner's curated catalog for reusable pieces: `grep -i` over `/home/lechuuu/code-garage/dist/index/*.md` and `/home/lechuuu/code-garage/catalog/*.yaml` (web3: EIP-3009/permit relayers, viem templates, Foundry templates, Next.js/React widget kits, Blockscout verify scripts). Name the item id, trust tier and licence of each one you plan to reuse.

THE PLAN MUST CONTAIN (write `/home/lechuuu/hackathons/ethglobal-nov26/PLAN.md`; this file WILL be committed, so write it as a public project plan and leave secrets out):
1. The product in 5 lines and the demo story: invoice → gasless USDT pay on phone → live dashboard → one-click refund → accountant export → invoice sold for cash (financing). State exactly which prize lines each feature satisfies, quoting the requirement text, and check every item on each sponsor's "won't place" list.
2. Architecture: monorepo layout, packages, chains (Whitechain Sepolia testnet 1874, the official USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, EIP-3009 `receiveWithAuthorization`/`transferWithAuthorization`), contracts (e.g. an invoice registry/escrow with refund, plus a Tokenize contract for invoice financing with real enforced transfer rules: allowlist, maturity, settlement in USDT), the relayer with drain protection (rate limits, a World-ID-gated merchant allowlist, a per-merchant gas budget), Arkiv as the ONLY database (entity schemas, annotations, TTLs, queries), the Swarm bonus (invoice PDF), World IDKit (which credential and why, plus the failure path), and the frontend (merchant dashboard, payer checkout page, embeddable widget). Use the exact package names and versions from the research files.
3. Interface contracts between workstreams, so parallel agents don't collide: TypeScript types, contract ABIs/events, Arkiv entity schemas, REST endpoints, env var names, and FILE OWNERSHIP per workstream.
4. Workstreams for parallel Opus agents (W1..Wn), each with: owner files, inputs, outputs, acceptance tests, hours, and MUST (for qualification) vs POLISH. Add the Sonnet test/verify streams and the Sonnet paperwork stream.
5. A timeline from 08:30 IST Fri to 09:00 IST Sat, with hard checkpoints: the first real USDT tx on 1874 by about hour 4; the first Arkiv entity by about hour 3; IDKit verify by about hour 6; feature freeze about 23:30 IST; video recorded about 03:00–05:00; submission done by 07:30 IST with a buffer. Include sleep for the solo human: the owner must sleep, so mark which steps need the human (booths, faucets, browser-only setups such as the World Developer Portal app id, the Arkiv hub access key, the Whitechain faucet, and voice recording) and batch them.
6. The OWNER CHECKLIST for the first 60 minutes: exact URLs and steps for faucets (WBT, testnet USDT via the yetitrade swap or the booth), the Arkiv access key and faucet, the World Developer Portal app plus staging, and which booth to visit with which question. Explain each step clearly with the reason (the owner likes click-by-click steps plus the why).
7. Paperwork per sponsor: `WHITECHAIN_FEEDBACK.md`, the four `/arkiv/*.md` files (the exact names Arkiv requires), the World debrief, README sections with tx hashes and explorer links, `AI_USAGE.md`, the submission form text per prize, and the video requirements per sponsor.
8. The demo script (3:00) with timestamps, plus the risk register and fallbacks (no test USDT, faucet IP limits so use a phone hotspot, Arkiv lag, World sandbox issues). Never fake a result. Any mock must be labelled.
9. A secrets plan: private keys and API keys live only in `lechu-secret` (stack `hackathon`), are loaded into a git-ignored `.env.local` at runtime, and are never committed. The relayer and deployer keys are fresh testnet keys.

RULES: Planning only. Don't write product code. No git commands. Don't read secret values (you may say "store with lechu-secret"). Don't start `claude` processes. Plain, clear English with short sentences. Final reply (under 300 words): the workstream list with hours, the critical path, and the owner's first-hour checklist in brief.
