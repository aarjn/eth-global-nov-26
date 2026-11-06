# PaisaLink: web app + API on one port (scripts/serve.ts). Built by Dokku on lechu (docs/hosting-paisalink.md).
# No secrets in this image: keys reach the container only as Dokku config (environment) at run time.
FROM oven/bun:1.4.3-slim

WORKDIR /app

# Install dependencies first (cached while lockfile and manifests are unchanged).
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/bunfig.toml apps/web/
COPY packages/arkiv/package.json packages/arkiv/
COPY packages/shared/package.json packages/shared/
COPY packages/widget/package.json packages/widget/
RUN bun install --frozen-lockfile

COPY . .

# Public URLs baked into the web build (not secrets). Override with --build-arg for another host.
ARG PUBLIC_URL=https://paisalink.tailcdec7a.ts.net
ARG VITE_DEMO_PRICE=4.90
RUN cd apps/web && VITE_API_URL="${PUBLIC_URL}/api" VITE_PUBLIC_APP_URL="${PUBLIC_URL}" \
    VITE_DEMO_PRICE="${VITE_DEMO_PRICE}" VITE_EXPLORER_URL=https://explorer.testnet.whitechain.io \
    bun run build

ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["bun", "scripts/serve.ts"]
