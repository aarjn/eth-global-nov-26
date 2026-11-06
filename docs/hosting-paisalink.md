# Hosting PaisaLink on lechu (H1, 7 Nov 2026)

Live address: **https://paisalink.tailcdec7a.ts.net** (web app at `/`, API at `/api/*`).

## How it runs
- One container, one port: `scripts/serve.ts` serves `apps/web/dist` (SPA fallback to `index.html`) and mounts the
  Hono API (`apps/api/src/app.ts`) under `/api`, with the prefix stripped (`/api/health` -> API `/health`).
  Logic in `scripts/serve-lib.ts`, tests in `scripts/serve.test.ts`.
- `Dockerfile` (repo root): `oven/bun:1.4.3-slim`, `bun install --frozen-lockfile`, builds the widget `embed.js` and the
  web app with `VITE_API_URL=https://paisalink.tailcdec7a.ts.net/api` and `VITE_PUBLIC_APP_URL=https://paisalink.tailcdec7a.ts.net`
  (build arg `PUBLIC_URL`), then `bun scripts/serve.ts` on port 5000. `.dockerignore` keeps `.env*`, `.data`,
  `research/`, `recordings/`, `CLAUDE.md` and `node_modules` out.
- Platform: the owner's Dokku hosting (`lechu-hosting`, app `paisalink`, owner "me", 512 MB, gVisor sandbox), behind
  its own Tailscale sidecar; public access is Tailscale Funnel (`lechu-hosting expose paisalink on|off`).
- The GitHub repo is private, so Dokku can't pull it (auto-deploy is off). Deploys send a clean tarball of the working
  tree: `bash scripts/deploy-host.sh` (it refuses if any `.env.local` secret value is in the tarball).

## Settings (Dokku config, set with `sudo lechu-hosting env paisalink set`, values on stdin from `.env.local`)
Names only: WC_RPC_URL, WC_WS_URL, WC_CHAIN_ID, WC_EXPLORER_URL, USDT_ADDRESS, PAYMENT_ROUTER_ADDRESS,
INVOICE_NOTE_ADDRESS, DEPLOYER_PRIVATE_KEY, RELAYER_PRIVATE_KEY, ARKIV_PRIVATE_KEY, ARKIV_ACCESS_KEY, ARKIV_RPC_URL,
ARKIV_WS_URL, ARKIV_CHAIN_ID, WORLD_APP_ID, WORLD_ACTION, WORLD_RP_ID, WORLD_SIGNING_KEY, WORLD_ENVIRONMENT,
SWARM_GATEWAY_URL, DEMO_FUND_USDT, DEMO_INVESTOR_WBT, PUBLIC_APP_URL, WORLD_NULLIFIER_FILE, TRUST_PROXY.

To change one: `printf 'NAME=value\n' | sudo -n lechu-hosting env paisalink set` (restarts the app).

## Persistent files
Storage is on: `/data/apps/hosting/paisalink` on the host is `/app/data` in the container.
`WORLD_NULLIFIER_FILE=/app/data/nullifiers.json` (copied from the dev `.data/nullifiers.json` at cutover).

## Nonce safety
Only one API may hold the relayer/deployer keys. The dev API on :8787 was stopped at cutover. To go back to local
dev: `sudo lechu-hosting stop paisalink` first, then start the dev API.

## Useful commands
`sudo lechu-hosting status paisalink` · `sudo lechu-hosting logs paisalink 100` · `sudo lechu-hosting restart paisalink`
· `sudo lechu-hosting expose paisalink off` (take it off the internet).
