# H1: host PaisaLink publicly on this server (Opus 5.5, high effort)

Read `docs/prompts/common.md`; all its rules apply. It is Sat 7 Nov, about 02:50 IST, and submissions close at 09:00. **Have it working by 04:30.**

## Goal
Make PaisaLink (web + API) reachable at a public HTTPS link on this server, preferably **https://paisalink.tailcdec7a.ts.net**. Use the owner's hosting platform: Dokku, a per-app Tailscale sidecar, and Funnel for public access.

- The platform helper is `sudo -n lechu-hosting` (subcommands: add, deploy, expose, env, sidecar, logs, status…). Run `--help` on each subcommand.
- Docs and history are in `~/backups/phase16-hosting/` (PLAN.md, TEST.md, logs) and `docs/hosting.md` wherever it lives. Grep for it.

## Constraints
- **The GitHub repo is private and must stay private** (the owner's decision). Use the platform's `git push dokku@lechu:<app>` path, or another documented local path. Check how Phase 16 handled it. Don't make the repo public, and don't put the GitHub token anywhere.
- **One container, one port.** Add a small production server, e.g. `apps/server/` or `scripts/serve.ts`:
  - serve the built web app (`apps/web` vite build) with an SPA fallback
  - mount the existing Hono API under `/api`, stripping the prefix, so `/api/health` → API `/health`
  - build the web app with `VITE_API_URL=https://<host>/api` and `VITE_PUBLIC_APP_URL=https://<host>`
- Add a `Dockerfile` at the repo root: a bun 1.x image, `bun install`, build web and widget/embed, run the server.
- **Secrets:** set them with `lechu-hosting env set` (or the documented way), reading values from the root `.env.local`. Never print them, and never write them into the image, the repo or any log. Only names in your report.
- **Nonce safety:** the relayer and deployer keys must have only ONE live API at a time. When the hosted API works, stop the dev API on :8787. Find the pid with `ss -ltnp | grep :8787`; never use `pkill -f`. Leave the vite dev server alone.
- Persistent files (the World nullifier store, `WORLD_NULLIFIER_FILE`): use platform storage if it is easy; otherwise note it.
- **Public exposure:** if `expose on` needs the owner (passkey or fingerprint), stop at that point. Write the exact steps for the owner in `docs/handoffs.md` under "Hosting: owner step", and report.
- Check, from inside the server, that `https://<host>/` loads, `https://<host>/api/health` is ok with contracts set, `/api/world/config` returns configured:true, and `/pay/<existing invoice id>` renders.
  - Get existing invoice ids from `docs/live-run.md`.
  - Spend no USDT.
- Keep all tests green, and add a small test for the prefix-strip server if it's easy.

## Rules
- No git commands, with one exception: pushing to the local dokku remote if that is how the platform deploys. Never commit, and never push to GitHub. The coordinator commits, as aarjn, with no AI attribution.
- Don't touch CLAUDE.md or research/.
- Don't start `claude` processes.
- Another agent is editing video files in `recordings/`; stay out of there.

## Report (under 200 words)
- the URL
- what is public and what still needs the owner
- the files added
- the env var names set
- the checks run
