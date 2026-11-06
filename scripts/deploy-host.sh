#!/usr/bin/env bash
# Redeploy the hosted PaisaLink (https://paisalink.tailcdec7a.ts.net) from this working tree, on lechu.
# The GitHub repo is private, so Dokku can't pull it: we send a clean tarball of the tree to `dokku git:from-archive`.
# Secrets never go in: .env*, .data, research/, recordings/, CLAUDE.md, node_modules and build output are excluded,
# and the script refuses if any value from .env.local appears in the tarball. Settings live in Dokku config
# (`sudo lechu-hosting env paisalink set`, values on stdin). Needs passwordless sudo on lechu.
set -euo pipefail
cd "$(dirname "$0")/.."
APP=${1:-paisalink}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tar -cf "$tmp/src.tar" --exclude=./.git --exclude=node_modules --exclude=./.env --exclude=./.env.local \
  --exclude=./.env.override --exclude='./.env.*.local' --exclude=./.data --exclude=./research --exclude=./recordings \
  --exclude=./CLAUDE.md --exclude=dist --exclude=./apps/web/test-results --exclude=./apps/web/playwright-report \
  --exclude=./contracts/out --exclude=./contracts/cache --exclude=./contracts/lib --exclude=./video \
  --exclude='*.log' --exclude='*.recovery.lock' .
mkdir "$tmp/x" && tar -xf "$tmp/src.tar" -C "$tmp/x"
if [[ -f .env.local ]]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ (KEY|PK|SECRET|TOKEN) && -n "${v:-}" ]] || continue
    if grep -rqF -- "${v#0x}" "$tmp/x"; then echo "refusing: the value of $k is in the tarball" >&2; exit 1; fi
  done < .env.local
fi
sudo -n dokku git:from-archive --archive-type tar "$APP" -- "PaisaLink deploy" "deploy@paisalink.local" < "$tmp/src.tar"
