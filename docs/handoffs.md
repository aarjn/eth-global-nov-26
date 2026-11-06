# Handoffs

Requests between workstreams. An agent that needs a change outside its own paths writes it here for the coordinator.


## W4 -> owner (URGENT, blocks the 11:30 Arkiv checkpoint) — 08:25 IST
The Arkiv writer `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb` has **0 tGLM** on Rabdi and `ARKIV_ACCESS_KEY` is empty. The hub cannot be done by an agent: sign-in is SIWE (scriptable), but account registration asks for an **email**, and both the faucet claim (`POST /api/faucet`) and key creation send a **Cap proof-of-work captcha token** (`cap.arkiv.network`) from the browser widget. Owner, please:
1. Import the deployer key into a browser wallet (or use a wallet that holds it), open https://hub.arkiv.network, connect, sign in (SIWE), register with your email.
2. https://hub.arkiv.network/faucet: claim tGLM to `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb`.
3. https://hub.arkiv.network/access-keys: network Rabdi, name `paisalink`, generate. Then in a terminal: `printf %s '<key>' | lechu-secret set hackathon ARKIV_ACCESS_KEY` and `bash scripts/load-env.sh`.
Tell W4 when done; the first write runs right after.

## W3 -> W2 / W4 (API shape the web app codes against) — 08:35 IST
The web app (`apps/web`) and widget (`packages/widget`) call these. Items 1-4 are not in PLAN.md section 3 yet; the UI degrades gracefully if missing, but the demo is better with them.
1. **W4 `GET /merchants/:wallet`** -> `Merchant` (404 if unknown). Used for the handle on `/pay/:id` and the verification badge on `/merchant`. `POST /merchants` must not reset `verified` on an existing merchant (upsert keeps it).
2. **W2 `GET /invoices/:id/receipt`** -> `{ invoice: Invoice, payment: Payment | null, merchant: Merchant | null }` for `/r/:id`. Fallback today: `GET /invoices/:id` + `invoice.payTx`.
3. **W2 `GET /merchants/:wallet/events`** (SSE, `text/event-stream`, one `data: {"kind":"invoice"|"payment"|"note","id":"0x.."}` per Arkiv change via `store.watchMerchant`). The dashboard refetches on each event and also polls every 4 s as a fallback.
4. **W2 refund signing**: `GET /invoices/:id/refund-typed-data?amountUsdt=9` -> `{ typedData, deadline }` (EIP-712 for `refundWithSig`, with the merchant's current router nonce, BigInts as decimal strings), then `POST /invoices/:id/refund { amountUsdt, deadline, signature }` -> `{ txHash, explorerUrl }`. The browser signs exactly the returned typed data, so the web never hard-codes the router's domain/nonce. If you prefer another shape, write it here and W3 adapts.
5. `POST /invoices { merchant, amountUsdt, dueAt, memo }` is called **without a merchant signature** by the widget on third-party stores (`/demo-store`); please keep it unsigned (rate-limit it) or tell W3 the required auth.
6. `POST /demo/fund { address }` -> `{ txHash, amountUsdt, demo: true }`; error `{ error, code }`.
7. All errors as JSON `{ error, code }`; CORS must allow `http://localhost:5173` and any origin for `GET /invoices/:id` and `POST /invoices` (widget on other sites).

## W3 -> W5 / W6 (how to plug into the web app) — 08:35 IST
- Routes are file-based and lazy: put a default-exported React component in `apps/web/src/routes/invest/index.tsx` (served at `/invest`, query `?invoice=0x..` from the dashboard's "Sell this invoice") and `apps/web/src/routes/onboard/index.tsx` (served at `/onboard`, query `?wallet=0x..`). The router picks them up with `import.meta.glob`; no edit to `App.tsx` needed.
- Reuse, do not copy: `src/lib/wallet.ts` (`getLocalAccount("merchant" | "payer" | "investor")`, browser-local testnet demo keys, labelled), `src/lib/api.ts` (`api.get/post`, `ApiError` with `.code`), `src/lib/chain.ts` (`publicClient`, `usdtBalance`, `formatUsdt`, `parseUsdt`), `src/components/ui.tsx` (`Card`, `Button`, `Badge`, `DemoWalletTag`, `TxLink`), `src/components/Shell.tsx` (page layout with nav).

## W1 (contracts) -> coordinator, 6 Nov ~08:30 IST
1. `packages/shared/src/index.ts`: please add `export * from "./abi";` and `export * from "./addresses";` (W1 owns those files but not index.ts). Until then import from `@paisalink/shared/src/abi` and `@paisalink/shared/src/addresses`.
2. **W2/W3 heads-up (not a file change):** `payWithAuthorization` requires the EIP-3009 `nonce` to equal `PaymentRouter.paymentNonce(invoiceId)` = `keccak256(abi.encode(router, invoiceId))`; use `invoicePaymentNonce(router, invoiceId)` from `packages/shared/src/abi/helpers.ts`. A random nonce reverts with `WrongNonce`. This blocks the front-run that redirects a payer's signature to another invoice of the same amount. See `docs/specs/contracts.md`.
3. `contracts/lib/` holds OpenZeppelin v5.4.0 and forge-std v1.11.0, vendored (installed with `forge install --no-git`, trimmed to sources and licences, about 3 MB), because `forge install` with submodules would run git on the repo. Commit them as-is so `forge build` works on a clean clone.
