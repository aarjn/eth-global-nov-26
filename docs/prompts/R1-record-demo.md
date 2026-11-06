# R1: record the demo video footage, live on testnet (Opus 5.5, high effort)

Read `docs/prompts/common.md`; all its rules apply. It is **Sat 7 Nov, 01:20 IST**. Submissions close at 09:00, and the owner records the voice-over from your clips. **You have until 03:00 IST at the latest.** Favour footage that works over footage that is polished.

## Situation
- API on :8787 and web on :5173 at http://100.125.124.63. Both were restarted at 01:18.
- `.env.override` sets `DEMO_FUND_USDT=4.90`.
- The deployer and faucet wallet holds **2.42 test USDT**, and no more will come. The footage must fit inside that budget, so use:

| Item | Amount (USDT) |
|---|---|
| Invoice A | 1.00 |
| Partial refund | 0.20 |
| Invoice B, sold as a note | face 0.50, price 0.45 |
| Maturity | "5 minutes (demo)" (new option in `apps/web/src/routes/invest/SellInvoice.tsx`) |

  Total spend: 1.00 + 0.45 + 0.50 = 1.95.
- Only the demo merchant `0xC038827b4E362B0de1Be859377508613CD028946` is World-verified. Load `DEMO_MERCHANT_PRIVATE_KEY` into the merchant browser context with `addInitScript`, the same way `apps/web/e2e/live.spec.ts` does. Never print it. **Never turn on trace**, because a trace captures the init script. Video recording only captures pixels, so it is fine.
- `apps/web/e2e/live.spec.ts` (steps 0-8) is the working reference: copy its selectors and waits. Run 2 passed steps 0-7 live. Step 8 is fixed but not yet proven, so watch it.

## Task
1. Write `scripts/record-demo.ts`, or a Playwright spec under `apps/web/e2e/record/`, whichever is quicker. It records **one clip per chapter** of `docs/demo-script.md`:
   - Use Playwright `recordVideo` at 1920x1080 for desktop contexts.
   - For the payer phone shots, use a 390x844 mobile viewport recorded at the same size, then pad it to 1920x1080 with ffmpeg.
   - Use a small `slowMo` (about 150 ms) and pause 1.5-2 s on each important result, so a viewer can read it.
   - Show real time, with no speed-up. Cutting between chapters is fine. Cut the long maturity wait and don't record it.
2. Chapters:
   - ch02: create invoice A on `/merchant`.
   - ch03: payer on mobile opens the link, gets test USDT, taps Pay, sees Paid. Then open the explorer tx page in a desktop context and hold it.
   - ch04: dashboard shows Paid, then the partial refund and its tx link.
   - ch05: CSV export button, then `/demo-store` with its source.
   - ch06: sell invoice B, then the investor sets up the desk and funds the note.
   - customer pays B into escrow (fold this into ch06 or make it a short clip).
   - ch07: the rule refusal. Before maturity that's "Try to settle early"; after maturity it's the transfer attempt. Show the revert reason.
   - ch08: settle after maturity.
   - ch09: receipt `/r/<id>`, "Open PDF on Swarm", then the Arkiv explorer entity page.
   - ch10: `/onboard` for the verified demo merchant showing the Verified badge. Then a fresh unverified merchant opens IDKit, closes it, and the locked banner shows. Use `apps/web/e2e/world-live.spec.ts` as the reference. If IDKit staging is flaky, show the verified badge plus the locked banner only.
   - ch01 and ch11 (title and architecture) are static. Make a 1080p title card and an end card with ffmpeg `drawtext`, 14 s and 18 s long. Text: "PaisaLink: get paid from abroad in USDT" and "Everything shown is live on Whitechain testnet · github.com/aarjn/eth-global-nov-26".
3. Save the clips to `recordings/` at the repo root as `ch01.mp4` … `ch11.mp4`, H.264, 1080p, 30 fps. Add `recordings/` to `.gitignore`. Write `recordings/README.txt` listing each clip's duration and what it shows.
4. Run it **once** live. If something fails mid-way, re-record only that chapter, and only if the budget allows. Check the USDT balance first.
5. Collect every tx hash and Arkiv entity key the run produced, check each one with `cast receipt`, and **append** a "Run 3 (recording)" section to `docs/live-run.md`.
6. Write `scripts/mux-video.sh`. It takes `recordings/ch01.mp4 … ch11.mp4` and the owner's audio `recordings/audio/ch01.* … ch11.*`, matches each clip's length to its audio (hold the last frame if the audio is longer, trim the tail if the clip is longer), concatenates them, and writes `recordings/paisalink-demo.mp4` (1080p, AAC). Test it with silent placeholder audio.

## Rules
- No git.
- Don't restart servers. If the API dies, report it.
- Never print secrets.
- Make no app code changes except tiny, clearly needed bug fixes, and list them.

## Report
Under 250 words: the clips made, with durations; the tx table; the USDT left; any bug fixes; the exact mux command.
