# Specs

The single source of truth for this build is `../../PLAN.md` (sections 2 and 3: architecture, interfaces, file ownership). Each workstream's prompt is saved in `../prompts/`.

Pinned on-chain facts (read with `cast` at hour 0):

- Whitechain Sepolia chain id 1874, RPC https://rpc.testnet.whitechain.io
- USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals, `name()` = "Tether USD"
- USDT EIP-712 domain: name "Tether USD", version "1", chainId 1874, verifyingContract = USDT. `DOMAIN_SEPARATOR()` = `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25` (matches). `eip712Domain()` and `version()` are not implemented on this token.
