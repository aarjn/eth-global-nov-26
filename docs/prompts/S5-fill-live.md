# S5: fill in every TODO(live) with real evidence (Sonnet 5.5)

Read `docs/prompts/common.md`; all its rules apply. It is Sat 7 Nov, 01:20 IST, and submissions close at 09:00.

## Sources of truth
Use only these, and check every hash with `cast receipt <hash> --rpc-url https://rpc.testnet.whitechain.io` (status 1):

- `contracts/deployments/1874.json`:
  - PaymentRouter `0x97613d5bE2c3dd747c110b460Ff2e0FC69701005`
  - InvoiceNote `0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7`
  - both verified on https://explorer.testnet.whitechain.io
  - deploy tx hashes are in `contracts/broadcast/Deploy.s.sol/1874/run-latest.json`
- First gasless payment: `0x07c94ba03059287729b65b5eb35f76bd6787687d672ec4bc1b881abe1e5ac36e`.
- `docs/live-run.md`, run 2: invoice create, gasless pay 4.90, refund 0.90, note issue.
- World: demo merchant verified, Arkiv entity `0x3e3ea5c0eb83e4008c5a27cd9b4684c532ff608fbc03fc3c1d00377a972b824c` (https://rabdi.explorer.arkiv.network/entity/<entity-id>). Details are in `docs/WORLD_DEBRIEF.md`.
- Swarm: the run 2 step 7 Swarm ref is in `docs/live-run.md` and the Arkiv invoice entity.

## Task
1. Replace every `TODO(live)` in `README.md` and `docs/submission.md` with the real values and links.
   - Fund, escrow-pay, refusal and settle hashes come from a recording run that is still in progress. Write `PENDING(run3)` for those, so the coordinator can fill them in later.
   - Don't invent anything.
2. `docs/demo-script.md`:
   - The recording now uses: invoice 1.00 USDT, refund 0.20, note face 0.50 sold for 0.45, maturity 5 minutes (demo).
   - Update the narration to say those amounts naturally ("one USDT", "twenty cents", "fifty cents, sold for forty-five"), then remove that TODO(owner).
   - Chapter 10: say the merchant is already verified (the badge), then a second merchant cancels. Keep each chapter's word count inside its time budget.
3. `AI_USAGE.md`: add the W8, S4, S5 and R1 briefs from `docs/prompts/`, the files they produced, and the models (W8 and R1: Opus 5.5; S4 and S5: Sonnet 5.5).
4. Remove stale markers: `AI_USAGE.md` lines that say the S3 brief or the verification files are missing (both exist now).
5. Leave every `TODO(owner)` that needs the owner's own words. Collect them in a new file, `docs/owner-todo.md`: a short checklist with file:line and what to write, in plain words, at most 12 items. The owner is solo and short on time, so mark the 4 most important.
6. Run `bun scripts/verify-submission.ts` and fix whatever it flags that is yours to fix. Report what remains.

## Rules
- No git.
- Edit only `README.md`, `docs/submission.md`, `docs/demo-script.md`, `AI_USAGE.md` and `docs/owner-todo.md`.
- Don't touch `docs/live-run.md`; the R1 agent is appending to it.
- Plain, short sentences.

## Report
Under 200 words: what's filled, what's PENDING(run3), and what verify-submission still flags.
