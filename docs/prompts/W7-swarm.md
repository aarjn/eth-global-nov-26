# W7: Swarm invoice PDF (Opus) — Arkiv + Swarm bonus ($500)

**Own:** `apps/api/src/pdf.ts`, `apps/api/src/swarm.ts`, `arkiv/swarm.md`, tests in `apps/api/test/pdf*.test.ts`.

Read `research/tracks.md` (Arkiv section: the Swarm bonus wording, read-only), `research/tracks/stablecoins-data.md` (Arkiv/Swarm notes, read-only), PLAN.md section 2 "Swarm bonus", `apps/api/src/plugins.ts` (mount `pdfRoutes(ctx)` from `pdf.ts`; it serves `POST /invoices/:id/pdf`), `docs/handoffs.md`.

- `pdf-lib` (pin version) renders an invoice PDF with no personal data (invoice id, merchant handle, amount, due date, memo, PaisaLink branding, payment link + QR if cheap).
- `@ethersphere/bee-js` 13.2.0 uploads it. Find a working upload path TODAY: (a) a hackathon gateway/postage batch from the Arkiv/Swarm sponsors (check their docs, the Mumbai prize page text in research/, the Arkiv skills repo, any public "upload" gateway with free stamps); (b) a local Bee node in dev mode (`bee dev` or the `bee-factory`/`fdp-play` Docker setup; check whether Docker is available with `docker version`; do not install system packages without reporting first); (c) else implement fully against env `BEE_URL` + `BEE_BATCH_ID` and report exactly what the human must ask at the booth.
- Store the plain Swarm reference on the invoice (`swarmRef` via `ctx.store.upsertInvoice`, then `ctx.notify`); the receipt page already shows "Open PDF on Swarm" when set (link via a public gateway like `https://api.gateway.ethswarm.org/bzz/<ref>/` or whatever works).
- Never store an encrypted ref on Arkiv. Never fake an upload: if Swarm is unavailable, return 503 `SWARM_NOT_CONFIGURED`.
- `arkiv/swarm.md`: what goes to Swarm and why (bytes off-chain, pointer on Arkiv), the gateway used, a sample reference.
