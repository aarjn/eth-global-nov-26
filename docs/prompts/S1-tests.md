# S1-tests prompt (verbatim)

You are test agent S1 for PaisaLink, a hackathon project. The repo is at /home/lechuuu/hackathons/ethglobal-nov26.

First read `docs/prompts/common.md` in full. Its rules apply to you: no git commands, never print or write secrets, use bun and Foundry only, install with `flock /tmp/paisalink-bun.lock`, don't touch `research/` or `CLAUDE.md`. Then read PLAN.md sections 2–4, `docs/specs/contracts.md` and `docs/handoffs.md`.

You own only test files: `contracts/test/**` (add new files; don't rewrite existing ones), `apps/api/test/**` (new files only), and `packages/*/test/**`. Don't edit source files. If you find a bug, write it in `docs/handoffs.md` under "S1 findings": file:line, how to reproduce, expected vs actual. Other agents are editing source in parallel.

Your task:
1. Run every suite and record a baseline:
   - `export PATH=$HOME/.foundry/bin:$PATH; cd contracts && forge test`
   - `RUN_FORK=1 forge test --match-contract ForkUSDT`
   - `bun test apps/api`
   - `bun test packages`
   - `cd apps/web && bun test && bun test ./src/routes/invest && bun run typecheck && bun run build`
2. Add the missing edge tests the plan asks for:
   - Contracts: fuzz on amounts, a replayed EIP-3009 nonce, a refund over balance, `withdraw` after a financed invoice is paid (it must fail, because the money goes to escrow), and a signature replay across merchants.
   - API: relay validation for every error code, rate-limit windows, the budget reset, CSV with commas, quotes and unicode, and widget typed-data vectors that match the contract's `paymentNonce`.
   - Security: a reused World nullifier; an invoice created for an unverified merchant can't be relayed gaslessly; `/demo/fund` and `/notes/demo-investor` refuse any chain other than 1874.
3. Add a root `bun run test:all` script to package.json? No: you don't own it. Write the exact command list you used in `docs/handoffs.md` for the coordinator.

Final reply (under 250 words): the suite counts before and after, any failures, and your findings with file:line.
