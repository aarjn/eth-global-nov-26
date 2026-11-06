#!/usr/bin/env bash
# Builds .env.local from .env.example plus secrets in lechu-secret (stack "hackathon").
# Never prints secret values. .env.local is git-ignored.
set -euo pipefail
cd "$(dirname "$0")/.."
declare -A MAP=(
  [DEPLOYER_PRIVATE_KEY]=PAISA_DEPLOYER_PK [ARKIV_PRIVATE_KEY]=PAISA_DEPLOYER_PK
  [RELAYER_PRIVATE_KEY]=PAISA_RELAYER_PK [DEMO_MERCHANT_PRIVATE_KEY]=PAISA_MERCHANT_PK
  [DEMO_PAYER_PRIVATE_KEY]=PAISA_PAYER_PK [DEMO_INVESTOR_PRIVATE_KEY]=PAISA_INVESTOR_PK
  [ARKIV_ACCESS_KEY]=ARKIV_ACCESS_KEY [WORLD_APP_ID]=WORLD_APP_ID [WORLD_RP_ID]=WORLD_RP_ID
  [WORLD_SIGNING_KEY]=WORLD_SIGNING_KEY [BEE_URL]=BEE_URL [BEE_BATCH_ID]=BEE_BATCH_ID
  [VITE_WORLD_APP_ID]=WORLD_APP_ID
)
have=$(lechu-secret keys hackathon 2>/dev/null | tr ' ' '\n')
out=.env.local; umask 077; : > "$out"
# Non-secret deployed addresses, if present
dep=contracts/deployments/1874.json
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && { echo "$line" >> "$out"; continue; }
  k=${line%%=*}; v=${line#*=}
  s=${MAP[$k]:-}
  if [[ -n "$s" ]] && grep -qx "$s" <<<"$have"; then v=$(lechu-secret show hackathon "$s"); fi
  if [[ -f "$dep" && -z "$v" ]]; then
    case $k in
      PAYMENT_ROUTER_ADDRESS) v=$(bun -e "console.log(require('./$dep').PaymentRouter?.address ?? '')");;
      INVOICE_NOTE_ADDRESS) v=$(bun -e "console.log(require('./$dep').InvoiceNote?.address ?? '')");;
    esac
  fi
  printf '%s=%s\n' "$k" "$v" >> "$out"
done < .env.example
missing=$(grep -E '^[A-Z_]+=$' "$out" | cut -d= -f1 | tr '\n' ' ')
echo "wrote $out (missing: ${missing:-none})"
