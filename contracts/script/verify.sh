#!/usr/bin/env bash
# Verifies PaymentRouter and InvoiceNote on the Whitechain testnet Blockscout explorer.
# Usage (from contracts/): bash script/verify.sh     (reads addresses from deployments/1874.json; no secrets needed)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

DEP=deployments/1874.json
get() { bun -e "console.log((await Bun.file('$DEP').json())$1)"; }
USDT=$(get .usdt); OWNER=$(get .owner); OPERATOR=$(get .operator)
ROUTER=$(get .paymentRouter); NOTE=$(get .invoiceNote)
[ "$ROUTER" != "null" ] || { echo "not deployed yet"; exit 1; }

COMMON=(--chain 1874 --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --compiler-version 0.8.28 --watch)

forge verify-contract "${COMMON[@]}" "$ROUTER" src/PaymentRouter.sol:PaymentRouter \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address)' "$USDT" "$OWNER" "$OPERATOR")"

forge verify-contract "${COMMON[@]}" "$NOTE" src/InvoiceNote.sol:InvoiceNote \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address)' "$USDT" "$ROUTER" "$OWNER")"

echo "https://explorer.testnet.whitechain.io/address/$ROUTER?tab=contract"
echo "https://explorer.testnet.whitechain.io/address/$NOTE?tab=contract"
