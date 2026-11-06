# U1: make the PaisaLink UI warmer and more impressive (Opus 5.5, high effort)

Read `docs/prompts/common.md`; all its rules apply. It is Sat 7 Nov, 03:45 IST. **Hard stop: 05:00 IST.** After that the demo is re-recorded on this UI, then submitted by 07:30. A working, slightly less fancy UI beats a broken fancy one.

## What the owner asked for
"Make the UI more human-like, using an impressive UI library from the code garage." The judges see it in a 3-minute video and on the public link.

## Library (from the Code Garage)
- **Magic UI** (MIT, garage id `frontend.components.animated-component-kits`, trust *reviewed*). Mirror: `/data/apps/garage/mirror/magicuidesign__magicui/efe76fc5755e`. Copy individual components from its registry source into `apps/web/src/components/magicui/` and keep the MIT notice. Read the component source; don't use the CLI or the network.
- **Motion** (`motion` npm package, MIT). Install with `flock /tmp/paisalink-bun.lock bun add motion@<exact latest 12.x> --cwd apps/web`.
- Don't use React Bits or animate-ui (Commons Clause).

## Design direction: "human", warm, trustworthy, Indian freelancer
- Friendly microcopy, e.g. "Hi Priya 👋", "Money's on its way", "Paid. Nice work!".
- Warm off-white background, rounded cards, soft shadows, one confident brand colour.
- Good typography: a self-hosted variable font if one is already available offline. Otherwise a system stack with a better weight and tracking. **No network font loads.**
- Motion that helps the story, at most 2–3 kinds:
  - number ticker on the dashboard totals
  - a satisfying "Paid" moment on the pay page (confetti or animated check; Magic UI has both)
  - gentle fade/slide-in of new invoice rows
  - shimmer or pulsating primary buttons
- Optional: an animated beam or orbit on the home page showing Client → PaisaLink → Whitechain, Arkiv, Swarm, World.
- Avatars and initials circles for the merchant, payer and investor ("P" for Priya).
- Prioritise the screens in the video, in this order: `/merchant` dashboard, `/pay/:id` (mobile 390 px), `/invest`, `/r/:id` receipt, `/onboard`, `/demo-store`, home.

## Do not break anything
- Keep every `data-testid`, button label and text that `apps/web/e2e/live.spec.ts`, `apps/web/e2e/record/record-demo.ts` and `apps/web/e2e/pages.spec.ts` select on. Grep them first. If you must change a label, update all three files.
- Respect `prefers-reduced-motion`. Animations must not slow down state changes: the recorder waits on text.
- No functional or API changes.
- `bun run typecheck`, `bun test` (in apps/web), the vite build (`bun run build`) and `pages.spec.ts` must pass. Run the page tests against the local vite dev server on :5173, which is still running. Its API is gone, so API-dependent tests may skip.
- No horizontal scroll at 390 px.

## Deliver by 05:00
- Take screenshots of `/merchant`, `/pay/<an existing paid invoice>`, `/invest` and the home page at 1440 and 390 width into `apps/web/e2e/screenshots/ui-*.png`, and look at them.
- Add an entry to `AI_USAGE.md` (U1, Opus 5.5), and add Magic UI and Motion with their licences to the README credits.
- **Don't redeploy the hosted app**; the coordinator does that.

## Rules
- No git.
- Never print secrets.
- Don't touch CLAUDE.md or research/.
- Don't start `claude` processes.
- Send no transactions.

## Report
Under 150 words: what changed, the screenshot paths, the test results, and any label changes.
