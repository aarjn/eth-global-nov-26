# Whitechain feedback

From PaisaLink, a solo build for ETHGlobal Mumbai 2026 (Operate, Scale and Tokenize in one repo). Chain: Whitechain Sepolia (1874). Written 6 Nov 2026.

## What worked

- **The RPC and the explorer were reliable.** `https://rpc.testnet.whitechain.io` answered `cast` and viem without trouble. The explorer is Blockscout, so contract pages, token pages and the standard API worked as expected.
- **EVM tooling just worked.** Foundry, viem and OpenZeppelin v5 needed no chain-specific changes. We forked chain 1874 in Foundry and ran 4 tests against the real USDT (`contracts/test/Fork.t.sol`).
- **The USDT supports EIP-3009.** `receiveWithAuthorization` is on the official testnet USDT (a proxy to `TetherTokenV2`). That made a true gasless checkout possible: the payer signs typed data, our relayer sends the transaction, and the router receives the funds. The `receive` variant also stops anyone from front-running the authorization.
- **The gas floor is clear.** 5 gwei, about 0.0001 WBT per transfer. That made the relayer's budget easy to plan.
- **The track briefs were precise.** The "won't place" lists saved us from building the wrong thing.

## Where we got stuck

### 1. No documented way to get test USDT

The sponsor requires payments in one exact USDT (`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`). A token you mint yourself doesn't count. We could not find a page in the docs that says how to get that token on testnet. The WBT faucet gives WBT only. We found the testnet swap (`testnet.yetitrade.fi`) by searching, and it needs a browser wallet. An agent or a script can't use it.

Impact: the first real USDT payment, which should be the first hour's checkpoint, depended on a manual browser swap and on asking at the booth.

### 2. The faucet is limited per IP and per GitHub account

The WBT faucet asks for a GitHub sign-in and limits claims per account (0.5 WBT per 24 hours) and per IP. At a venue, many people share one IP, so a claim can fail through no fault of your own. A project with several roles needs several funded wallets: deployer, relayer, investor. For us that meant a phone hotspot and several GitHub accounts, for a testnet.

Impact: a gasless-payments product needs a funded relayer, and the relayer needs its own balance on top of the deployer's. The limits made the funding step the slowest part of the build.

### 3. `eip712Domain()` and `version()` are not implemented on the USDT

EIP-3009 signatures need the token's EIP-712 domain. We read `name()` = "Tether USD" and `DOMAIN_SEPARATOR()`. But `eip712Domain()` (ERC-5267) and `version()` don't exist on this token. The version string is the one missing piece, and nothing on chain or in the docs states it.

How we solved it: we computed `keccak256(EIP712Domain(name, version, chainId, verifyingContract))` for candidate versions and compared the result to `DOMAIN_SEPARATOR()`. This was a brute-force search over a handful of strings. The match is `version = "1"`. The result is pinned in `packages/shared/src/usdt.ts` and checked by tests in `packages/shared/test/usdt.test.ts`. A real signature is also checked against the real token in `contracts/test/Fork.t.sol`.

Impact: anyone building EIP-3009 flows on this token has to repeat this search, or ship a wrong domain and get `invalid signature` with no hint why.

### 4. The Blockscout verify path

We verify with Foundry, using `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` (see `contracts/script/verify.sh`). The docs we found don't show this command for Whitechain. We assembled it from the Blockscout docs: the verifier name, the `/api/` suffix, the chain id and the exact compiler version (0.8.28) had to match our build.

`TODO(owner): after the real verify run, add what actually happened here: did it pass first time, how long did it take, any error text. Do not leave this section if verification was smooth.`

## Suggestions

1. **Publish the test USDT instructions.** One docs page: the address, the decimals, how to get it (a faucet button, a swap link, or a script), and a daily limit.
2. **Add a USDT drip to the faucet**, or a token faucet that can be called with a signed message or a script. Make it callable without a browser.
3. **Raise or document the faucet limits**, and show the remaining quota and the reset time on the page. Consider a hackathon mode with a higher per-IP limit, or a code printed at the booth.
4. **Document the USDT's EIP-712 domain** (name "Tether USD", version "1", chain id, contract) and the EIP-3009 functions. Better still, add `version()` and `eip712Domain()` to the testnet token if it can be redeployed or upgraded.
5. **Add a "verify with Foundry" snippet** to the explorer docs: exact flags, the `/api/` URL, an example with `--watch`.
6. **Give a relayer allowance for builders.** A larger WBT drip for projects that sponsor gas (Scale track), or a grant of WBT for the demo day.
7. **Publish a gasless-checkout reference** (about 100 lines: sign, relay, receive). It would help the Scale track most.

## Builder's own notes

_To be written by the builder (aarjn) from their own experience: what you did at the booth, how long the faucet and swap steps really took, what you would tell the next hacker._

- TODO(owner): first 3 lines from experience.
- TODO(owner): booth answers (EIP-712 version, test USDT top-up).
- TODO(owner): anything good or bad not listed above.
