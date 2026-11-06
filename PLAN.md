# PaisaLink: build plan for ETHGlobal Mumbai 2026 (Classic track, solo)

Written Fri 6 Nov 2026, 07:45 IST. Hacking window for this plan: 08:30 IST Fri to 09:00 IST Sat (submissions close). This file is public and holds no secrets.

## 0. One-line summary

PaisaLink lets an Indian freelancer or exporter get paid in USDT on Whitechain with a drop-in widget or payment link, with gasless checkout for the payer, one-click refunds, accountant export, and the option to sell the invoice for cash today. All app data lives in Arkiv. World ID (Proof of Human) gates who may use the gas-sponsored relayer.

## 1. Product and demo story

### The product in 5 lines

1. A merchant creates an invoice (amount, due date, note). It becomes an Arkiv entity and a payment link `/pay/<invoiceId>`.
2. The payer opens the link on a phone, taps Pay, and signs an EIP-3009 `receiveWithAuthorization` for the official Whitechain Sepolia USDT. Our relayer submits it and pays the WBT gas. The payer never holds WBT, never sees a chain name.
3. The merchant dashboard reads Arkiv live: invoice paid, tx link, refund button, CSV export for the accountant, PDF receipt on Swarm.
4. An exporter with a 30-day invoice tokenises it as an `InvoiceNote`; an allowlisted investor funds it at a discount in USDT; at maturity it settles in USDT; transfers after maturity revert.
5. Merchant onboarding to the gas-sponsored path needs one World ID Proof of Human; a cancelled or failed check blocks the gasless path (self-paid `pay()` remains available).

### Demo story (3 minutes, detail in section 8)

invoice -> gasless USDT pay on phone -> live dashboard -> one-click refund -> accountant export -> invoice sold for cash (financing) -> World ID denied path -> architecture.

### Prize lines and the requirement text each feature satisfies

Three sponsors are picked on the form: Whitechain, Arkiv, World. "If a Partner has multiple tracks, you can be eligible for all of them, but they still count as just 1 Partner Prize."

| Feature | Prize line | Requirement text (verbatim) | How we meet it |
|---|---|---|---|
| `PaymentRouter.sol`, widget, dashboard, refund, CSV | Whitechain Operate ($5,000) | "A drop in piece, widget, SDK, payment link API or plugin that a separate demo app adds in about 20 lines"; "both merchant and customer views"; "extra credit for refunds/renewals/accountant export" | `packages/widget` + `apps/web/demo-store` (about 20 lines), merchant dashboard and payer checkout, `refund()`, CSV export |
| Relayer + EIP-3009 | Whitechain Scale ($3,000) | "pays in stablecoins without holding WBT for gas, writing down a seed phrase or knowing what chain they are on"; show "how the business pays gas, how the relayer gets WBT, what stops draining" | `receiveWithAuthorization` signed in the browser, relayer submits, README section "Gas and drain protection" |
| `InvoiceNote.sol` | Whitechain Tokenize ($4,000) | "Real transfer rules enforced in the contract, such as allowlists, transfer restrictions, maturity or settlement conditions"; "a clear issuer/investor/business user and one full lifecycle step"; "Financing or selling an invoice belongs in Tokenize" | allowlist on transfer, transfers blocked after maturity, `settle()` pays face value in USDT, issue -> fund -> mature -> settle shown live |
| All four tracks | Whitechain common | "Contracts deployed on Whitechain Sepolia (chain ID 1874) and verified on the Whitechain explorer"; "At least one payment in USDT (0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7) settled on Whitechain in your main flow, with the explorer link in your README"; "A line in your README on why this flow needs onchain stablecoin settlement"; "steady progress"; "demo video of 2 to 4 minutes that shows each party"; "WHITECHAIN_FEEDBACK.md" | W1 deploy + Blockscout verify; README tx table; README "Why onchain"; small commits all day; video shows merchant, payer, investor; feedback file |
| Arkiv as the only database | Arkiv Build on Arkiv, from scratch ($4,000) | "Your app writes to Arkiv's current testnet [...] and at least one feature users see reads its data from Arkiv"; "README wallet + query; schema/friction + criterion files; open-source; AI disclosure"; not counted: "the SDK installed but never used to read, or Arkiv used only as a log that nothing reads" | invoices, payments, merchants, notes are entities; dashboard, checkout page and public receipt page read them; `/arkiv/*.md`; README writer wallet and runnable query |
| Invoice PDF on Swarm | Arkiv + Swarm bonus ($500) | "Your project uses both Arkiv and Swarm"; `/arkiv/swarm.md` with "what is on Swarm vs Arkiv and which entity field holds the Swarm reference; one entity key + Swarm reference with an openable link; postage stamp batch ID, buying wallet, Bee node/service" | `swarm_ref` attribute on the invoice entity holds the reference to a PDF with no personal data; `/arkiv/swarm.md` |
| World ID at merchant onboarding | World Best Use of IDKit ($2,500, 2 x $1,250) | "Integrate IDKit in a functioning application"; "verify the result on the server"; "explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance"; "Demonstrate a successful verification and one meaningful alternative path"; "integration debrief" | IDKit 4.6.0 in `/onboard`, proof verified in `apps/api`, nullifier reuse rejected; Proof of Human reasoning in `docs/WORLD_DEBRIEF.md`; cancelled path in the video |

### "Won't place" lists, checked item by item

- Whitechain Operate: "A pay button that sends a plain transfer" (no: invoice lifecycle with refund, export, receipt), "tipping jars, bill splitters" (no), "custodial bridges into a local currency token" (no INR token, no ramp), "Payroll, escrow and revenue splits on their own" (escrow exists only as the refund window inside a checkout product).
- Whitechain Tokenize: "A token with a mint button and no rules" (no: allowlist, maturity lock, USDT settlement enforced in Solidity, with Foundry tests that prove reverts), "ownership NFTs where nothing is enforced onchain" (no).
- Whitechain Scale: "Flows where the payer still signs a transaction that costs them gas" (no: the payer signs typed data only; the relayer pays), "AI chats that never actually pay anyone" (no AI chat).
- Arkiv: "SDK installed but never used to read" (dashboard, checkout and receipt page read), "Arkiv used only as a log that nothing reads" (no), personal data on Arkiv (none: no names, emails or nullifiers in entities).
- World: "simply a login screen" (no: the credential unlocks a sponsored gas budget, which is the drain-protection decision).

## 2. Architecture

### Toolchain decision (hour 0)

- Use **bun 1.4.3 everywhere** for TypeScript (install, scripts, Hono server, Vite). Do not install node/npm/pnpm; it saves 20 minutes and avoids two package managers.
- Install **Foundry** with `foundryup` for contracts (Code Garage `web3.evm.foundry`, tier 1, Apache-2.0, trusted). Use `forge-std` (tier 1, Apache-2.0) and `openzeppelin-contracts` v5 (`web3.standards.openzeppelin`, tier 1, MIT) for `Ownable`, `SafeERC20`, `ReentrancyGuard`.
- Verify with `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api` (Code Garage `web3.evm.contract-verification`, Blockscout llms.txt, tier 2, reference only).
- Frontend: Vite + React 19 + TypeScript + Tailwind v4 (Code Garage `frontend.build.vite-rolldown` and `frontend.styling.tailwind`, tier 1, MIT). Not Next.js: fewer moving parts under bun, and IDKit has had Next 15 dialog issues (idkit-js #378/#394/#395).
- API and relayer: Hono on bun (Code Garage `backend.frameworks` Hono, tier 1, MIT). Rate limiting pattern from `engineering` "Stripe: scaling your API with rate limiters" (reference).
- viem 2.57.16 for signing and RPC (Code Garage `web3.standards.eip712-signatures`, viem signTypedData, tier 1, MIT).
- `@arkiv-network/sdk` 1.0.1, `@worldcoin/idkit` 4.6.0 and `@worldcoin/idkit-core` 4.6.0, `@ethersphere/bee-js` 13.2.0, `pdf-lib` (MIT) for the PDF.
- Video: Playwright (Chromium installed; Code Garage `engineering.testing` Playwright, tier 1, Apache-2.0) `recordVideo` at 1920x1080 plus ffmpeg 8 for concat and audio mux.
- No Code Garage item matched "EIP-3009 relayer", "viem template", "Blockscout verify script" or "React widget kit" as reusable code; those are written new. Each used garage item is listed again in `AI_USAGE.md`.

### Monorepo layout

```
eth-global-nov-26/
  README.md  LICENSE (MIT)  AI_USAGE.md  WHITECHAIN_FEEDBACK.md  DECISIONS.md  PLAN.md
  arkiv/            schema.md friction.md reach.md why-arkiv.md how-you-use-arkiv.md swarm.md
  docs/             WORLD_DEBRIEF.md  demo-script.md  specs/*.md  prompts/*.md  submission.md
  contracts/        Foundry: src/PaymentRouter.sol src/InvoiceNote.sol test/ script/Deploy.s.sol  deployments/1874.json
  packages/shared/  TypeScript types, ABIs (generated from forge out/), constants (addresses, chain), EIP-712 typed-data builders
  packages/arkiv/   schemas, client factory, read/write helpers, entity key helpers
  packages/widget/  @paisalink/react: <PaisaLink/> component + embed.js build
  apps/api/         Hono on bun: payment links, relayer, World verify, CSV, PDF+Swarm, Arkiv writes
  apps/web/         Vite React: /merchant, /pay/:id, /r/:id (receipt), /onboard, /invest, /demo-store
  scripts/          load-env.sh, fund-demo.ts, record-demo.ts, mux-video.sh
  .env.example  .gitignore (.env.local, .data/, research/, CLAUDE.md are ignored or excluded)
```

### Chains and tokens

- Whitechain Sepolia, chain id **1874**, RPC `https://rpc.testnet.whitechain.io`, WS `wss://rpc.testnet.whitechain.io/ws`, explorer `https://explorer.testnet.whitechain.io`. Gas: 5 gwei floor, about 0.0001 WBT per transfer.
- USDT (required by the sponsor): `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals, proxy to `TetherTokenV2` (`0x26425662D126412128967ECf0a02EC48573026F7`) which has `permit`, `transferWithAuthorization` and `receiveWithAuthorization` (EIP-3009). Hour-0 task: read `eip712Domain()` or `DOMAIN_SEPARATOR()` and `name()` with `cast call` and pin the domain (name "Tether USD", version to be read on chain) in `packages/shared/src/usdt.ts`.
- Arkiv Rabdi testnet, chain id **7794095**, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, explorer `https://rabdi.explorer.arkiv.network`, faucet `https://hub.arkiv.network/faucet`, access keys `https://hub.arkiv.network/access-keys`.

### Contracts (Foundry)

`PaymentRouter.sol`
- `createInvoice(bytes32 invoiceId, uint256 amount, uint64 dueAt)` by merchant; stores merchant, amount, state.
- `pay(bytes32 invoiceId)`: payer-paid path, `transferFrom` USDT into the router.
- `payWithAuthorization(bytes32 invoiceId, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`: calls USDT `receiveWithAuthorization` with `to = address(this)`, so the payer never sends a tx. Anyone may submit (the relayer does). Requires `value == invoice.amount`.
- `refund(bytes32 invoiceId, uint256 amount)`: merchant only, from the invoice balance held in the router, to the recorded payer.
- `withdraw(bytes32 invoiceId)`: merchant pulls the remaining balance.
- Events: `InvoiceCreated(invoiceId, merchant, amount, dueAt)`, `InvoicePaid(invoiceId, payer, amount, gasless)`, `InvoiceRefunded(invoiceId, to, amount)`, `Withdrawn(invoiceId, merchant, amount)`.

`InvoiceNote.sol` (Tokenize)
- One contract, many notes (ERC-1155-style balances per `noteId`; simpler than one ERC-20 per invoice).
- `issue(bytes32 invoiceId, uint256 faceValue, uint256 price, uint64 maturity)` by the merchant (issuer).
- `fund(uint256 noteId)` by an **allowlisted** investor: pulls `price` USDT to the issuer, mints the note to the investor.
- `transfer(uint256 noteId, address to)`: reverts unless `to` is allowlisted and `block.timestamp < maturity`.
- `settle(uint256 noteId)`: on or after maturity, pulls `faceValue` USDT from the issuer (the merchant pays from the invoice proceeds) and pays the holder; marks `settled`. Settlement in USDT is the only path.
- `setAllowed(address, bool)` by the owner (the "compliance officer"). Events: `NoteIssued`, `NoteFunded`, `NoteTransferred`, `NoteSettled`, `AllowlistUpdated`.
- Foundry tests prove: non-allowlisted fund reverts, transfer after maturity reverts, settle before maturity reverts, settle pays face value in USDT.

Both deployed from the fresh deployer key and verified on Blockscout. Addresses and tx hashes go to `contracts/deployments/1874.json` and the README.

### Relayer with drain protection (`apps/api/src/relayer.ts`)

- Accepts `{invoiceId, authorization, signature}`; recomputes the EIP-712 digest; refuses unless `to == PaymentRouter`, `value == invoice.amount`, `validBefore` within 10 minutes, nonce unused, invoice state `open`.
- **World-ID-gated merchant allowlist**: only invoices whose merchant entity has `verified = true` (after a server-verified World ID proof) are relayed.
- **Per-merchant gas budget**: 0.02 WBT per merchant per day, tracked in memory and written to the merchant entity as `gas_used_wei`.
- **Rate limits**: 10 relays per payer address per hour, 60 per IP per hour, global 300 per hour.
- Simulation first: `eth_call` the `payWithAuthorization` before sending; a reverting call never spends gas.
- How the relayer gets WBT: the faucet (0.5 WBT/day) plus booth top-up; the README states the real-world answer (the business tops up the relayer; gas is about 0.0001 WBT per payment).

### Arkiv: the only database

Schemas in `packages/arkiv/src/schemas.ts`, lowercase attribute names, tags unique to the project:

| Schema tag | Attributes (indexed in bold) | Expiry (TTL) | Notes |
|---|---|---|---|
| `paisalink.merchants` | **wallet** addr, **handle** str, **verified** bool as u64 0/1, gas_used_wei u64, created_at u64 | 180 days | no names, no emails, no nullifier |
| `paisalink.invoices` | **merchant** addr, **invoice_id** str (bytes32 hex), **state** str (open, paid, refunded, financed, settled), amount_usdt dec, **due_at** u64, memo str (<=128 bytes), swarm_ref str optional, pay_tx str optional | due_at + 30 days; `extendEntity` on dispute | the payment link reads this entity |
| `paisalink.payments` | **invoice_id** str, **merchant** addr, payer addr, amount_usdt dec, tx_hash str, gasless u64, **paid_at** u64, refund_tx str optional | 90 days | receipt page reads this |
| `paisalink.notes` | **invoice_id** str, note_id u64, issuer addr, investor addr optional, face_usdt dec, price_usdt dec, **maturity** u64, **state** str | maturity + 30 days | investor page reads this |

- Writes: `apps/api` with the Arkiv writer wallet; entity keys via `predictEntityKey` so re-runs are idempotent; after each write wait one block (about 2 s) before reading back (node issue #241).
- Reads: dashboard `select().from(Invoices).where(eq("merchant", addr)).ownedBy(WRITER)`; receipt page `eq("invoice_id", id)`; live updates with `watchEntityEvents` over WebSocket (never `fromBlock`); cached last-good read in the UI for node stalls (#287).
- Kept off Arkiv on purpose: secrets, World ID nullifiers (in `.data/nullifiers.json`, git-ignored), PDF bytes (Swarm). This is the "what we kept off Arkiv" answer.
- README: writer wallet address and one runnable query (`bun run scripts/query.ts`).

### Swarm bonus

- `pdf-lib` renders an invoice PDF with no personal data (invoice id, merchant handle, amount, due date, memo). `@ethersphere/bee-js` 13.2.0 uploads it; `swarm_ref` on the invoice entity holds the plain reference; the receipt page shows an "Open on Swarm" link.
- Needs a Bee endpoint and a postage batch. Ask the Arkiv booth for a hackathon gateway first; fallback `bee-factory` (needs Docker; check at hour 0); last fallback: mark Swarm as "not available" in `/arkiv/swarm.md` and skip the bonus. Never store an encrypted reference in an entity.

### World IDKit

- Credential: **Proof of Human (Orb, `credentials/1`)**. The trust moment: a merchant asks PaisaLink to pay gas on behalf of its customers. A Device-level credential is cheap to farm, so it would let one person open thousands of merchant accounts and drain the relayer. Passport/NFC or Selfie Check would reveal more than we need (we do not need nationality or age). Proof of Human is therefore the minimum sufficient assurance: one human, one sponsored gas budget.
- Flow: `/onboard` renders IDKit 4.6.0 (`environment: "staging"`, action `paisalink-merchant`, signal = merchant wallet); `apps/api/src/world.ts` verifies the proof server-side with the app's signing key from `@worldcoin/idkit-core/signing`, checks the nullifier is new, then sets `verified = 1` on the merchant entity.
- Failure path: the user closes the dialog or the simulator rejects. The API never sets `verified`; the dashboard shows "Gas-sponsored checkout locked: verification not completed" and offers the self-paid `pay()` path. Reused nullifier returns 409.
- Testing: the simulator `https://simulator.worldcoin.org/id/0x18310f83` with a staging app from the Developer Portal.

### Frontend

- `/merchant`: create invoice, list (live from Arkiv), refund, "Export CSV", "Tokenise", verification badge.
- `/pay/:id` (phone): amount, Pay button; embedded payer wallet (a browser-local key, labelled "demo payer wallet" in the UI and README) signs the typed data; optional injected wallet. Shows "Paid" and a receipt link; never shows a chain name.
- `/r/:id`: public receipt from Arkiv, Swarm PDF link, explorer link.
- `/invest`: notes list, Fund, Transfer, Settle, and a visible "transfer after maturity reverts" button that shows the revert reason.
- `/demo-store`: a separate page that imports `<PaisaLink amount="49" merchant=... onPaid=... />` in about 20 lines; the source is shown on screen in the video.
- `packages/widget`: React component and a `<script src="embed.js">` iframe loader.

## 3. Interface contracts (so parallel agents do not collide)

### TypeScript types (`packages/shared/src/types.ts`, owned by W1 in hour 0, frozen by 09:30)

```ts
export type Address = `0x${string}`; export type Hex = `0x${string}`;
export type InvoiceState = "open" | "paid" | "refunded" | "financed" | "settled";
export interface Invoice { invoiceId: Hex; merchant: Address; amountUsdt: string; dueAt: number; memo: string; state: InvoiceState; swarmRef?: string; payTx?: Hex; }
export interface Payment { invoiceId: Hex; merchant: Address; payer: Address; amountUsdt: string; txHash: Hex; gasless: boolean; paidAt: number; refundTx?: Hex; }
export interface Merchant { wallet: Address; handle: string; verified: boolean; gasUsedWei: string; createdAt: number; }
export interface Note { noteId: number; invoiceId: Hex; issuer: Address; investor?: Address; faceUsdt: string; priceUsdt: string; maturity: number; state: "issued" | "funded" | "settled"; }
export interface Eip3009Authorization { from: Address; to: Address; value: string; validAfter: number; validBefore: number; nonce: Hex; }
export interface RelayRequest { invoiceId: Hex; authorization: Eip3009Authorization; signature: Hex; }
export interface RelayResponse { txHash: Hex; explorerUrl: string; }
```

### Contract ABIs and events

- Source of truth: `contracts/out/*.json` copied by `bun run gen:abi` into `packages/shared/src/abi/{PaymentRouter,InvoiceNote}.ts`. Function and event names are fixed as listed in section 2. W1 publishes the ABI file by 10:30 even if the implementation is incomplete.
- Addresses: `packages/shared/src/addresses.ts` reads `contracts/deployments/1874.json`.

### EIP-712 (USDT `receiveWithAuthorization`)

- Type: `ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
- Domain: `{ name, version, chainId: 1874, verifyingContract: USDT }` with name/version read on chain at hour 0 and pinned in `packages/shared/src/usdt.ts`. Builder: `buildReceiveAuthTypedData()` in shared; used by the widget (sign) and the relayer (verify).

### REST endpoints (`apps/api`, port 8787)

| Method and path | Body / query | Returns | Owner |
|---|---|---|---|
| `POST /merchants` | `{wallet, handle}` | `Merchant` | W4 |
| `POST /world/verify` | IDKit proof payload + `{wallet}` | `{verified: true}` or 4xx | W6 |
| `POST /invoices` | `{merchant, amountUsdt, dueAt, memo}` | `Invoice` (+ onchain `createInvoice` tx) | W2 |
| `GET /invoices/:id` | | `Invoice` | W2 |
| `GET /merchants/:wallet/invoices` | | `Invoice[]` | W4 |
| `GET /merchants/:wallet/export.csv` | | CSV | W2 |
| `POST /relay` | `RelayRequest` | `RelayResponse` or `{error, code}` | W2 |
| `POST /invoices/:id/refund` | `{amountUsdt}` signed by merchant (SIWE-style message) | `{txHash}` | W2 |
| `POST /invoices/:id/pdf` | | `{swarmRef, url}` | W7 |
| `GET /notes`, `POST /notes/:id/{fund,transfer,settle}` | | `Note` | W5 (frontend calls contracts directly with the investor wallet; API only mirrors to Arkiv) |
| `GET /health` | | versions, chain ids, relayer WBT balance, budget stats | W2 |

Error codes for `/relay`: `MERCHANT_NOT_VERIFIED`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `BAD_AUTHORIZATION`, `SIMULATION_FAILED`.

### Environment variables (names only; values live in lechu-secret)

`WC_RPC_URL`, `WC_WS_URL`, `WC_CHAIN_ID=1874`, `USDT_ADDRESS`, `PAYMENT_ROUTER_ADDRESS`, `INVOICE_NOTE_ADDRESS`, `DEPLOYER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `ARKIV_PRIVATE_KEY`, `ARKIV_ACCESS_KEY`, `ARKIV_RPC_URL`, `WORLD_APP_ID`, `WORLD_ACTION`, `WORLD_RP_ID`, `WORLD_SIGNING_KEY`, `BEE_URL`, `BEE_BATCH_ID`, `API_PORT`, `VITE_API_URL`, `VITE_WORLD_APP_ID`, `VITE_EXPLORER_URL`.

### File ownership

| Workstream | Owns (only these paths) |
|---|---|
| W1 contracts | `contracts/**`, `packages/shared/src/abi/**`, `packages/shared/src/addresses.ts`, `packages/shared/src/usdt.ts`, `packages/shared/src/types.ts` (frozen 09:30) |
| W2 api + relayer | `apps/api/**` except `world.ts`, `swarm.ts`; `scripts/fund-demo.ts` |
| W3 web + widget | `apps/web/**` except `onboard/**`, `invest/**`; `packages/widget/**` |
| W4 arkiv | `packages/arkiv/**`, `apps/api/src/routes/merchants.ts`, `scripts/query.ts`, `arkiv/schema.md` draft |
| W5 financing | `contracts/src/InvoiceNote.sol`, `contracts/test/InvoiceNote.t.sol` (after W1 hands over at 11:30), `apps/web/src/routes/invest/**` |
| W6 world | `apps/api/src/world.ts`, `apps/web/src/routes/onboard/**`, `docs/WORLD_DEBRIEF.md` |
| W7 swarm + pdf | `apps/api/src/swarm.ts`, `apps/api/src/pdf.ts`, `arkiv/swarm.md` |
| S1 tests | `contracts/test/**` additions, `apps/api/test/**`, `packages/*/test/**` |
| S2 verify | `scripts/verify-*.ts`, `docs/verification.md`, Playwright e2e `apps/web/e2e/**` |
| S3 paperwork | `README.md`, `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md` (except swarm.md draft), `docs/submission.md`, `docs/demo-script.md` |
| Coordinator | root configs, `package.json` workspaces, `.gitignore`, `.env.example`, `DECISIONS.md` (owner writes content), merges, commits |

Rule: an agent that needs a change outside its paths writes a short request in `docs/handoffs.md` for the coordinator instead of editing.

## 4. Workstreams

All code streams are Claude Opus 5.5 subagents at high effort; test, verify and paperwork streams are Sonnet 5.5. Every brief repeats: commit authorship rules (coordinator commits only), never touch `research/` or `CLAUDE.md`, pin versions, read `node_modules/*.d.ts` for Arkiv and IDKit, never fake a result, label every mock.

| ID | Name | Inputs | Outputs | Acceptance test | Hours | MUST / POLISH |
|---|---|---|---|---|---|---|
| W1 | Contracts | USDT domain from `cast`, section 2 spec (`docs/specs/contracts.md`) | `PaymentRouter.sol`, `InvoiceNote.sol` skeleton, Foundry tests, deploy + verify script, `deployments/1874.json`, ABI export | `forge test` green; both contracts verified on the explorer; one real `payWithAuthorization` USDT tx on 1874 with explorer link in README by 12:30 | 5 | MUST |
| W2 | API + relayer | Shared types, ABI, section 3 endpoints | Hono server, relayer with budget/allowlist/rate limits/simulation, invoices, refund, CSV, `/health` | `bun test apps/api`; `POST /relay` returns a tx hash for a valid authorization and `MERCHANT_NOT_VERIFIED` for an unverified merchant; CSV opens in a spreadsheet | 5 | MUST |
| W3 | Web + widget | Types, endpoints, design notes | `/merchant`, `/pay/:id`, `/r/:id`, `/demo-store`, `@paisalink/react`, embed.js | Phone test by the owner: open link, pay, see Paid; dashboard updates without reload; demo-store integration is <= 20 lines | 6 | MUST |
| W4 | Arkiv layer | SDK 1.0.1 `.d.ts`, schemas in section 2 | `packages/arkiv`, merchant routes, `scripts/query.ts`, `arkiv/schema.md` draft | First entity visible on `rabdi.explorer.arkiv.network` by 11:30; `bun run scripts/query.ts` prints invoices; read-after-write wait works | 4 | MUST |
| W5 | Financing | `InvoiceNote.sol` skeleton from W1 | Full `InvoiceNote.sol`, tests for every rule, `/invest` page, Arkiv `notes` mirror | Live: issue -> fund -> wait 2 min maturity -> settle on 1874 with 4 tx links; transfer after maturity reverts (shown in UI) | 4 | MUST (Tokenize) |
| W6 | World ID | Developer Portal app id, signing key (from owner), IDKit 4.6.0 | `/onboard`, `world.ts` verify + nullifier store, `docs/WORLD_DEBRIEF.md` | Simulator success sets `verified`; cancel leaves it unset and the relay returns `MERCHANT_NOT_VERIFIED`; reused proof returns 409 | 3 | MUST (World) |
| W7 | Swarm PDF | Bee URL + batch id (booth), `pdf-lib` | `pdf.ts`, `swarm.ts`, `arkiv/swarm.md` | Openable Swarm link for one invoice; `swarm_ref` on the entity | 2 | POLISH (bonus) |
| S1 | Tests | All code | Foundry edge tests (fuzz on amounts, replayed nonce), API unit tests, widget typed-data test vectors | All green in `bun run test:all` | 3 | MUST |
| S2 | Verify + e2e | Running stack | Playwright e2e of the full demo flow; `scripts/verify-submission.ts` that checks every README link, tx hash, file in section 7 | Script exits 0; e2e passes twice in a row | 3 | MUST |
| S3 | Paperwork | Everything, owner's `DECISIONS.md` and feedback notes | README, `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md`, `docs/submission.md`, `docs/demo-script.md` | Section 7 checklist complete; a judge can reproduce setup from README on a clean machine | 4 | MUST |
| C | Coordinator | All | Integration, commits every 30 to 60 min, video recording and mux, submission | Submitted by 07:30 Sat | continuous | MUST |

Critical path: W1 (USDT tx) -> W2 relay -> W3 phone checkout -> video. W4 runs in parallel from 09:30 and must deliver the first entity before W3 needs reads (13:00). W5 starts when W1 hands over the skeleton (11:30). W6 starts when the owner has the Developer Portal app (by 10:00).

## 5. Timeline (IST)

Human-required steps are marked [OWNER]. The coordinator and agents run through the night; the owner sleeps in two blocks.

| Time | Step |
|---|---|
| 08:30-09:00 | [OWNER] section 6 checklist part A (faucets on phone hotspot, Arkiv key, World app). Coordinator: `foundryup`, `bun` workspaces, repo skeleton, LICENSE, `.gitignore`, `.env.example`, `docs/specs/*.md` from this plan, first commit. `cast call` USDT domain. |
| 09:00-09:30 | Coordinator writes briefs; starts W1, W2, W3, W4 in parallel. [OWNER] writes `DECISIONS.md` v1 (product choices: Proof of Human, 30-day grace, fee-free, demo amounts). |
| 09:30 | Checkpoint: shared types frozen; ABI stub published. |
| 10:00 | [OWNER] World app id and signing key stored; W6 starts. [OWNER] booths (section 6 part B). |
| 11:30 | **Checkpoint: first Arkiv entity on the explorer (hour 3).** W1 hands `InvoiceNote` skeleton to W5. |
| 12:30 | **Checkpoint: first real USDT `payWithAuthorization` tx on 1874 (hour 4)**, link in README, screenshot saved. If no test USDT yet: W1 proves with the owner's USDT from the swap; if none, go to the Whitechain booth now. |
| 13:00-14:00 | [OWNER] lunch, phone test of `/pay` on the dev URL (Tailscale or ngrok), writes `docs/feedback/owner-notes.md` (raw experience, used for feedback files). |
| 14:30 | **Checkpoint: IDKit verify success and cancel paths (hour 6).** S1 starts. |
| 16:00 | Checkpoint: gasless phone checkout end to end with dashboard live update. W7 starts if a Bee endpoint exists. |
| 18:00 | Checkpoint: financing lifecycle complete on 1874. S2 starts e2e. [OWNER] phone test of refund and financing; booth pre-check of `/arkiv/*.md` with Arkiv staff. |
| 20:00 | S3 starts the paperwork; coordinator reviews every README claim against explorer links. [OWNER] dinner, second `DECISIONS.md` pass, writes own lines for `WHITECHAIN_FEEDBACK.md`, `arkiv/friction.md` and the World debrief. |
| 22:00 | Full run of `scripts/verify-submission.ts`; fix list. |
| 23:30 | **Feature freeze.** Only bug fixes and docs after this. |
| 23:30-01:30 | Coordinator records the screen with Playwright (`scripts/record-demo.ts`), one take per chapter, 1080p, real time. [OWNER] final phone test, then sleep block 1 (00:00-03:00). |
| 01:30-03:00 | Coordinator cuts chapters with ffmpeg, writes `docs/demo-script.md` with exact timestamps against the cut; S3 finishes files. |
| 03:00-04:00 | [OWNER] wakes, reads the narration into a mic (phone voice recorder or laptop; quiet room; 2 to 3 takes). The script is timed per chapter so the audio is recorded chapter by chapter. |
| 04:00-05:00 | Coordinator muxes audio (`scripts/mux-video.sh`), checks 1080p, length 2:50-3:10, no speed-up; uploads to YouTube unlisted (or the ETHGlobal uploader). [OWNER] sleep block 2 (04:15-06:15). |
| 05:00-06:15 | Coordinator: final README pass (tx table, chapter timestamps), `AI_USAGE.md` final, last commits and push; `docs/submission.md` with the form text. |
| 06:15-07:30 | [OWNER] reviews `docs/submission.md`, fills the ETHGlobal form (three partners: Whitechain, Arkiv, World; "Finalist and Partner Prizes"), pastes video link, AI disclosure, repo link. **Submit by 07:30.** |
| 07:30-09:00 | Buffer. Re-check the form, nothing else. No code after submission. |

## 6. Owner checklist: the first 60 minutes

Do part A on a **phone hotspot**, not venue Wi-Fi. Why: the Whitechain faucet limits by IP and the venue shares one IP, so a shared address may already be exhausted.

### Part A (08:30-09:15, at the laptop)

1. **Whitechain WBT faucet.** Open `https://faucet.testnet.whitechain.io`, sign in with GitHub, paste the **deployer** address, claim 0.5 WBT. Repeat with a second GitHub account (if you have one) for the **relayer** address, and a third for the **investor** address. Why: 0.5 WBT per GitHub account per 24 h; the relayer needs its own balance because it pays all customer gas, and the deployer pays for deploys and verification. Addresses (fresh testnet keys, already stored with lechu-secret): deployer and Arkiv writer `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb`, relayer `0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F`, merchant `0xC038827b4E362B0de1Be859377508613CD028946`, payer `0x32c84603C9848FFa470FB07C9bCe820944D04c52`, investor `0xe7CfE30ED69450427FFf6bbBe143E5da71E4AF87`.
2. **Test USDT.** Open `https://testnet.yetitrade.fi`, connect a browser wallet holding the deployer key (import it into a fresh MetaMask profile; add network: name Whitechain Sepolia, RPC `https://rpc.testnet.whitechain.io`, chain id 1874, symbol WBT, explorer `https://explorer.testnet.whitechain.io`). Swap 0.1 WBT to USDT. Then open `https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` and confirm the token you received is that exact address. Why: the sponsor only counts payments in this USDT; a token you mint yourself "won't count". Aim for 50+ USDT total so the demo can run several times. If the swap gives too little, ask at the Whitechain booth (part B).
3. **Arkiv.** Open `https://hub.arkiv.network/faucet`, connect the **Arkiv writer** wallet (the same key as the deployer), request tGLM. Then `https://hub.arkiv.network/access-keys`, sign in with the same wallet, choose **Rabdi**, create a key, store it with lechu-secret as `ARKIV_ACCESS_KEY`. Why: anonymous writes hit a 429 `ANON_COST_LIMITED` that hangs for about 27 minutes (SDK issue #126); the key must exist before any Arkiv code runs.
4. **World Developer Portal.** Open `https://developer.worldcoin.org`, sign in, create an app named PaisaLink, environment **Staging**, add an action `paisalink-merchant` ("Verify once to unlock gas-sponsored checkout"). Copy `app_id`, the RP id and the signing key; store them with lechu-secret (`WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_SIGNING_KEY`). Open `https://simulator.worldcoin.org/id/0x18310f83` once on the phone so it is ready. Why: IDKit 4 needs an app and signed requests; staging works with the simulator and needs no Orb.
5. **Tell the coordinator** which addresses hold WBT and USDT, so `scripts/fund-demo.ts` can move USDT to the demo payer wallet.

### Part B (10:00-11:00, booths; batch the questions)

- **Whitechain booth**: "Can you top up test USDT to this address?" (show the deployer address QR); "Is `receiveWithAuthorization` the recommended EIP-3009 entry on your USDT, and what is the EIP-712 version string?"; "Slides from the Thursday workshop?" Mention you are entering Operate, Scale and Tokenize with one repo.
- **Arkiv booth**: "Is there a hackathon Swarm gateway or postage stamp we can use for the bonus?"; "Can you glance at our `/arkiv/` file plan?"; "Any Rabdi outage today?" Ask for a tGLM top-up if the faucet failed.
- **World booth**: "Our IDKit staging app id is set; is the simulator the right path for Proof of Human today, and is there an `account_not_eligible` workaround?"
- **ETHGlobal desk**: confirm the repo creation time (after kickoff) is fine for Classic, and that an AI-assisted solo project with `AI_USAGE.md` is acceptable.

Later owner tasks (batched): 13:00 phone test and `docs/feedback/owner-notes.md`; 18:00 phone test of refund and financing, booth pre-check; 20:00 own lines in the three feedback files; 03:00 voice recording; 06:15 submission form.

## 7. Paperwork per sponsor

- **Whitechain**: `WHITECHAIN_FEEDBACK.md` (what worked, where stuck, docs gaps; owner writes the first three lines from experience); README sections "Contracts (verified)" with addresses and verify links, "USDT payment tx" table (gasless pay, refund, fund, settle, each with explorer link), "Why onchain settlement on Whitechain" (instant finality, global payer, programmable refund, no chargeback, no intermediary), "Gas and drain protection", "Setup", "Architecture", "Current limitations"; video 2 to 4 min showing merchant, payer, investor.
- **Arkiv**: `/arkiv/schema.md`, `/arkiv/friction.md` (bug-tracker style: version, expected, actual, repro; a praise-only file scores 1/5), `/arkiv/reach.md`, `/arkiv/why-arkiv.md`, `/arkiv/how-you-use-arkiv.md`, `/arkiv/swarm.md` (only if the bonus is attempted); README "Arkiv" section with the writer wallet address and one runnable query; MIT `LICENSE`.
- **World**: `docs/WORLD_DEBRIEF.md`: time to first success, friction, missing capability or docs, the one improvement with the greatest impact; README "World ID" section pointing to the credential reasoning and the video timestamp of the cancelled path.
- **ETHGlobal**: `AI_USAGE.md` listing every AI-generated file by path and the model used, the human contributions (`DECISIONS.md`, owner feedback notes, phone tests, voice narration, booth findings), and that all prompts and specs are in `docs/prompts/` and `docs/specs/`. README "Video chapters" with timestamps.
- **Submission form text** (`docs/submission.md`): project description for the pre-scorer (architecture, what is novel, what is live vs mocked, "what breaks without Whitechain / Arkiv / World"); one paragraph per partner on how it was used, feedback, comments.
- **Video requirements**: about 3:00, 1080p, real-time footage, the owner's own voice, no music-only, screen recording not phone recording; shows merchant, payer and investor (Whitechain), the Arkiv read (dashboard), the Swarm moment (if any), the World success and cancelled paths.

## 8. Demo script (3:00) and risk register

| Time | Scene | On screen | Narration (owner's voice) |
|---|---|---|---|
| 0:00-0:15 | Problem | Title, one number | "Indian freelancers billing abroad lose 3 to 6 percent and wait days. PaisaLink gets them paid in USDT on Whitechain, with nothing for the client to learn." |
| 0:15-0:35 | Invoice | `/merchant`, create a 49 USDT invoice, link appears | "I create an invoice. It is an Arkiv entity, not a row in my database." |
| 0:35-1:00 | Phone pay | Phone emulation of `/pay/:id`, tap Pay, Paid; explorer tab shows the USDT tx | "The client taps Pay. No gas, no chain name. Our relayer submitted an EIP-3009 authorization to the official USDT. Here is the transaction." |
| 1:00-1:20 | Live dashboard, refund | Dashboard updates; click Refund 9 USDT; tx link | "The dashboard updated live from Arkiv. A partial refund is one click, enforced by the router." |
| 1:20-1:35 | Export, receipt | CSV download; receipt page with Swarm PDF link (if available) | "The accountant gets a CSV. The receipt PDF lives on Swarm, referenced from the entity." |
| 1:35-1:50 | 20 lines | `demo-store` source | "A separate store adds the widget in about twenty lines." |
| 1:50-2:25 | Financing | `/invest`: issue 2,000 USDT note, investor funds 1,950, maturity passes, settle; transfer-after-maturity revert shown | "An exporter sells a 30-day invoice today. Only allowlisted investors can fund; transfers stop at maturity; settlement is in USDT. This is enforced in the contract." |
| 2:25-2:45 | World ID | `/onboard`: simulator success badge; second merchant cancels, relay refused | "Who may spend our gas? One human, one budget: Proof of Human. Cancel the check and the gasless path stays locked." |
| 2:45-3:00 | Architecture | Diagram: Whitechain, Arkiv, Swarm, World, relayer | "Settlement on Whitechain, data on Arkiv, files on Swarm, humans by World ID. Everything shown is live on testnet." |

Risk register and fallbacks

| Risk | Fallback |
|---|---|
| No test USDT from the swap | Booth top-up; ask another hacker to swap and send; last resort demo with the smallest amounts and say so in the README. Never a self-minted token. |
| Faucet IP limit on venue Wi-Fi | Phone hotspot for all faucet claims; second and third GitHub accounts. |
| USDT EIP-712 version string wrong | Read `eip712Domain()` with `cast`; test a signature on-chain in the first hour; fallback to `transferWithAuthorization` plus `pay()` if `receiveWithAuthorization` misbehaves, documented. |
| Arkiv read-after-write lag (#241) or stall (#287) | Wait one block before reading; cache the last good read in the UI with a "last synced" time; demo still shows the write tx on the Arkiv explorer. |
| Arkiv access key quota | Second key on a second wallet, kept ready. |
| World sandbox or simulator issue | Keep the Developer Portal page open; if staging is down, record the cancelled path first and the success path later; never fake a verified badge. |
| Swarm gateway unavailable | Skip the bonus; `/arkiv/swarm.md` not submitted; receipt page shows "PDF (local)" labelled as not on Swarm. |
| Relayer drained or out of WBT | `/health` shows balance; faucet or booth top-up; budget caps make this unlikely. |
| Agents collide on files | File ownership table; `docs/handoffs.md`; coordinator is the only writer to shared files. |
| Video too long or wrong format | ffmpeg checks length and resolution; chapter cuts; re-record one chapter, not the whole video. |
| Owner oversleeps | Alarm at 03:00 and 06:15; coordinator prepares everything so the owner's remaining work is 15 minutes of recording and 30 minutes of form filling. |

Rule: never fake a result. Any mock (for example the browser-local demo payer wallet) is labelled in the UI, the README and the video.

## 9. Secrets plan

- All private keys and API keys live only in `lechu-secret`, stack `hackathon`: `DEPLOYER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `ARKIV_PRIVATE_KEY`, `ARKIV_ACCESS_KEY`, `WORLD_SIGNING_KEY`, `WORLD_RP_ID`, `BEE_BATCH_ID`, plus the existing `AARJN_ETHGLOBAL_TOKEN` for pushes.
- The deployer, relayer, Arkiv writer, investor and demo payer keys are **fresh testnet keys** generated at 08:30 with `cast wallet new`; they never hold real value.
- Key mapping (lechu-secret name → env var): `PAISA_DEPLOYER_PK` → `DEPLOYER_PRIVATE_KEY` and `ARKIV_PRIVATE_KEY`; `PAISA_RELAYER_PK` → `RELAYER_PRIVATE_KEY`; `PAISA_MERCHANT_PK`, `PAISA_PAYER_PK`, `PAISA_INVESTOR_PK` → `DEMO_MERCHANT_PRIVATE_KEY`, `DEMO_PAYER_PRIVATE_KEY`, `DEMO_INVESTOR_PRIVATE_KEY` (demo wallets only). To import a key into MetaMask, run `lechu-secret show hackathon PAISA_DEPLOYER_PK` in your own terminal; never paste it into a chat.
- `scripts/load-env.sh` reads lechu-secret and writes a git-ignored `.env.local` at runtime; `.env.example` lists names only. `.gitignore` has `.env.local`, `.env*.local`, `.data/`, `node_modules/`, `contracts/broadcast/*/dry-run/`. `research/` and `CLAUDE.md` stay in `.git/info/exclude`.
- Agents receive env values only through the running process environment, never pasted into prompts, specs or docs. Subagent briefs say: "never print secret values; never write them into any file under the repo".
- The GitHub token is used only in the push URL and never saved in `.git/config`.
- Before every commit the coordinator runs `git diff --cached | grep -E '0x[0-9a-fA-F]{64}'` and a check for `ARKIV_ACCESS_KEY=` and `WORLD_SIGNING_KEY=` patterns.
